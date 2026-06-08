using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.AI;
using CBIM.Storage;

namespace CBIM.AgentSystem
{
    /// <summary>
    /// AgentManager 服务（能力维度门面）——CBIM 能力侧的总入口。
    /// 1 管理AgentDescription， 这是员工花名册， 对外提供CRUD能力
    /// 2 负责创建/销毁Agent的实例，管理实例的生命周期，对外提供接口
    /// </summary>
    public sealed class AgentManager : IAgentSystemSessionWriter
    {
        private const string SessionsRelDir = ".cbim/agentsystem/sessions";

        private static readonly JsonSerializerOptions JsonOptions = new JsonSerializerOptions
        {
            WriteIndented = false,
        };

        private static readonly UTF8Encoding Utf8NoBom = new UTF8Encoding(false);

        private readonly Dictionary<string, AgentDescription> _descriptions;
        private readonly Dictionary<Guid, Agent> _activeInstances;
        private readonly IChatClientFactory _chatClientFactory;
        private readonly FileBackend _fileBackend;
        private readonly object _instancesLock = new object();
        private readonly object _sessionLock = new object();
        
        /// <summary>
        /// 构造 AgentSystem（所有脑区共用一个 IChatClient——向下兼容）。
        /// </summary>
        public AgentManager(IEnumerable<AgentDescription> descriptions, IChatClient chatClient, FileBackend fileBackend)
            : this(descriptions, new SingleChatClientFactory(chatClient), fileBackend)
        {
        }

        /// <summary>
        /// 构造 AgentSystem（按脑区路由不同 IChatClient——通过 IChatClientFactory 实现）。
        /// </summary>
        public AgentManager(IEnumerable<AgentDescription> descriptions, IChatClientFactory chatClientFactory, FileBackend fileBackend)
        {
            if (descriptions == null) throw new ArgumentNullException(nameof(descriptions));
            if (chatClientFactory == null) throw new ArgumentNullException(nameof(chatClientFactory));

            _descriptions = new Dictionary<string, AgentDescription>();
            foreach (var agentDescription in descriptions)
            {
                if (_descriptions.ContainsKey(agentDescription.Id))
                    throw new ArgumentException($"AgentDescription.Id 重复：{agentDescription.Id}", nameof(descriptions));
                _descriptions[agentDescription.Id] = agentDescription;
            }

            _chatClientFactory = chatClientFactory;
            _fileBackend = fileBackend;
            _activeInstances = new Dictionary<Guid, Agent>();
        }

        // ===== 静态侧：AgentDescription 注册表 =====

        /// <summary>列出全部已注册的 AgentDescription。</summary>
        public IReadOnlyList<AgentDescription> ListDescriptions()
        {
            return new List<AgentDescription>(_descriptions.Values);
        }

        /// <summary>按 Id 找 AgentDescription。找不到返 null。</summary>
        public AgentDescription GetDescription(string id)
        {
            if (string.IsNullOrWhiteSpace(id)) return null;
            return _descriptions.TryGetValue(id, out var d) ? d : null;
        }

        /// <summary>判断指定 Id 的 AgentDescription 是否已注册。</summary>
        public bool ContainsDescription(string id) =>
            !string.IsNullOrWhiteSpace(id) && _descriptions.ContainsKey(id);

        /// <summary>
        /// 双轨装配——按 BrainConfig 编织 N 个脑区。
        /// </summary>
        public Agent NewAgent(string descriptionId)
        {
            if (string.IsNullOrWhiteSpace(descriptionId))
                throw new ArgumentException("descriptionId 不能为空", nameof(descriptionId));

            var description = GetDescription(descriptionId);
            if (description == null)
                throw new ArgumentException($"未找到 AgentDescription: {descriptionId}", nameof(descriptionId));
            
            var agent = new Agent(this, description);
            lock (_instancesLock)
            {
                _activeInstances[agent.id] = agent;
            }
            return agent;
        }

        public INeuron CreateNeuron(BrainDescriptor descriptor)
        {
            return null;
        }

        public void DestroyNeuron(INeuron neuron)
        {
            
        }
        
        /// <summary>
        /// 关闭一个 Agent：释放其持有的脑区 / Memory / MCP / Session。
        /// </summary>
        public void Destroy(Agent agent)
        {
            if (agent == null) return;

            lock (_instancesLock)
            {
                _activeInstances.Remove(agent.id);
            }

            agent.Dispose();
        }

        /// <summary>列出当前活动中的 Agent（已 OpenInstance 但未 Close）。</summary>
        public IReadOnlyList<Agent> ListAgents()
        {
            lock (_instancesLock)
            {
                return new List<Agent>(_activeInstances.Values);
            }
        }

        /// <summary>按 InstanceId 查活动实例。找不到返 null。</summary>
        public Agent GetAgent(Guid guid)
        {
            lock (_instancesLock)
            {
                return _activeInstances.TryGetValue(guid, out var agent) ? agent : null;
            }
        }

        // ===== Session 写侧（IAgentSystemSessionWriter） =====

