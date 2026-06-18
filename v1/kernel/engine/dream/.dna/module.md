---
name: dream-engine
owner: architect
description: CBIM 治理循环驱动：独立治理根树 + 黑板 + trace，SessionStart 补跑驱动，不抢热路径
keywords:
  - governance
  - dream-tick
  - second-root
  - sessionstart
  - idempotent
  - catchup
dependencies:
  - kernel/engine/core
  - kernel/engine/persistence
  - kernel/engine/retrieval
  - kernel/memory
  - kernel/engine/audit
status: implemented
---

## Positioning

CBIM **第二个根循环**的驱动引擎，与执行循环（`engine/execution`）平级共存——不是其子循环、不是其装饰器、不是其插件。两根共享 `engine/core` 的 Node ABC / Composite / Decorator / Runner / 持久化 / trace 原语，但持有各自独立的根树拓扑（DreamRoot）、独立的黑板 schema（8 字段）、独立的 trace、独立的 MCP 入口工具。

**驱动者非参与者**：本模块**驱动**三个治理子循环（主 agent 记忆治理 / Architect 治理模式 / HR 治理模式），自身不参与任何业务循环、不与用户对话、不调 Work Agent、不调 Auditor。

**对应文档**：[`design/WORKFLOW-DREAM.zh-CN.md`](../../../../../design/WORKFLOW-DREAM.zh-CN.md)（治理循环语义、触发机制、树拓扑、黑板 schema、失败哲学）。本 .dna 不复述设计稿——只固化“对外是什么、对内由谁负责、谁也别想破窗”。

**它不是什么**：

| 误解 | 澄清 |
|------|------|
| `engine/execution` 的子模块 | 不是。是平级第二根，与 execution 共享 `engine/core` 但各持独立根树；两根互不依赖，都依赖 `engine/core`。 |
| cron / 定时器 | 不是。无内置时钟，仅在 SessionStart 检测“距上次成功 ≥ 20 小时”才补跑。 |
| 夜间常驻守护进程 | 不是。零后台进程；每次 tick 跑完即退，状态全在 `.cbim/scheduler/dream/`。 |
| 主动改代码 / 删模块的自动化机器人 | 不是。治理模式只做安全幂等动作（时间戳更新、记忆压缩、索引重建、归类建议）；危险动作（归档模块、招募 agent、改契约）只产建议落到 report.md。 |
| 阻塞用户的后台任务 | 不是。用户 prompt 立即让位——RUNNING 节点归档为“abandoned”，明天再跑。 |

## Sub-module Relationships

```mermaid
flowchart TB
    subgraph DREAM["kernel/engine/dream（本模块）"]
        direction TB
        Tree["tree/<br/>DreamRoot 构造器（Sequence + SequenceTolerant）"]
        Actions["actions/<br/>Init / Mem*Step / TranscriptScan / DistillGate / DispatchMemDistill / CollectMemDistill / TranscriptDelete / IncomingScan / DispatchIncomingTriage / CollectIncomingTriage / MemPromoteScan / DispatchArchGovern / DispatchHRGovern / CollectArchAdvice / CollectHRAdvice / BaselineBurndown / EmitReport / Finalize"]
        Loops["loops/<br/>memory_distill_governance / incoming_triage_governance / architect_governance / hr_governance —— prompt 渲染 + dispatch_result 解析"]
        Api["api/<br/>dream_tick · dream_tick_resume · dream_list_runs · dream_abort · DreamResult"]
    end

    Core[("engine/core<br/>Node ABC · Composite · Decorator · Runner · Blackboard")]
    Persist[("engine/persistence<br/>bb.json · resume.json · trace.jsonl")]
    MainAgent[("主 Agent（Task tool + memory_distill skill + incoming_triage skill）")]
    Memory[("kernel/memory<br/>compact · sweep_expired · HealthChecker · candidates · incoming队列")]
    Retrieval[("engine/retrieval<br/>verify_consistency(mode=full)<br/>index_delete(\"transcript\", …)")]
    Audit[("engine/audit<br/>BaselineStore.load() 只读")]
    Transcripts[("~/.claude/projects/&lt;slug&gt;/*.jsonl")]
    IncomingDir[("<store>/medium/incoming/<br/>YYYY-MM-DD.jsonl + processed/")]
    MCP[("mcp_server<br/>容器")]

    MCP --> Api
    MainAgent <-->|yield / resume| Api
    Api --> Tree
    Tree --> Core
    Tree --> Actions
    Actions --> Core
    Actions --> Loops
    Core --> Persist
    Actions -.->|MemHealthScan/MemCompact/MemSweepExpired/MemPromoteScan| Memory
    Actions -.->|MemRebuildIndex| Retrieval
    Actions -.->|TranscriptScan 读 mtime| Transcripts
    Actions -.->|DispatchMemDistill yield main| MainAgent
    Actions -.->|TranscriptDelete| Transcripts
    Actions -.->|TranscriptDelete 同步 index_delete| Retrieval
    Actions -.->|IncomingScan 读 / CollectIncomingTriage os.replace| IncomingDir
    Actions -.->|DispatchIncomingTriage yield main| MainAgent
    Actions -.->|BaselineBurndown lazy import| Audit
```

