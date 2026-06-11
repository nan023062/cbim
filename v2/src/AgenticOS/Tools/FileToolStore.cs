using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using CBIM.Storage;

namespace CBIM.Tools;

/// <summary>
/// 工具描述符本地文件后端实现。
///
/// 落盘形态：<c>&lt;root&gt;/&lt;subdir&gt;/&lt;familyName&gt;.tool.json</c>
/// （默认 subdir = "tools"）。
/// 一条 <see cref="ToolDescriptor"/> 一个文件，无 index——构造时全量扫描进内存索引，
/// <see cref="Put"/> / <see cref="Delete"/> 同步更新索引 + 原子落盘。
///
/// 索引键为 <see cref="ToolDescriptor.FamilyName"/>（即 "Files" / "Search" 等）。
///
/// 线程安全：所有公共方法在内部锁下访问索引；落盘走 <see cref="FileBackend.WriteAtomic"/>。
/// 调用方可在任意线程并发调用。
/// </summary>
public sealed class FileToolStore
{
    private const string DefaultSubDir = "tools";
    private const string FileSuffix = ".tool.json";

    private static readonly JsonSerializerOptions JsonOptions = new JsonSerializerOptions
    {
        WriteIndented = true,
    };

    private readonly FileBackend _storage;
    private readonly string _subdir;
    private readonly object _gate = new object();
    private readonly Dictionary<string, ToolDescriptor> _entries =
        new Dictionary<string, ToolDescriptor>(StringComparer.Ordinal);

    /// <summary>
    /// 构造并从 <c>&lt;root&gt;/&lt;subdir&gt;/</c> 扫描全量条目进内存。
    /// 目录不存在时静默通过——首次 <see cref="Put"/> 会触发创建。
    /// </summary>
    /// <param name="backend">文件后端（共享）。根目录由调用方注入。</param>
    /// <param name="subdir">落盘子目录名，默认 "tools"。</param>
    public FileToolStore(FileBackend backend, string subdir = DefaultSubDir)
    {
        _storage = backend ?? throw new ArgumentNullException(nameof(backend));
        if (string.IsNullOrWhiteSpace(subdir))
            throw new ArgumentException("subdir 不能为空", nameof(subdir));
        _subdir = subdir;

        LoadFromDisk();
    }


    #region FileToolStore 公共方法


    /// <summary>按 FamilyName 查找 ToolDescriptor。找不到返回 null。</summary>
    public ToolDescriptor Get(string familyName)
    {
        if (string.IsNullOrWhiteSpace(familyName))
            return null;
        lock (_gate)
        {
            return _entries.TryGetValue(familyName, out var d) ? d : null;
        }
    }

    /// <summary>列出全部已注册的 ToolDescriptor。</summary>
    public IReadOnlyList<ToolDescriptor> List()
    {
        lock (_gate)
        {
            return _entries.Values.ToList();
        }
    }

    /// <summary>写入或更新一条 ToolDescriptor，同步落盘。</summary>
    public void Put(ToolDescriptor descriptor)
    {
        if (descriptor == null)
            throw new ArgumentNullException(nameof(descriptor));

        lock (_gate)
        {
            _entries[descriptor.FamilyName] = descriptor;
            PersistEntry(descriptor);
        }
    }

    /// <summary>删除指定 FamilyName 的 ToolDescriptor。不存在时返回 false。</summary>
    public bool Delete(string familyName)
    {
        if (string.IsNullOrWhiteSpace(familyName))
            return false;

        lock (_gate)
        {
            if (!_entries.Remove(familyName))
                return false;
            _storage.Delete(EntryPath(familyName));
            return true;
        }
    }



    #endregion

    #region 内部：路径 / 序列化 / 加载


    private string EntryPath(string familyName) =>
        _storage.ResolveCbimPath(_subdir, familyName + FileSuffix);

    private void PersistEntry(ToolDescriptor descriptor)
    {
        var dto = ToolDto.From(descriptor);
        string json = JsonSerializer.Serialize(dto, JsonOptions);
        _storage.WriteAtomic(EntryPath(descriptor.FamilyName), json);
    }

    private void LoadFromDisk()
    {
        // 用 ResolveCbimPath 产出一个 dummy 条目路径，从中提取目录。
        string probe = EntryPath("__probe");
        string dir = Path.GetDirectoryName(probe);
        if (string.IsNullOrEmpty(dir) || !Directory.Exists(dir))
            return;

        foreach (var file in Directory.EnumerateFiles(dir, "*" + FileSuffix, SearchOption.TopDirectoryOnly))
        {
            var loaded = TryLoadEntry(file);
            if (loaded != null)
                _entries[loaded.FamilyName] = loaded;
        }
    }

    private ToolDescriptor TryLoadEntry(string path)
    {
        string json = _storage.ReadOrNull(path);
        if (string.IsNullOrEmpty(json))
            return null;

        try
        {
            var dto = JsonSerializer.Deserialize<ToolDto>(json, JsonOptions);
            return dto?.ToDescriptor();
        }
        catch (JsonException)
        {
            // 损坏文件静默跳过——避免一个坏文件阻塞整个 store 启动。
            return null;
        }
        catch (ArgumentException)
        {
            // DTO 字段缺失被 ToolDescriptor 构造器拒绝时也走这里。
            return null;
        }
    }

    // 落盘 DTO——隔离 ToolDescriptor（构造器有校验，不能直接被反序列化 set）。
    private sealed class ToolDto
    {
        public string FamilyName { get; set; }
        public string Description { get; set; }

        public static ToolDto From(ToolDescriptor d) => new ToolDto
        {
            FamilyName = d.FamilyName,
            Description = d.Description,
        };

        public ToolDescriptor ToDescriptor() =>
            new ToolDescriptor(FamilyName, Description);
    }

    #endregion
}
