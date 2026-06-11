using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading;
using System.Threading.Tasks;
using CBIM.Kernel;
using CBIM.Storage;

namespace CBIM.Workflow
{
    /// <summary>
    /// Workflow 注册表本地文件后端实现。
    ///
    /// <para>落盘形态：<c>&lt;root&gt;/&lt;subdir&gt;/&lt;id&gt;.workflow.json</c>
    /// （默认 subdir = "workflows"）。一条 <see cref="WorkflowDescriptor"/> 一个文件，
    /// 无 index——构造时全量扫描进内存索引，<see cref="PutAsync"/> / <see cref="DeleteAsync"/>
    /// 同步更新索引 + 原子落盘。</para>
    ///
    /// <para>序列化方案：<see cref="NeuralCircuit"/> 是多态运行时对象（<see cref="CircuitNode"/>
    /// 抽象基类派生三类型），不能直接 JSON 序列化。改为存储「构建参数」——节点列表（带 kind 鉴别字段）
    /// + 边列表——反序列化时用 <see cref="NeuralCircuitBuilder"/> 逐步重建，保留全部 Commit 校验。</para>
    ///
    /// <para>线程安全：所有公共方法在内部锁下访问索引；落盘走 <see cref="FileBackend.WriteAtomic"/>。</para>
    /// </summary>
    public sealed class FileWorkflowStore
    {
        private const string DefaultSubDir = "workflows";
        private const string FileSuffix = ".workflow.json";

        private static readonly JsonSerializerOptions JsonOptions = new JsonSerializerOptions
        {
            WriteIndented = true,
            DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        };

        private readonly FileBackend _storage;
        private readonly string _subdir;
        private readonly object _gate = new object();

        private readonly Dictionary<string, WorkflowDescriptor> _entries =
            new Dictionary<string, WorkflowDescriptor>(StringComparer.Ordinal);

        /// <summary>
        /// 构造并从 <c>&lt;root&gt;/&lt;subdir&gt;/</c> 扫描全量条目进内存。
        /// 目录不存在时静默通过——首次 <see cref="PutAsync"/> 会触发创建。
        /// </summary>
        /// <param name="backend">文件后端（共享）。根目录由调用方注入。</param>
        /// <param name="subdir">落盘子目录名，默认 "workflows"。</param>
        public FileWorkflowStore(FileBackend backend, string subdir = DefaultSubDir)
        {
            _storage = backend ?? throw new ArgumentNullException(nameof(backend));
            if (string.IsNullOrWhiteSpace(subdir))
                throw new ArgumentException("subdir 不能为空。", nameof(subdir));
            _subdir = subdir;

            LoadFromDisk();
        }


        #region FileWorkflowStore 公共方法

        public Task<WorkflowDescriptor?> GetAsync(string id, CancellationToken ct = default)
        {
            ct.ThrowIfCancellationRequested();
            if (string.IsNullOrWhiteSpace(id)) return Task.FromResult<WorkflowDescriptor?>(null);
            lock (_gate)
            {
                return Task.FromResult<WorkflowDescriptor?>(
                    _entries.TryGetValue(id, out var d) ? d : null);
            }
        }

        public Task<IReadOnlyList<WorkflowDescriptor>> ListAsync(CancellationToken ct = default)
        {
            ct.ThrowIfCancellationRequested();
            lock (_gate)
            {
                return Task.FromResult<IReadOnlyList<WorkflowDescriptor>>(
                    _entries.Values.ToList());
            }
        }

        public Task PutAsync(WorkflowDescriptor descriptor, CancellationToken ct = default)
        {
            ct.ThrowIfCancellationRequested();
            if (descriptor == null) throw new ArgumentNullException(nameof(descriptor));

            lock (_gate)
            {
                _entries[descriptor.Id] = descriptor;
                PersistEntry(descriptor);
            }

            return Task.CompletedTask;
        }

        public Task DeleteAsync(string id, CancellationToken ct = default)
        {
            ct.ThrowIfCancellationRequested();
            if (string.IsNullOrWhiteSpace(id)) return Task.CompletedTask;

            lock (_gate)
            {
                if (_entries.Remove(id))
                    _storage.Delete(EntryPath(id));
            }

            return Task.CompletedTask;
        }

        #endregion

        #region 内部：路径 / 序列化 / 加载

        private string EntryPath(string id) =>
            _storage.ResolveCbimPath(_subdir, id + FileSuffix);

        private void PersistEntry(WorkflowDescriptor descriptor)
        {
            var dto = WorkflowDto.From(descriptor);
            string json = JsonSerializer.Serialize(dto, JsonOptions);
            _storage.WriteAtomic(EntryPath(descriptor.Id), json);
        }