**子模块关系**：

| 关系 | 方向 | 说明 |
|------|------|------|
| `tree` → `engine/core` + `actions` | 静态拼装 | `tree/dream_loop.py` 用 `Sequence(...)` `SequenceTolerant(...)` `@Trace @Timeout @Catch` 拼出根树；不参与运行时 |
| `actions` → `engine/core` | 实现 `Node` ABC | 每个 Action 是 `engine.core.Node` 的子类，签名 `tick(bb) -> Status`；需要派 Architect / HR / 主 agent 的 Action 额外实现 `on_resume(bb, payload)` |
| `actions` → `loops` | prompt 渲染 + payload 解析 | `dispatch_*` 叶调 `loops.<x>_governance.compose_prompt(...)` 拼 prompt；`collect_*` 叶调 `loops.<x>_governance.parse_response(...)` 解析主 agent 返回。治理 prompt / parse 逻辑集中在 `loops/`、与树拓扑解耦 |
| `api` → `tree` + `engine/core` + `engine/persistence` | 入口启动 / 恢复 | `dream_tick` 读 `build_dream_root()` 启 Runner；`dream_tick_resume` 调 `persistence.snapshot.read_bb / read_resume` 后由 Runner 按 `runner_resume_path` 重建栈 |
| 持久化 | **复用 engine/persistence** | 不自建持久化子模块；路径前缀由 `api/dream_tick.py` 注入为 `.cbim/scheduler/dream/<run_id>/`；文件格式与执行循环一致 |
| `actions` → `memory`（内部维护接口） | in-process 调用 | `MemHealthScan` / `MemCompact` / `MemSweepExpired` 调 `memory.HealthChecker.check()` / `memory.compact()` / `memory.sweep_expired()`；`MemPromoteScan` 调 `memory.compaction.scan_for_promote_candidates()` + `CandidatesArea.pull_pending()` 两动作；不走 MCP |
| `actions` → `engine/retrieval` | in-process 调用 | `MemRebuildIndex` 调 `retrieval.verify_consistency("memory_medium", mode="full")`；`TranscriptDelete` 删原件后同步调 `retrieval.index_delete("transcript", doc_id)` |
| `actions` → `engine/audit`（lazy import） | in-process 调用 | `BaselineBurndown` 采用延迟导入调 `BaselineStore.load()` 读已接受的棘轮项，结果拼入 `arch_governance_report.advice_pending`。只读；accept/save/clear 不调。项目未初始化 baseline / 文件损坏 / 任何 I/O 异常 → 返回空列表优雅降级，不中断 dream tick |
| `actions` → `~/.claude/projects/<slug>/*.jsonl`（外部文件系统） | 只读 mtime + 删除文件 | `TranscriptScan` 扫描该目录拉出 mtime 超 1 天的 JSONL 列表；`TranscriptDelete` 在蒸馏成功后删原件。文件内容本身由主 agent（被 DispatchMemDistill yield 上来的）亲自读 |
| `actions` → `<store>/medium/incoming/`（Stage 5 新增） | 只读 + 原子移动 | `IncomingScan` 扫描前一日及更早的 `YYYY-MM-DD.jsonl`；`CollectIncomingTriage` 处理完成后用 `os.replace` 将 `processed_paths` 原子移到 `incoming/processed/`。JSONL 内容由主 agent（被 DispatchIncomingTriage yield 上来的）亲自读 |
| `actions` → MainAgent（yield） | 协程式 yield/resume | Architect / HR / 主 agent（记忆蒸馏 / incoming 治理）派工一律走 `DreamResult.Yield(DispatchRequest)` → 主 agent Task tool / 主 agent 自执行 → `dream_tick_resume` 路径；引擎进程内**不**持有 Architect / HR / 主 agent 客户端 |