        /// <inheritdoc />
        public void AppendSessionEvent(string guid, SessionEvent ev)
        {
            if (string.IsNullOrWhiteSpace(guid))
                throw new ArgumentException("instanceId 不能为空", nameof(guid));
            if (ev == null)
                throw new ArgumentNullException(nameof(ev));
            EnsureFileBackend();

            string envelope = SerializeEnvelope(ev);
            string path = ResolveSessionPath(guid);

            lock (_sessionLock)
            {
                _fileBackend.AppendLine(path, envelope);
            }
        }

        /// <inheritdoc />
        public IReadOnlyList<SessionEvent> ReadSessionTail(string guid, int n)
        {
            if (string.IsNullOrWhiteSpace(guid))
                throw new ArgumentException("guid 不能为空", nameof(guid));
            if (n <= 0) return Array.Empty<SessionEvent>();
            EnsureFileBackend();

            string path = ResolveSessionPath(guid);
            if (!_fileBackend.Exists(path)) return Array.Empty<SessionEvent>();

            // 末 N 行：先 ring-buffer 收集所有行（jsonl 每实例文件通常不会很大；
            // 若未来出现 GB 级文件，再切换为反向流式读取）。
            var ring = new string[n];
            int count = 0, head = 0;

            lock (_sessionLock)
            {
                using (var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite))
                using (var sr = new StreamReader(fs, Utf8NoBom))
                {
                    string line;
                    while ((line = sr.ReadLine()) != null)
                    {
                        if (line.Length == 0) continue;
                        ring[head] = line;
                        head = (head + 1) % n;
                        count++;
                    }
                }
            }

            int kept = Math.Min(count, n);
            int start = count > n ? head : 0;
            var result = new List<SessionEvent>(kept);
            for (int i = 0; i < kept; i++)
            {
                string line = ring[(start + i) % n];
                var ev = TryDeserializeEnvelope(line);
                if (ev != null) result.Add(ev);
            }
            return result;
        }

        private void EnsureFileBackend()
        {
            if (_fileBackend == null)
                throw new InvalidOperationException(
                    "Session 落盘需注入 FileBackend——请使用带 FileBackend 的 AgentSystem 构造重载。");
        }

        private string ResolveSessionPath(string instanceId)
        {
            // FileBackend.ResolveCbimPath 仅按段拼接，目录由其内部 EnsureParent 创建。
            return _fileBackend.ResolveCbimPath(SessionsRelDir, instanceId + ".jsonl");
        }

        // ===== Envelope 序列化：{"type":"LlmCall","data":{...}} =====
        // 用显式 switch 派发避免依赖 System.Text.Json 多态特性（跨版本稳定）。

        private static string SerializeEnvelope(SessionEvent ev)
        {
            string typeName;
            string dataJson;
            switch (ev)
            {
                case UserInputEvent e:
                    typeName = "UserInput";
                    dataJson = JsonSerializer.Serialize(e, JsonOptions);
                    break;
                case LlmCallEvent e:
                    typeName = "LlmCall";
                    dataJson = JsonSerializer.Serialize(e, JsonOptions);
                    break;
                case ToolInvocationEvent e:
                    typeName = "ToolInvocation";
                    dataJson = JsonSerializer.Serialize(e, JsonOptions);
                    break;
                case OutputEvent e:
                    typeName = "Output";
                    dataJson = JsonSerializer.Serialize(e, JsonOptions);
                    break;
                case ErrorEvent e:
                    typeName = "Error";
                    dataJson = JsonSerializer.Serialize(e, JsonOptions);
                    break;
                default:
                    throw new NotSupportedException(
                        $"未知 SessionEvent 子类型：{ev.GetType().FullName}——请在 SerializeEnvelope/TryDeserializeEnvelope 同步登记。");
            }
            // 手拼 envelope 避免再分配一个 wrapper 对象。
            return "{\"type\":\"" + typeName + "\",\"data\":" + dataJson + "}";
        }

        private static SessionEvent TryDeserializeEnvelope(string line)
        {
            try
            {
                using var doc = JsonDocument.Parse(line);
                var root = doc.RootElement;
                if (!root.TryGetProperty("type", out var typeProp)) return null;
                if (!root.TryGetProperty("data", out var dataProp)) return null;
                string typeName = typeProp.GetString();
                if (string.IsNullOrEmpty(typeName)) return null;
                string dataJson = dataProp.GetRawText();

                switch (typeName)
                {
                    case "UserInput":
                        return JsonSerializer.Deserialize<UserInputEvent>(dataJson, JsonOptions);
                    case "LlmCall":
                        return JsonSerializer.Deserialize<LlmCallEvent>(dataJson, JsonOptions);
                    case "ToolInvocation":
                        return JsonSerializer.Deserialize<ToolInvocationEvent>(dataJson, JsonOptions);
                    case "Output":
                        return JsonSerializer.Deserialize<OutputEvent>(dataJson, JsonOptions);
                    case "Error":
                        return JsonSerializer.Deserialize<ErrorEvent>(dataJson, JsonOptions);
                    default:
                        return null;   // 未知类型跳过——单行坏数据不拖垮整次读取
                }
            }
            catch (JsonException)
            {
                return null;   // 单行 JSON 损坏直接跳过
            }
        }
    }
}
