# CBIM V2 架构封板摘要

## 核心命题

CBIM V2 的核心命题不是“更好的提示词工程”，也不是单纯的“上下文最小化”，而是：

**CBIM = Capability-Business Independence + Memory。**

- **Capability（能力）**：可跨项目复用的专业能力与加工方式，运行时由 agent / 脑区承载。
- **Business（业务）**：当前项目特有的模块结构、契约、依赖、规则和历史决策，运行时由 workspace / project 承载。
- **Independence（独立性）**：能力和业务正交建模、独立演化、按任务动态组合。
- **Memory（记忆）**：记录能力与业务的历史映射、经验沉淀和演化结果，防止二者长期失配。

V2 把 V1 中靠 CLAUDE.md 让 LLM 自行决定调度的概率性逻辑，固化为 C# 状态机 + 规则表 + 强类型工具协议的确定性调度。这个调度层不是目标本身，而是为了在运行时稳定完成“需求片段 + 对应能力 + 目标业务模块 + 相关记忆”的组合。上下文最小化是该组合成立后的结果。

## 设计哲学（硬件比喻）

| 硬件层 | CBIM 语义层 | 物理特征 |
|--------|-------------|----------|
| CPU 寄存器 / L1 Cache | Active Context Window | 极昂贵、极小，LLM 当前轮次能触达的"思维空间" |
| L2/L3 Cache Controller | CBIM 运行时引擎 | 根据能力、业务与记忆做调度、寻址、预取、换入换出 |
| 物理 RAM | 能力注册 + .dna/ 业务契约知识 + 短中期记忆 | 晶体化提炼的高密度索引 |
| 外部冷源磁盘 | 项目 src/ 原始源码 | 海量、嘈杂、无语义索引；Cache Miss 才允许降级盲扫 |

## 程序集清单（8 个）

| 程序集 | 硬件比喻 | 职责 |
|--------|----------|------|
| CBIM.Contracts | — | 纯接口/记录/枚举，无逻辑 |
| CBIM.CacheController | L2/L3 Controller | 调度 + 语义分页 + 内置 agent 逻辑（coordinator/architect/HR/auditor 内化于此） |
| CBIM.PageStore | RAM | CBIM 所有结构化内容统一持有者（DNA + Agents + 短/中期记忆） |
| CBIM.Processor | Execution Unit | 自实现 agent 运行循环（Perceive → Think → Act → Observe → Stop） |
| CBIM.DiskAccess | Disk Controller | 物理工作区网关（Read/Edit/Write/Bash/Grep）+ 权限矩阵 |
| CBIM.Foundation.Llm | — | 多 Provider LLM 抽象（Anthropic/OpenAI/本地） |
| CBIM.Foundation.Storage | I/O Bus | 原子文件写，服务长期记忆（DNA/Agents） |
| CBIM.Foundation.Memory | Memory Bus | 短/中期记忆后端抽象（默认 FileBackend，可扩展 Vector/Graph） |
| CBIM.UI.Avalonia | Monitor | Avalonia 桌面 UI |

## 依赖方向（无环）

```
UI.Avalonia
    ↓
CacheController ──→ Processor ──→ DiskAccess
    ↓                   ↓
PageStore         Foundation.Llm
    ├──→ Foundation.Storage  (DNA/Agents)
    └──→ Foundation.Memory   (短/中期记忆)

所有模块 ──→ Contracts
```

## 七条关键设计约束

1. **能力与业务正交**：能力不写死业务归属，业务不塞进能力提示词；二者只在运行时按任务组合。
2. **脑区承载能力**：单个 agent 是完整认知体，内部按加工方式拆分脑区；脑区不是 team 的退化形态。
3. **workspace 承载业务**：项目知识外化为 `.dna/` 模块树；每次工作定位到具体业务节点及其直接契约。
4. **Memory 是对齐层**：短/中期经验、长期身份、业务档案和 Dream 沉淀共同维护能力与业务的历史映射。
5. **控制流外化**：流程不藏在提示词里，编译为 NeuralCircuit / Workflow，由确定性引擎执行。
6. **写权限闸门**：物理文件入口必须走受控工具、权限矩阵和路径白名单；LLM 不直接拥有自由写权。
7. **取代 V1**：V2 独立运行，知识库路径 `.cbim/`，不绑 V1；沿用 `.dna/` 和 memory 物理资产。

## V1↔V2 衔接

- **沿用**：`.dna/` 物理格式（YAML frontmatter + markdown）、`memory/` 格式
- **取代**：Claude Code 宿主、CLAUDE.md 调度规约、Python engine、`.claude/agents/*.md` 格式
- **迁移**：快速切换，不做双写校验过渡