**无循环依赖**——单向自顶向下：`api → tree → {engine/core, actions, loops} → {engine/persistence, memory[内部维护接口 含 candidates / incoming], engine/retrieval[内部维护接口], engine/audit[BaselineStore 只读]}`。`dream` 依赖 `engine/core`、`engine/persistence`、`engine/retrieval` 与 `engine/audit`，不依赖 `execution`；`execution` 也不依赖 `dream`，两根平级、共享 `engine/core` 与 `engine/retrieval`。`dream → audit` 是同层兄弟依赖（都在 `v1/kernel/engine/` 下），audit 不反向依赖 dream——无环。

## Origin Context

CBIM v1 把所有自维护逻辑（记忆压缩、孤立 `.dna/` 清理、闲置 agent 归档）塑进执行循环或提示词角落，结果是：

- **维护被强行塑进关键路径**——用户每次 prompt 都可能因为后台维护慢而被拖；
- **维护节奏不稳定**——执行循环触发频率高低决定维护频率，与维护实际需要的节奏脱节；
- **维护逻辑被切碎**——记忆压缩在记忆服务里、孤立模块清理在 architect 提示词里、agent 归档在 HR 提示词里，没有统一的“自维护通道”。

v2 把所有自维护抽到第二根循环，复用同一个 BT 引擎但独立黑板、独立 trace、独立入口。这就是本模块存在的全部理由。

**为什么和 execution 平级而非套在 execution 之下**：执行循环（用户驱动）和治理循环（scheduler 驱动）承载根本不同的驱动模型。强行合并会让黑板 schema 膨胀且语义混乱；独立两根 = 两份 trace、两份审计边界、清清楚楚。共享 `engine/core` 是因为行为树原语本身没有“用户驱动 / scheduler 驱动”之分；`engine/core` 是 execution 和 dream 共享的平级原语库，不隐含在任一根内部。

## Key Decisions