        private void LoadFromDisk()
        {
            string probe = EntryPath("__probe");
            string dir = Path.GetDirectoryName(probe);
            if (string.IsNullOrEmpty(dir) || !Directory.Exists(dir)) return;

            foreach (var file in Directory.EnumerateFiles(dir, "*" + FileSuffix, SearchOption.TopDirectoryOnly))
            {
                var loaded = TryLoadEntry(file);
                if (loaded != null) _entries[loaded.Id] = loaded;
            }
        }

        private WorkflowDescriptor? TryLoadEntry(string path)
        {
            string json = _storage.ReadOrNull(path);
            if (string.IsNullOrEmpty(json)) return null;

            try
            {
                var dto = JsonSerializer.Deserialize<WorkflowDto>(json, JsonOptions);
                return dto?.ToDescriptor();
            }
            catch (JsonException)
            {
                // 损坏文件静默跳过——避免一个坏文件阻塞整个 store 启动。
                return null;
            }
            catch (ArgumentException)
            {
                // DTO 字段缺失被构造器拒绝时也走这里。
                return null;
            }
            catch (InvalidOperationException)
            {
                // NeuralCircuitBuilder.Commit 校验失败（图结构损坏）时也静默跳过。
                return null;
            }
        }

        #endregion

        #region 落盘 DTO
        /// <summary>
        ///序列化方案：NeuralCircuit 是多态运行时对象，CircuitNode 抽象基类派生三类型。
        ///不做直接 JSON 多态序列化（避免引入 JsonDerivedType / TypeDiscriminator 到 .NET 6+ 限定特性）。
        ///改为存储构建参数：
        ///  - NodeDto 含 kind 鉴别字段（"CallBrain" / "Branch" / "Return" / "CallTool"）
        ///  - EdgeDto 对应 CircuitEdge 三字段
        ///  - 反序列化时逐一调用 NeuralCircuitBuilder.Add*，最终 Commit 重建 NeuralCircuit
        ///优势：完整保留 Commit 校验（连通性 / 无环 / BranchNode 出度），存档 + 恢复语义一致。
        /// </summary>
        private sealed class WorkflowDto
        {
            public string Id { get; set; }
            public string Name { get; set; }
            public string Description { get; set; }
            public CircuitDto Circuit { get; set; }

            public static WorkflowDto From(WorkflowDescriptor d) => new WorkflowDto
            {
                Id = d.Id,
                Name = d.Name,
                Description = d.Description,
                Circuit = CircuitDto.From(d.Circuit),
            };

            public WorkflowDescriptor ToDescriptor()
            {
                var circuit = Circuit?.ToCircuit()
                              ?? throw new ArgumentException("WorkflowDto.Circuit 不能为 null。");
                return new WorkflowDescriptor(Id, Name, Description, circuit);
            }
        }

        private sealed class CircuitDto
        {
            /// <summary>
            /// Circuit Id（Guid 字符串）——重建时直接透传给 NeuralCircuitBuilder。
            /// </summary>
            public string CircuitId { get; set; }

            /// <summary>
            /// 原始 user NL。
            /// </summary>
            public string SourceRequest { get; set; }

            /// <summary>
            /// 节点有序列表——顺序即 Builder 的 Add 调用顺序，第一个节点为 StartNode。
            /// </summary>
            public List<NodeDto> Nodes { get; set; }

            /// <summary>
            /// 边列表。
            /// </summary>
            public List<EdgeDto> Edges { get; set; }

            public static CircuitDto From(NeuralCircuit c)
            {
                var nodes = new List<NodeDto>(c.Nodes.Count);
                foreach (var node in c.Nodes)
                    nodes.Add(NodeDto.From(node));

                var edges = new List<EdgeDto>(c.Edges.Count);
                foreach (var edge in c.Edges)
                    edges.Add(EdgeDto.From(edge));

                return new CircuitDto
                {
                    CircuitId = c.CircuitId,
                    SourceRequest = c.SourceRequest,
                    Nodes = nodes,
                    Edges = edges,
                };
            }

            public NeuralCircuit ToCircuit()
            {
                if (string.IsNullOrWhiteSpace(CircuitId))
                    throw new ArgumentException("CircuitDto.CircuitId 不能为空。");
                if (string.IsNullOrWhiteSpace(SourceRequest))
                    throw new ArgumentException("CircuitDto.SourceRequest 不能为空。");
                if (Nodes == null || Nodes.Count == 0)
                    throw new ArgumentException("CircuitDto.Nodes 不能为空。");

                var builder = new NeuralCircuitBuilder(CircuitId, SourceRequest);

                // 先按顺序添加所有节点（顺序决定 StartNodeId = _nodes[0]）。
                foreach (var nodeDto in Nodes)
                    nodeDto.ApplyTo(builder);

                // 再添加所有边（节点必须先存在才能连边，Builder.AddEdge 即时校验）。
                if (Edges != null)
                {
                    foreach (var edgeDto in Edges)
                        builder.AddEdge(edgeDto.FromNodeId, edgeDto.ToNodeId, edgeDto.BranchLabel);
                }

                return builder.Commit();
            }
        }

