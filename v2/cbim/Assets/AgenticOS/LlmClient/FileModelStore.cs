using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Serialization;
using CBIM.Storage;

namespace CBIM.LlmClient
{
    /// <summary>
    /// 模型配置本地文件后端实现。
    ///
    /// 落盘形态：<c>&lt;root&gt;/&lt;subdir&gt;/&lt;id&gt;.model.json</c>（默认 subdir = "models"）。
    /// 一条 ModelDescriptor 一个文件，无 index——构造时全量扫描进内存索引，
    /// <see cref="Put"/> / <see cref="Delete"/> 同步更新索引 + 原子落盘。
    ///
    /// 线程安全：所有公共方法在内部锁下访问索引；落盘走 <see cref="FileBackend.WriteAtomic"/>。
    /// 调用方可在任意线程并发调用。
    /// </summary>
    public sealed class FileModelStore
    {
        private const string DefaultSubDir = "models";
        private const string FileSuffix = ".model.json";

        private static readonly JsonSerializerOptions JsonOptions = new JsonSerializerOptions
        {
            WriteIndented = true,
            Converters = { new KnownProviderConverter() },
        };

        private readonly FileBackend _storage;
        private readonly string _subdir;
        private readonly object _gate = new object();
        private readonly Dictionary<string, ModelDescriptor> _entries =
            new Dictionary<string, ModelDescriptor>(StringComparer.Ordinal);

        /// <summary>
        /// 构造并从 <c>&lt;root&gt;/&lt;subdir&gt;/</c> 扫描全量条目进内存。
        /// 目录不存在时静默通过——首次 <see cref="Put"/> 会触发创建。
        /// </summary>
        /// <param name="backend">文件后端（共享）。根目录由调用方注入。</param>
        /// <param name="subdir">落盘子目录名，默认 "models"。</param>
        public FileModelStore(FileBackend backend, string subdir = DefaultSubDir)
        {
            _storage = backend ?? throw new ArgumentNullException(nameof(backend));
            if (string.IsNullOrWhiteSpace(subdir))
                throw new ArgumentException("subdir 不能为空", nameof(subdir));
            _subdir = subdir;

            LoadFromDisk();
        }

#region 公共方法

        public ModelDescriptor Get(string id)
        {
            if (string.IsNullOrWhiteSpace(id)) return null;
            lock (_gate)
            {
                return _entries.TryGetValue(id, out var d) ? d : null;
            }
        }

        public IReadOnlyList<ModelDescriptor> List()
        {
            lock (_gate)
            {
                return _entries.Values.ToList();
            }
        }

        public void Put(ModelDescriptor descriptor)
        {
            if (descriptor == null) throw new ArgumentNullException(nameof(descriptor));

            lock (_gate)
            {
                _entries[descriptor.Id] = descriptor;
                PersistEntry(descriptor);
            }
        }

        public bool Delete(string id)
        {
            if (string.IsNullOrWhiteSpace(id)) return false;

            lock (_gate)
            {
                if (!_entries.Remove(id)) return false;
                _storage.Delete(EntryPath(id));
                return true;
            }
        }

#endregion

#region 内部：路径 / 序列化 / 加载

        private string EntryPath(string id) =>
            _storage.ResolveCbimPath(_subdir, id + FileSuffix);

        private void PersistEntry(ModelDescriptor descriptor)
        {
            var dto = ModelDto.From(descriptor);
            string json = JsonSerializer.Serialize(dto, JsonOptions);
            _storage.WriteAtomic(EntryPath(descriptor.Id), json);
        }

        private void LoadFromDisk()
        {
            // 用 ResolveCbimPath 产出一个 dummy 条目路径，从中提取目录。
            string probe = EntryPath("__probe");
            string dir = Path.GetDirectoryName(probe);
            if (string.IsNullOrEmpty(dir) || !Directory.Exists(dir)) return;

            foreach (var file in Directory.EnumerateFiles(dir, "*" + FileSuffix, SearchOption.TopDirectoryOnly))
            {
                var loaded = TryLoadEntry(file);
                if (loaded != null) _entries[loaded.Id] = loaded;
            }
        }

        private ModelDescriptor TryLoadEntry(string path)
        {
            string json = _storage.ReadOrNull(path);
            if (string.IsNullOrEmpty(json)) return null;

            try
            {
                var dto = JsonSerializer.Deserialize<ModelDto>(json, JsonOptions);
                return dto?.ToDescriptor();
            }
            catch (JsonException)
            {
                // 损坏文件静默跳过——避免一个坏文件阻塞整个 store 启动。
                return null;
            }
            catch (ArgumentException)
            {
                // DTO 字段缺失被 ModelDescriptor 构造器拒绝时也走这里。
                return null;
            }
        }

        // 大小写不敏感的 KnownProvider 枚举 JSON 转换器。
        // 读取时忽略大小写，写入时使用枚举名称原文（PascalCase）。
        private sealed class KnownProviderConverter : JsonConverter<KnownProvider>
        {
            public override KnownProvider Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
            {
                string value = reader.GetString();
                if (string.IsNullOrEmpty(value))
                    throw new JsonException("KnownProvider 值不能为空");
                return (KnownProvider)Enum.Parse(typeof(KnownProvider), value, ignoreCase: true);
            }

            public override void Write(Utf8JsonWriter writer, KnownProvider value, JsonSerializerOptions options)
            {
                writer.WriteStringValue(value.ToString());
            }
        }

        // 落盘 DTO——隔离 ModelDescriptor（构造器有校验，不能直接被反序列化 set）。
        private sealed class ModelDto
        {
            public string Id { get; set; }
            public string Name { get; set; }
            public KnownProvider Provider { get; set; }
            public string ModelName { get; set; }
            public string? ApiKey { get; set; }
            public string? Endpoint { get; set; }
            public float? Temperature { get; set; }
            public int? MaxTokens { get; set; }

            public static ModelDto From(ModelDescriptor d) => new ModelDto
            {
                Id = d.Id,
                Name = d.Name,
                Provider = d.Provider,
                ModelName = d.ModelName,
                ApiKey = d.ApiKey,
                Endpoint = d.Endpoint,
                Temperature = d.Temperature,
                MaxTokens = d.MaxTokens,
            };

            public ModelDescriptor ToDescriptor() =>
                new ModelDescriptor(Id, Name, Provider, ModelName, ApiKey, Endpoint, Temperature, MaxTokens);
        }

#endregion
    }
}