- **治理循环是 CBIM 第二个根循环，与执行循环平级共存。** 不是子循环、不是装饰器、不是插件。两根共享同一个行为树引擎本体（`engine/core`），但各持独立根树、独立黑板、独立 trace、独立入口工具。`engine/execution` 与 `engine/dream` 互不 import——两根平级、各自依赖 `engine/core`，单向依赖铁律。
- **SessionStart hook 触发，无定时器。** 唯一触发入口是 SessionStart hook 检测"距上次成功治理 ≥ 20 小时"（读 `.cbim/scheduler/dream/last_success.json`），满足则注入系统消息提示主 agent 启动 `dream_tick`。零后台常驻进程，无 cron / systemd 依赖。
- **三步严格串行（记忆 → 知识 → 能力），用 SequenceTolerant 容错。** 三步对共享资源（记忆写锁、`.dna/` 扫描 I/O）有竞争，串行天然规避竞态；夜间任务对延迟不敏感无需并发提速。SequenceTolerant 语义"顺序遍历 + 单步失败不打断后续"——任一步 FAILURE 不阻塞下一步，全 FAILURE 才整体 FAILURE，至少一步 SUCCESS 即整体 SUCCESS。
- **记忆治理步 v2 重设计：输入源从 `.cbim/memory/short/` 改为 `~/.claude/projects/<slug>/` 下的 transcript JSONL。** v1 的记忆治理步是"扫 short 压为 medium"；v2 short 层废弃后，记忆步责任重定为"扫超过 1 天的 CC transcript → 交主 agent 蒸馏为 medium → 蒸馏成功后删原 transcript 文件"。Stage 5 又接上 Phase 4 hook 层的 `<store>/medium/incoming/*.jsonl` 实时捕获队列，多一条 `IncomingScan + DispatchIncomingTriage + CollectIncomingTriage` 三联节点 + `MemPromoteScan` 接通候选消费端。**Sequence 现为 13 节点**；子节点顺序与各节点职责见 `.dna/contract.md` 《MemoryGovernanceStep 子节点拓扑（13 节点）》表。该步全部在主 agent 上下文内完成（`"main"` 例外）不派子 agent——蒸馏 / incoming triage 的输入是记忆源、输出是记忆条目，是记忆源责任人的本能作业，并且 HR 不拥有 `memory_create`。
- **知识 / 能力治理 yield 派 Architect / HR 治理模式（与执行根 ArchGate/CallHR 复用 agent 文件，靠 prompt 模式区分）。** `DispatchArchGovern` / `DispatchHRGovern` 通过 `DreamResult.Yield(dispatch_request)` 让主 agent 用 Task tool 派出 Architect / HR，prompt 头部带 `## 治理模式` token；agent 文件本身与执行循环共用，治理 / 执行模式由 prompt 头部 token 决定。
- **配对出现的 Dispatch + Collect 两个节点，Collect 独家拥有 on_resume。** Architect / HR / 记忆蒸馏 / incoming triage 四对三联节点都是 `Dispatch* + Collect*` 序列；Dispatch 只负责填 `bb.pending_dispatch` 与记 dispatched 标记，Collect 独家拥有 `on_resume(bb, payload)`，按 `loops.<x>_governance.parse_response` 解析后写入 `bb.<x>_result`。两节点职责不重叠，免却 Dispatch 节点同时担 yield 与 parse 两份心智负担。
- **用户 prompt 立即让位，治理 RUNNING 节点归档，明天再跑。** 治理跑到一半用户发来新 prompt，主 agent 立即响应用户，不调 `dream_tick_resume`。引擎在下次 SessionStart 检测到 `current.json` 仍是 running 且心跳超过 30 分钟无更新 → 标记 abandoned 归档；`last_success.json` 未更新 → 20 小时窗口仍成立 → 明天补跑。用户优先是单向硬规则。
- **失败容忍：单步失败不阻塞下一步；产物不回滚。** 治理动作设计为幂等且单调——要么成功推进，要么原样不动，不存在"半成功需要回滚"。`@Catch` 吞掉单步异常写入 `bb.step_results[step]=failure`，`@Timeout(10min)` 触发标记 timeout，全局 `@Timeout(30min)` 熔断后 EmitReport 仍执行（写部分报告） + FinalizeDreamTick 仍执行（20 小时窗口正常滚动）。**TranscriptDelete / CollectIncomingTriage 都是幂等的**：已删 / 已归档的文件下一轮不会被重复扫。
- **治理模式自主权边界：安全动作可执行，危险动作只产建议。** 安全幂等动作（更新时间戳、补字段、记日志、记忆压缩、transcript / incoming 蒸馏、索引重建、incoming 归档）治理模式可自主执行；不可逆 / 高影响动作（归档模块、招募 agent、改契约、删 `.dna/`、**记忆升知识 PROMOTE**）只能写进 `advice_pending` 落到 report.md，由用户下次会话决定是否采纳。
- **治理只做回头式重构，前向式造新归执行子循环。** Architect / HR 治理模式扫已有资产（`.dna/` 注册表、`.claude/agents/` 注册表）做裂变 / 归档 / 合并 / 依赖重组 / 漂移识别；"为满足当前任务而懒式创建新模块 / 招募新 agent"由执行根的 ArchGate / CallHR 节点触发，**不在治理循环范围**。这一刀切清楚后，治理模式才能稳定收敛，不会与执行模式抢工作。

- **`SequenceTolerant` 归属 dream/core、不上提 engine/core（Batch 4 上游决策 + 架构师裁定）。** 查重复代码时曾考虑"抽到 engine/core/composite.py"，裁定上游：不抽。依据是 `bb.step_results` 是 dream blackboard 专属字段（execution 黑板 schema 不拥有该字段），`SequenceTolerant.tick` 必须读写它来实现「跨子节点详状态记录 + resume 幂等跳过」语义。抽到 engine/core 会造成两验中之一：(a) `engine/core` 反向依赖上层 dream 黑板 schema，直接违反 C3；(b) 在 `engine/core/blackboard.py` 中考虑 `step_results` 字段让 execution 也背它。两验都现报废。本次 Batch 4 只去重 `_resume_index` 这个与黑板 schema 无关的底层 helper（提升为 `engine.core.composite.resume_index`）。`SequenceTolerant` 本体仍留 dream/core；它是"能抵受单步失败的顶层治理三步容器"，该语义不是 BT 通用原语。
- **`engine/dream/core/composite_tolerant.py` 中本地 `_Composite` 最小重声明刻意保留。** `engine/core/composite.py::_Composite` 是模块私有名（以 `_` 开头），跨模块 import 会踩进「什么名叫什么」的反向耦合。`SequenceTolerant` 仅需 `__init__` + `children()` 两个方法，实现足够简单，重声明三行在 dream/core 是陶合的代价。判出。未来如 `engine/core` 决定给 `_Composite` 提升为公开基类（去下划线），dream 侧可平滑切换为 `from engine.core.composite import Composite`；在那之前 dream 必须使用本地重声明，不可 `from engine.core.composite import _Composite`。`from engine.core.composite import resume_index` 均为已公开名字的正常 import。