        private sealed class NodeDto
        {
            /// <summary>节点类型鉴别符：CallBrain | Branch | Return | CallTool。</summary>
            public string Kind { get; set; }

            // 通用字段（所有节点共有）
            public string NodeId { get; set; }
            public string Label { get; set; }

            // CallBrain 专属
            public string TargetBrainId { get; set; }
            public string Intent { get; set; }
            public string StructuredInputJson { get; set; }
            public string ModuleIdsJson { get; set; }

            // Branch 专属
            public string ConditionExpression { get; set; }

            // Return 专属
            public string SummaryTemplate { get; set; }

            // CallTool 专属
            public string ToolName { get; set; }
            public string ArgsJson { get; set; }

            public static NodeDto From(CircuitNode node)
            {
                switch (node)
                {
                    case CallBrainNode cb:
                        return new NodeDto
                        {
                            Kind = "CallBrain",
                            NodeId = cb.NodeId,
                            Label = cb.Label,
                            TargetBrainId = cb.TargetBrainId,
                            Intent = cb.Intent,
                            StructuredInputJson = cb.StructuredInputJson,
                            ModuleIdsJson = cb.ModuleIdsJson,
                        };
                    case BranchNode bn:
                        return new NodeDto
                        {
                            Kind = "Branch",
                            NodeId = bn.NodeId,
                            Label = bn.Label,
                            ConditionExpression = bn.ConditionExpression,
                        };
                    case ReturnNode rn:
                        return new NodeDto
                        {
                            Kind = "Return",
                            NodeId = rn.NodeId,
                            Label = rn.Label,
                            SummaryTemplate = rn.SummaryTemplate,
                        };
                    case CallToolNode ct:
                        return new NodeDto
                        {
                            Kind = "CallTool",
                            NodeId = ct.NodeId,
                            Label = ct.Label,
                            ToolName = ct.ToolName,
                            ArgsJson = ct.ArgsJson,
                        };
                    default:
                        throw new InvalidOperationException(
                            $"NodeDto.From：未知节点类型 '{node.GetType().Name}'——需为此类型补充序列化支持。");
                }
            }

            /// <summary>将本节点还原到 builder，并验证 NodeId 与 Builder 分配序列一致。</summary>
            public void ApplyTo(NeuralCircuitBuilder builder)
            {
                string allocated;
                switch (Kind)
                {
                    case "CallBrain":
                        // ModuleIdsJson 为 null 时（旧档案缺字段）走 Builder 默认值 = null，
                        // 与 CallBrainNode 构造期 fail-hard 默认（无文件操作权限）一致。
                        allocated = builder.AddCallBrain(Label, TargetBrainId, Intent, StructuredInputJson,
                            ModuleIdsJson);
                        break;
                    case "Branch":
                        allocated = builder.AddBranch(Label, ConditionExpression);
                        break;
                    case "Return":
                        allocated = builder.AddReturn(Label, SummaryTemplate);
                        break;
                    case "CallTool":
                        // CallToolNode 在 v1 是占位类型，Builder 尚未开放 AddCallTool 入口。
                        // 若持久化了 CallTool 节点（由未来版本写入），此处抛出明确错误而非静默丢弃。
                        throw new InvalidOperationException(
                            $"NodeDto.ApplyTo：CallTool 节点（NodeId='{NodeId}'）在当前版本不支持重建——" +
                            "Builder 尚未开放 AddCallTool 入口。");
                    default:
                        throw new InvalidOperationException(
                            $"NodeDto.ApplyTo：未知节点类型 Kind='{Kind}'。");
                }

                // 校验 Builder 分配的 NodeId 与存档一致——如果不一致说明序列化顺序有误或存档损坏。
                if (!StringComparer.Ordinal.Equals(allocated, NodeId))
                    throw new InvalidOperationException(
                        $"NodeDto.ApplyTo：NodeId 不一致——存档为 '{NodeId}'，Builder 分配为 '{allocated}'。" +
                        "节点顺序可能已损坏。");
            }
        }

        private sealed class EdgeDto
        {
            public string FromNodeId { get; set; }
            public string ToNodeId { get; set; }
            public string BranchLabel { get; set; }

            public static EdgeDto From(CircuitEdge edge) => new EdgeDto
            {
                FromNodeId = edge.FromNodeId,
                ToNodeId = edge.ToNodeId,
                BranchLabel = edge.BranchLabel,
            };
        }

        #endregion
    }
}