- **Stage 5：IncomingScan + DispatchIncomingTriage + CollectIncomingTriage 三联节点加入 `MemoryGovernanceStep`，位置在 `MemPromoteScan` 之后、`MemCompact` 之前。** Phase 4 hook 层将每轮实时捕获追写到 `<store>/medium/incoming/YYYY-MM-DD.jsonl`（详见 `kernel/project/hooks_src/_lib/incoming_writer.py`）；Stage 5 dream 消费该队列的 prior-day 文件：IncomingScan 拉列表并按 mtime 排序、DispatchIncomingTriage yield 给主 agent 走 LLM 语义二筛与 MUST/WANT/HOW/IS 四象限压缩、CollectIncomingTriage `on_resume` 后用 `os.replace` 将处理成功文件原子移动到 `incoming/processed/`。今日文件刻意不走——hook 仍在追加，只有完全静止的旧日 JSONL 才参与治理。失败安全：业务失败（解析错、report 非 dict、LLM 报 errors）一律写 `bb.incoming_triage_result` 含 `error` 后 SUCCESS 返回，不向上游传 FAILURE——下游 MemCompact / MemSweepExpired / MemRebuildIndex 必须继续。
  - **黑板字段 4 新增**：`bb.incoming_paths`（IncomingScan 单写）、`bb.incoming_triage_dispatched`（IncomingScan 单写）、`bb.incoming_triage_result`（IncomingScan 跳过路径 / CollectIncomingTriage 全部路径写），并 `bb.mem_promote_candidates`（MemPromoteScan 单写）一起让 `core/blackboard.FIELDS` 扩为 28 字段。
  - **主 agent 回执 schema**锁定 `{processed_paths, medium_entries_written, errors}`，产物同时是"medium 记忆条目"与"归档后的 incoming 文件"。incoming 处理完不直接写 `.dna/`——是否进一步 PROMOTE 为知识交给下一步 `MemPromoteScan` + Architect 治理子循环。
  - **拓扑同步两处**：`tree/dream_loop.py::build_dream_root` 与 `loops/memory_governance.py::build_memory_governance_subtree` 同步插入。`MemoryGovernanceStep` 由 10 节点扩为 13 节点。
  - **顺序理由**：放在 promote scan 后是为了让 promote scan 先把上一轮 medium 深处的 rule/flow 候选拉出锁住，本轮 incoming triage 成果落下之后由下一轮 dream tick 的 promote scan 重新处理——两子任务不在同一 tick 内交互。放在 MemCompact 前是为了让本轮新落 medium 的条目同样享受压缩 / sweep / rebuild 的治理后续。

- **Stage 5：MemPromoteScan 不再是"只暂存"，同时负责暴露候选供架构师审议。** 节点原有调 `scan_for_promote_candidates` 暂存 medium 的 rule/flow tagged 条目进 `candidates/`；Stage 5 额外调 `CandidatesArea.pull_pending()` 拉出全部当前候选写 `bb.mem_promote_candidates` 项目黑板字段，由 `loops/architect_governance.compose_prompt(bb)`（单参函数、不接 store_dir）渲染到架构师治理模式 prompt。架构师按条产 PROMOTE / HOLD / REJECT advice，**强制人工门**：PROMOTE 只产 advice 不自动写 `.dna/`，架构师产物落 `arch_governance_report.advice_pending`，最终上届用户决定。该变动让 medium 条目变为知识是一条可见、可审议的路径——与 Stage 4 以后"实时捕获 → dream incoming triage → medium"上游路径拼接后，从原始信号到记忆再到知识的三段道第一次闭环。
- **Batch 7 原决策仍生效**：`MemPromoteScan` 的 `staged` 技人 flag (`promote.enabled`) 默认关闭时 `staged=0` + SUCCESS；随 Stage 5 补上 `pull_pending` 之后，即使 flag 关闭 `pending_count` 也能为 0（无新候选 stage 不造成发出），架构师 prompt 渲染空列表跳过这一节。默认配置下零回归不变。

- **Phase 3 — `MemoryGovernanceStep` 末尾插入 `DnaGraphRebuild` 叶子，mem_seq 由 13 节点扩为 14 节点。** 位置在 `MemRebuildIndex` 之后、sequence 末尾，以保证图谱重建反映的是刚刚被 `verify_consistency("memory_medium")` 调和后的 retrieval 状态。该节点是 **in-process** 叶子（不 yield），调 `cbi._primitives.modules.graph_builder.build_graph(project_root)` 扫全树 `.dna/module.md` 重建 `<root>/.cbim/index/dna/graph.json`；错误被吞下（`return Status.FAILURE`）不中断 sequence。`build_memory_governance_subtree` 复用同一拓扑。选择「放在记忆治理末尾」而非「独立为第四个治理步」的两条理由：(1) graph 是 `dna` 源的索引器副产物，与 BM25/vector 索引同属"同一源的物化产物」，与 MemRebuildIndex 有语义连续性；(2) Architect / HR 治理步是 yield 子 agent 的路径，graph 重建是十几毫秒级 in-process 调用，抽为第四步会多产生一个 Catch+Timeout 包装层但不产生任何语义价值。
- **Phase 3 — “全构 + patch + session_start 兑底”三路径一致性模型。** dream `DnaGraphRebuild` 是全量权威重建（扫全树、重业亘 graph.json）；`services/_reindex.reindex_dna` 末尾调 `patch_graph(root, module_dir)` 只重算被编辑模块的外出边（D9：不级联邻居，被依赖者在自己下次写时会覆盖自己的外出边，最终一致）；`session_start._ensure_graph(root)` 在 graph.json 不存在时调 `build_graph(root)` 兑底。三者共同保证：dream 三个多小时一轮、热路径只 patch 不重建、冷启动能免误退化为空图谱。每条路径都是幂等且最后者获胜。全量重建在 1000 模块规模下“图构造阶段”纯耗时 ~35ms（不含 _scan_modules，后者是跨依赖者共享设施，不计入图谱性能账）。
- **Phase 3 — 依赖方向：`engine/dream → cbi/_primitives/modules/graph_builder`。** `actions/mem_steps.DnaGraphRebuild.tick` 里报 `from cbi._primitives.modules.graph_builder import build_graph`，是跨包 import。`graph_builder` 是 `cbi._primitives.modules` 包中的纯 primitives leaf，不反向 import dream；依赖颓限是包括 retrieval 主的三层：`engine/dream → cbi/_primitives → services/_fm`，零环。Phase 3 不付出任何新 外部依赖」，module.md frontmatter dependencies 不动（主要调用路径仍然经 retrieval；`cbi/_primitives` 是重用 `_scan_modules` 与原子写入，属于「Actions 调轻量并入工具」一类，不进顶级依赖表）。

## Non-Goals

- **不与用户对话。** 治理循环全程在后台运行，Done 不返回 `user_message`；摘要通过 `report.md` 落盘 + 下次 SessionStart 注入主 agent 上下文，被动呈现。
- **不抢占执行循环优先级。** 用户优先是单向硬规则——治理让位用户，用户不让位治理。无任何"治理跑完再响应用户"的语义。
- **不调 Work Agent / 不调 Auditor。** 治理管的是元结构（记忆 / 模块 / agent 注册表），不是业务执行。Work Agent / Auditor 是 Claude Code 提示词配置 agent，CBIM 不为它们设计任何循环（含治理）。
- **不引入夜间常驻守护进程。** 零后台进程、无 cron、无 systemd timer。每次 tick 跑完即退，状态全在 `.cbim/scheduler/dream/`。
- **不复用执行循环黑板。** 黑板 schema 完全独立（8 字段，与执行循环 18 字段无交集），持久化路径物理隔离（`.cbim/scheduler/dream/` vs `.cbim/scheduler/bt/`）。互相不读对方 bb。
- **治理记忆步骤不调 LLM。** `MemoryGovernanceStep` 全程确定性 Python 流程；任何"用 LLM 判断要不要压缩"的写法都是破窗。判断逻辑全在 `memory.HealthChecker` 的硬阈值里。
- **治理子循环不做"为当前任务造新模块 / 招新 agent"。** 这归执行子循环。治理只做回头式重构（裂变 / 归档 / 合并 / 重组）。
- **不升级治理为可交互会话。** Architect / HR 治理模式在子会话内默默跳完全过程后一次性返回全量报告；任何"让治理期间主 agent 补充输入"的设计被明确拒绝——治理是后台自维护，不是多轮对话。

## Outbound

- **v1/kernel/engine/core（复用）** —— Node ABC / Composite / Decorator / Runner / Blackboard 全部复用。`dream/tree/` 构造的根树通过 `engine.core.Runner` 驱动；`dream/actions/` 继承 `engine.core.Node`。是本模块的核心 outbound。
- **v1/kernel/engine/persistence（共享持久化）** —— `engine/core/runner.py` 调 `persistence.snapshot.write_bb` / `write_resume` / `read_bb` / `read_resume`，调 `persistence.trace.append_event`。路径前缀由 `api/dream_tick.py` 注入为 `.cbim/scheduler/dream/<run_id>/`。与执行循环共用同一个持久化模块；磁盘路径隔离、调用者各自注入前缀。
- **v1/kernel/memory/compaction（内部维护接口）** —— `MemCompact` 节点直接 in-process 调用 `memory.compact()`；`MemSweepExpired` 调 `memory.sweep_expired()`。这些是记忆服务的**内部维护接口**，专供治理循环使用，不对外暴露 MCP。**v2 变更**：MemRebuildIndex 不再调 `memory.rebuild_index()`——索引重建上下架到下一项。
- **v1/kernel/memory/_facade（内部维护接口）** —— `MemHealthScan` 直接 in-process 调用 `memory.HealthChecker.check()`，返回候选堆积量、过期条目数等指标供后续子节点判断是否需执行 compact / sweep。
- **v1/kernel/engine/retrieval（内部维护接口）** —— `MemRebuildIndex` 调 `retrieval.verify_consistency("memory_medium", mode="full")` 全量校验与修复；`TranscriptDelete` 在删原件后同步调 `retrieval.index_delete("transcript", doc_id)` 清掉该 transcript 的索引条目。为该依赖进入 dependencies。
- **v1/kernel/engine/audit（同层兄弟·BaselineStore 只读）** —— `BaselineBurndown` Action 采用 lazy import（`from engine.audit import BaselineStore`，仅在 `tick()` 体内导入以保持本模块导入时拓扑干净）调 `BaselineStore.load()` 读已接受的 audit findings，按 check 聚合后产出可读 burn-down 提示拼入 `arch_governance_report.advice_pending`。调用全部只读——`accept()` / `save()` / `clear()` 绝不调用；接受棘轮的动作仅能由人类显式走 `cbim audit baseline clear --yes ...` CLI。项目尚未初始化 baseline / 文件不存在 / 文件损坏 / ImportError / 任何 I/O 异常 → 返回空列表优雅降级，不中断 dream tick。lazy import 只推迟导入时机，不消除耦合；依赖实质仁是 `dream → audit` 同层兄弟，故进入 frontmatter dependencies。该依赖是治理循环「棘轮 burn-down 建议」能力的唯一起点，audit 不反向依赖 dream。
- **主 agent（yield）** —— `DispatchMemDistill` 以 `agent_type="main", subtask_id="governance_memory_distill"` yield；主 agent 收到后不调 Task tool，而是读 prompt 中列出的 transcript 路径、调 `memory_distill` skill 自行蔣骨，然后调 `dream_tick_resume` 回交蔣骨结果。本模块不持有主 agent 客户端。
- **mcp_server（反向，容器）** —— 不在本模块 dependencies 中；`mcp_server` 把 `api/dream_tick.py` 的 4 个函数注册为 MCP 工具，函数签名即工具签名。引擎不感知 MCP 容器存在。

依赖方向：`dream → engine/core`、`dream → engine/persistence`、`dream → memory.{compaction,_facade}`（内部维护接口）、`dream → engine/retrieval`（内部维护接口）、`dream → engine/audit`（同层兄弟·BaselineStore 只读）、`mcp_server → dream`。无环。
