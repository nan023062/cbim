# kernel/engine/dream — 对外契约

> 本契约定义治理循环引擎对外暴露的全部接口。**4 个接口**：2 个驱动入口（`dream_tick` / `dream_tick_resume`）+ 2 个观测/控制辅助（`dream_list_runs` / `dream_abort`）。任何"派 agent / 写黑板 / 读节点内部"的路径都不在本契约——它们要么经协程式 yield/resume 回路、要么归子模块内部。

签名细节以 [`design/WORKFLOW-DREAM.zh-CN.md §二 §四 §五`](../../../../../design/WORKFLOW-DREAM.zh-CN.md) 为准；本文档固化这些签名为公共契约级稳定承诺。

---

## 契约硬约束

| 约束 | 说明 |
|------|------|
| **不暴露黑板字段直接写** | 黑板字段写者由 design §五 表锁定（28 字段，每个字段唯一写者）；外部不能跨过 Action 直接写 bb。需要影响树行为只能通过 `dream_tick(reason)` 入参。 |
| **不返回可执行回调** | `DreamResult.Yield` 只返回数据描述（`DispatchRequest`）；引擎不交出任何"主 agent 调一下就能跑 Action"的函数引用。控制权要么在引擎、要么在主 agent，无中间态。 |
| **接口集稳定，新增走 contract.md 变更流程** | 这 4 个接口签名按公共契约级别管理：新增字段可向后兼容追加，删除/重命名/语义变更需走 contract 变更流程。新增第 5 个接口同走变更流程。 |
| **持久化路径 `.cbim/scheduler/dream/<run_id>/` 是公开契约** | 目录布局、文件名（`bb.json` / `trace.jsonl` / `resume.json` / `report.md` / `current.json` / `last_success.json` / `abandoned.json`）、`bb.json.schema_version` 字段**进入公共契约**——外部观测工具（dashboard / 调试 / 审计回放）依赖这套布局。Schema 升级走 `schema_version` 递增 + 向后兼容读取策略。与 `.cbim/scheduler/bt/<tick_id>/` 物理隔离。 |
| **Action 调子 agent 必须经 yield，不许引擎自派** | 引擎进程内**不**持有"直接调其他 agent 的客户端"。任何 Action 需要派 Architect / HR → `DreamResult.Yield(DispatchRequest)` → 主 agent Task tool → `dream_tick_resume` 回交结果。绕开 Task tool 直派是破窗。**例外 1（in-process 调记忆服务）**：`MemoryGovernanceStep` 中所有纯结构化子节点（`MemHealthScan` / `MemCompact` / `MemPromoteScan` / `MemSweepExpired` / `MemRebuildIndex` / `IncomingScan` / `TranscriptScan` / `DistillGate` / `TranscriptDelete`）直接 in-process 调记忆服务维护接口或文件系统——记忆服务是被动数据层不是 agent，无需 yield。**例外 2（yield 给主 agent 自身）**：MemDistill 与 IncomingTriage 三联节点中的 Dispatch 节点（`DispatchMemDistill` / `DispatchIncomingTriage`）发出 `DispatchRequest(agent_type="main", agent_file=None, subtask_id=...)`，主 agent 不调 Task tool、不派子 agent，而是自行执行对应 skill 后回调 `dream_tick_resume`。子 agent 派工的一切契约（prompt 原样传递、resume schema、Collect leaf 校验）在 `"main"` 路径上一并适用。 |
| **`"main"` 例外适用范围锁定** | `agent_type="main"` 仅限**以记忆为输入产出的治理子任务**，当前两个案例为 `governance_memory_distill`（输入 transcript JSONL、输出 medium 条目）与 `governance_incoming_triage`（输入 medium/incoming 队列 JSONL、输出 medium 条目 + 归档 incoming 文件，归档动作仅是文件移动不涉跨模块写入）。架构治理（`governance_knowledge` → architect）与能力册治理（`governance_capability` → hr）**不**适用此例外，必须经子 agent 派工。新增治理子任务若要复用 `"main"` 走 contract 变更流程、明确表达"该子任务输入仅为记忆"。 |
| **`last_completed_at` 时间戳是去重锁唯一依据** | SessionStart 补跑判定唯一读 `.cbim/scheduler/dream/last_success.json` 的 `finished_at` 字段；20 小时窗口由此字段计算。该字段写入由 `FinalizeDreamTick` 唯一负责；任何外部工具读该字段是只读契约，不得跨过 `FinalizeDreamTick` 直接写。 |

### v2 重设计：记忆蒸馏输入源从 short 改为 transcript

| 约束 | 说明 |
|------|------|
| **`subtask_id="governance_memory_distill"` 的 prompt 样式锁定** | Dispatch 叶必须在 prompt 中传递出超 1 天的 transcript 路径列表（`paths: list[str]`），主 agent 以该列表为唯一蒸馏输入。Prompt 模板归 `actions/dispatch_mem_distill.py` 内部，不进本契约；但"prompt 里带 transcript 路径"这个形状是公共契约。 |
| **主 agent 返回的 dispatch_result schema** | `{"distilled_paths": list[str], "medium_entries_written": list[str], "skipped_paths": list[{path, reason}], "errors": list[str]}`。`distilled_paths` 是蒸馏成功的 transcript 路径，供 `TranscriptDelete` 逐个删除；schema 锁定，新增字段可追加。 |
| **`distilled_paths` 是 TranscriptDelete 的权威输入信号** | `CollectMemDistill` 对 `medium_entries_written` 的存在性校验是**观察性**的——任何校验失败（路径不存在、解析不出来）写入 `bb.transcript_delete_errors`（stage="verify_medium"）作为告警，但**不**清空 `distilled_paths`、**不**阻断 `TranscriptDelete` 的删除动作。理由：transcript 重复进入下一轮蒸馏的代价（重复条目 + 计算浪费）远高于偶发观察性误判的代价；删除决定权由 skill 的 `distilled_paths` 唯一持有，校验只负责留痕。 |
| **TranscriptDelete 只删 `distilled_paths`** | 严禁删"扫描出但蒸馏失败"的 transcript；失败件下轮重试（mtime 依然 > 1 天）。 |
| **蒸馏输出只写 medium，不写 short** | v2 记忆服务不拥有 short 路径；主 agent 在 skill 内调 `memory_write` 只能传递 `tier="medium"`。 |
| **TranscriptDelete 同步调 retrieval.index_delete** | 删原件与清索引同步完成才算单个路径处理成功；retrieval 调用失败该路径进 `transcript_delete_errors`（stage="index_delete"）不中断后续。 |
| **`medium_entries_written` 路径解析允许多策略** | `CollectMemDistill` 在校验 `medium_entries_written` 时按序尝试：(a) 直接绝对路径；(b) `store_dir / raw`（store 相对）；(c) `project_root / raw`（项目根相对，含 `.cbim/memory/...` 形式）；(d) `store_dir / Path(raw).name`（仅 basename）。任一策略命中即视为已落盘——容忍主 agent 在不同上下文下报路径风格不一致。 |

### Stage 5 新增：incoming 队列治理（`governance_incoming_triage`）

| 约束 | 说明 |
|------|------|
| **`subtask_id="governance_incoming_triage"` 输入源锁定** | Dispatch 叶（`DispatchIncomingTriage`）必须在 prompt 中传递出**前一日及更早**的 incoming JSONL 路径列表（`<store>/medium/incoming/YYYY-MM-DD.jsonl`，**当日文件刻意排除**——hook 仍在追加写）。这是 Stage 4 hook 实时捕获队列的消费端；主 agent 以该列表为唯一蒸馏输入，做 LLM 二筛 + 四象限（MUST/WANT/HOW/IS）压缩，落盘为 medium 条目。Prompt 模板归 `actions/dispatch_incoming_triage.py` + `loops/incoming_triage_governance.py` 内部。 |
| **主 agent 返回的 dispatch_result schema** | `{"processed_paths": list[str], "medium_entries_written": list[str], "errors": list[{path, error}]}`。`processed_paths` 是 LLM 处理成功的 incoming JSONL 路径，由 `CollectIncomingTriage` 经 `os.replace` 原子归档到 `<store>/medium/incoming/processed/`；`errors` 列表中的路径**保留在 incoming/ 原位**等下轮重试。schema 锁定，新增字段可追加。 |
| **强制人工门：归档不动 .dna** | 该治理子任务只产 medium 条目 + 归档 incoming 文件，**不**直接写 `.dna/`。本任务与 PROMOTE 路径（架构师审 candidates）解耦——incoming 蒸馏是"原始信号→记忆条目"，是否进一步晋升为知识由后续 MemPromoteScan 暂存 candidates 后由架构师治理子循环判定。 |
| **失败安全：业务失败 SUCCESS 落盘** | `errors` 列表非空 / parse-time error / report 非 dict 等所有业务失败路径，`CollectIncomingTriage.on_resume` 一律写 `bb.incoming_triage_result` 含 `error` 键后**SUCCESS** 返回，不向上游传 FAILURE——下游 MemCompact / MemSweepExpired / MemRebuildIndex 必须继续运行。仅"dispatched 但 on_resume 从未被调用"的引擎内部失败走 FAILURE 路径，由 `@Catch` 装饰器在 step 层吞掉。 |
| **归档目录 `<store>/medium/incoming/processed/` 是公开契约** | 路径布局是 Stage 5 治理产物归档区，dashboard / 用户排查工具可依赖该路径稳定性。归档动作幂等（`FileNotFoundError` 静默跳过，重复归档无害）。归档失败（`os.replace` 抛 OSError）记入 `move_failures` 不中断；`mkdir` 失败则跳过本轮归档（错误进 `incoming_triage_result.error`）但 incoming 文件保留。 |

### Stage 5 新增：MemPromoteScan 接通候选消费端

| 约束 | 说明 |
|------|------|
| **MemPromoteScan 现 `pull_pending` 候选并暴露到 bb** | 节点除调 `scan_for_promote_candidates(store_dir)` 暂存新候选外，**额外**调 `CandidatesArea.pull_pending()` 把当前所有候选写到 `bb.mem_promote_candidates`。架构治理子循环（`ArchitectGovernanceStep`）的 `loops/architect_governance.compose_prompt(bb)` 渲染候选清单到架构师 prompt 中，让架构师在治理模式下逐条产 PROMOTE / HOLD / REJECT 建议。 |
| **强制人工门：PROMOTE 只产 advice 不自动写 .dna** | 候选消费端是"架构师人工审议"——治理循环**不**自动把候选 PROMOTE 写入 `.dna/`。架构师在治理模式下产生 advice 落到 `arch_governance_report.advice_pending`，最终由用户在下次 SessionStart 决定是否采纳走人工 CLI。该硬约束防止治理循环越权写 `.dna/`，把不可逆动作的决断权牢牢锁在用户手里。 |
| **`compose_prompt` 单参签名锁定** | `loops.architect_governance.compose_prompt(bb)` 是单参函数，仅读 `bb.mem_promote_candidates` 等黑板字段渲染 prompt；不接受 `store_dir` 参数。该签名是 `DispatchArchGovern.tick` 的稳定调用契约。 |
| **黑板字段 `bb.mem_promote_candidates` 单写者** | 唯一写者锁定 `MemPromoteScan`（异常路径写空列表 `[]`）。架构师 prompt 渲染只读该字段，不回写。 |

### MemoryGovernanceStep 子节点拓扑（13 节点）

Stage 5 完工后 `MemoryGovernanceStep`（`tree/dream_loop.py::build_dream_root` 中的 `mem_seq`）真实子节点列表，按 Sequence 顺序：

| # | 节点 | 类型 | yield? | 用途 |
|---|------|------|--------|------|
| 1 | `MemHealthScan` | in-process | 否 | 调 `memory.HealthChecker.check()`，写 `bb.mem_health` |
| 2 | `TranscriptScan` | in-process | 否 | 扫 `~/.claude/projects/<slug>/*.jsonl` mtime>1d，写 `bb.transcript_paths` |
| 3 | `DistillGate` | in-process | 否 | 路径列表为空 → SUCCESS 跳过 Dispatch/Collect/Delete；非空 → 进下一步 |
| 4 | `DispatchMemDistill` | yield(main) | **是** | yield `agent_type="main", subtask_id="governance_memory_distill"` |
| 5 | `CollectMemDistill` | in-process | 否 | `on_resume` 读主 agent 蒸馏报告，写 `bb.mem_distill_result` |
| 6 | `TranscriptDelete` | in-process | 否 | 按 `distilled_paths` 删原 JSONL，同步调 `retrieval.index_delete` |
| 7 | `MemPromoteScan` | in-process | 否 | 调 `scan_for_promote_candidates` 暂存候选，再 `pull_pending` 写 `bb.mem_promote_candidates` 供架构师审议 |
| 8 | `IncomingScan` | in-process | 否 | 扫 `<store>/medium/incoming/*.jsonl`（排除当日），写 `bb.incoming_paths` |
| 9 | `DispatchIncomingTriage` | yield(main) | **是** | yield `agent_type="main", subtask_id="governance_incoming_triage"` |
| 10 | `CollectIncomingTriage` | in-process | 否 | `on_resume` 读主 agent triage 报告，写 `bb.incoming_triage_result`，`os.replace` 归档 processed_paths 到 `incoming/processed/` |
| 11 | `MemCompact` | in-process | 否 | 调 `memory.compact()` 压缩 medium |
| 12 | `MemSweepExpired` | in-process | 否 | 调 `memory.sweep_expired()` 清归档过期 |
| 13 | `MemRebuildIndex` | in-process | 否 | 调 `rebuild_and_verify` 重建并校验 retrieval 索引 |

**顺序理由**：distill 消费 transcripts → 删 transcripts → promote scan 暂存并暴露候选 → incoming triage 在 promote scan 之后跑（让本轮新到的高信号原始记录有机会进 medium，下一轮 promote scan 再识别）→ compact medium → sweep 过期 → rebuild/verify 索引。每个 leaf 在 `@Catch` 包裹下相互独立——单 leaf 失败（含 incoming-triage 业务失败路径）只 annotate bb，不打断 sequence。

**稳定承诺**：节点数（13）与节点名是契约级稳定承诺；新增节点 / 改名 / 改顺序需走 contract 变更流程。每节点的 `yield?` 列锁死——in-process 节点永不发出 `DispatchRequest`，yield 节点必发。

## `dream_tick` — 启动新治理 tick

| 字段 | 内容 |
|------|------|
| 用途 | 由主 agent 在 SessionStart 注入提示或用户显式要求时调用，启动一次治理循环 tick，驱动到第一个 yield 或 Done |
| 输入 | `reason: str`（取值 `"catchup"` / `"manual"` / `"forced"`，写入 `bb.trigger_reason`）；`run_id: str \| None`（可选；外部传入预分配 ID，默认引擎自分配 UUID v4 短形式） |
| 输出 | `DreamResult`（四态联合，见下表） |
| 副作用 | 生成新 `run_id`（若未传入）；创建 `.cbim/scheduler/dream/<run_id>/` 目录；写 `current.json`（含 `run_id` / `started_at` / `status=running`）；首次落 `bb.json`；append `trace.jsonl` |
| 失败语义 | 距上次成功 < 20 小时且 `reason != "forced"` → `DreamResult.Skipped(reason="within_window")`；存在 `current.json` 且 status=running → `DreamResult.Skipped(reason="another_run_in_progress")`；启动失败（如目录创建权限不足）返回 `DreamResult.Error(error_code="...", error_message="...")`；不抛 |
| 稳定承诺 | 函数签名锁死；`reason` 取值集合锁定（新增走契约变更）；`run_id` 生成策略可换实现但格式（短 UUID 字符串）锁定；新增可选参数走追加 |

## `dream_tick_resume` — 恢复 yielded 治理 tick

| 字段 | 内容 |
|------|------|
| 用途 | 主 agent 拿到 Task tool 派工结果（Architect / HR 治理模式产出）后，把结果回交给指定 `run_id` 的 RUNNING 治理树，继续驱动到下一个 yield 或 Done |
| 输入 | `run_id: str`（前次 `DreamResult.Yield` 返回的 ID）；`dispatch_result: dict`（Task tool 的原始返回，schema 与 `DispatchRequest.agent_type` 匹配） |
| 输出 | `DreamResult`（四态联合，见下表） |
| 副作用 | 读 `bb.json` + `resume.json` 还原树状态；按 `runner_resume_path` 重建调用栈；通过 `on_resume(bb, payload)` 把 `dispatch_result` 交给路径末端 Action；继续 `tick(bb)`；视情况重写 `bb.json` / `resume.json` / 删除 `resume.json`（Done 时）；更新 `current.json.last_heartbeat` |
| 失败语义 | `run_id` 不存在或非 running → `DreamResult.Error(error_code="run_not_found_or_done")`；`dispatch_result` schema 不符 → `DreamResult.Error(error_code="dispatch_result_schema_mismatch")`；不抛 |
| 稳定承诺 | 函数签名锁死；两个 error_code 字符串值锁定（外部脚本会枚举判断） |

## `dream_list_runs` — 列出历史治理 run

| 字段 | 内容 |
|------|------|
| 用途 | 观测辅助：列出 `.cbim/scheduler/dream/` 下最近的治理 run；用于 dashboard 显示、用户回顾、调试 |
| 输入 | `limit: int = 10`（返回最近 N 条，按 `started_at` 倒序） |
| 输出 | `list[DreamRunSummary]`，每条至少包含：`run_id`、`trigger_reason`、`status`（`running` / `done` / `failed` / `abandoned`）、`started_at`、`finished_at`（可为 None）、`step_results`（三步 status 摘要）、`report_path`（report.md 绝对路径，未生成则 None） |
| 副作用 | 仅读盘；不修改任何状态；不自动续跑 abandoned run |
| 失败语义 | 目录不存在或为空返回空列表；不抛 |
| 稳定承诺 | `DreamRunSummary` 字段名锁定；新增字段可向后兼容追加；**不**承诺 abandoned run 自动续跑——abandoned 是终态 |

## `dream_abort` — 主动放弃一个 RUNNING 治理 tick

| 字段 | 内容 |
|------|------|
| 用途 | 主 agent 检测到用户优先让位（或用户显式要求）时主动标记当前 RUNNING 治理 tick 为 abandoned，避免后续 SessionStart 心跳超时检测的 30 分钟等待 |
| 输入 | `run_id: str`（要放弃的 RUNNING tick ID）；`reason: str`（放弃原因，写入 `abandoned.json`，常见值 `"user_preempted"` / `"manual_abort"` / `"shutdown"`） |
| 输出 | `AbortResult`：`{aborted: bool, run_id: str, reason: str, abandoned_at: str}` |
| 副作用 | 写 `.cbim/scheduler/dream/<run_id>/abandoned.json`；删除或更新 `current.json` 为非 running；不删除 `bb.json` / `trace.jsonl` / `resume.json`（保留供调试）；**不更新** `last_success.json`（abandoned ≠ success，20 小时窗口仍按上次真正 success 计算） |
| 失败语义 | `run_id` 不存在或非 running → `AbortResult{aborted: false, ...}` + 不抛 |
| 稳定承诺 | 函数签名锁死；`AbortResult` 字段名锁定；abandoned 写入语义锁定（abandoned 永不计入 last_success） |

---

## `DreamResult` — 四态联合返回

design §六 §七 + 本契约约定的四态联合。

| kind | 必填字段 | 主 agent 收到时应做 |
|------|----------|---------------------|
| `done` | `summary: str`、`report_path: str` | 不必回复用户（治理无 user_message 语义）；可把 `summary` 写到本会话上下文供后续参考；丢弃 `run_id`，本逻辑 tick 结束 |
| `yield` | `run_id: str`、`dispatch_request: DispatchRequest` | 按 `dispatch_request` 用 Task tool 派出对应 agent（Architect / HR 治理模式）；拿到结果后调 `dream_tick_resume(run_id, result)`；若用户在此期间发来 prompt，立即响应用户，不调 resume，可选调 `dream_abort(run_id, reason="user_preempted")` |
| `error` | `error_code: str`、`error_message: str`、可选 `report_path: str` | 不渲染给用户；写入本会话日志；若 `report_path` 非空（说明部分报告已落盘），下次 SessionStart 摘要会引用 |
| `skipped` | `reason: str`（取值 `"within_window"` / `"another_run_in_progress"` / `"recent_failure_cooldown"`） | 不做任何动作；本次 tick 未启动 |

**稳定承诺**：四个 `kind` 字符串值锁定（`"done"` / `"yield"` / `"error"` / `"skipped"`），不会新增第五态；字段集向后兼容追加；`skipped.reason` 取值集合锁定（新增走契约变更）。

## `DispatchRequest` — 治理上下文下的派工描述

复用执行循环同名结构，但治理上下文下字段取值受限：

| 字段 | 类型 | 治理上下文取值约束 |
|------|------|---------------------|
| `agent_type` | `str` | **取值集合** `{"architect", "hr", "main"}`（治理循环不调 work / auditor）。`"main"` 表示 yield 给 coordinator（主 agent）自身执行——主 agent 收到此 `dispatch_request` 时**不调** Task tool 派子 agent，而是按 `prompt` 自行执行对应 skill，然后调 `dream_tick_resume(run_id, dispatch_result)` 回交结果。回执 schema 与子 agent 派工的回执 schema 完全一致（仍由对应 Collect leaf 校验）。 |
| `agent_file` | `str \| None` | `agent_type="architect"` / `"hr"` 时与执行循环复用同一 agent 文件路径；`agent_type="main"` 时**必须**为 `None`（主 agent 不指向任何 `.claude/agents/*.md` 文件）。治理 / 执行模式由 prompt 头部 token 区分 |
| `prompt` | `str` | **必须**以 `## 治理模式` 或等价 token 开头：派 Architect / HR 时让子 agent 知道这是治理调用；派 `"main"` 时主 agent 自己识别治理 token、按 prompt 执行 skill。主 agent **原样**喂入 Task tool（agent_type ∈ {architect, hr}）或**原样**喂入自身执行管线（agent_type=main），不解释、不修改 |
| `subtask_id` | `str \| None` | **必须**填入治理步骤 ID，取值见下方稳定集合，用于 `dream_tick_resume` 时定位 `bb.*_governance_report` / `bb.mem_distill_result` / `bb.incoming_triage_result` 写入位置 |
| `timeout_hint_s` | `int \| None` | 治理循环建议值 600（10 分钟，与 `@Timeout(10min)` 步骤装饰器对齐）；非强制 |

**稳定承诺**：`agent_type` 取值集合在治理上下文锁定为 `{"architect", "hr", "main"}`；`subtask_id` 取值集合锁定为 `{"governance_knowledge", "governance_capability", "governance_memory_distill", "governance_incoming_triage"}`（4 元素，Stage 5 新增 `governance_incoming_triage`）；新增字段向后兼容追加。

**子任务 → 派工方对照表**：

| `subtask_id` | `agent_type` | 说明 |
|--------------|--------------|------|
| `governance_knowledge` | `"architect"` | 派 Architect 治理模式扫 `.dna/` 注册表，做裂变 / 归档 / 合并 / 漂移识别；同时审议 `bb.mem_promote_candidates`（MemPromoteScan 暂存的记忆升知识候选）逐条产 PROMOTE / HOLD / REJECT advice，强制人工门：PROMOTE 仅产 advice 不自动写 `.dna/` |
| `governance_capability` | `"hr"` | 派 HR 治理模式扫 `.claude/agents/` 注册表，做闲置归档 / 缺口建议 |
| `governance_memory_distill` | `"main"` | yield 给 coordinator 自身执行 transcript→medium 蒸馏 skill；不派子 agent |
| `governance_incoming_triage` | `"main"` | yield 给 coordinator 自身消费 `<store>/medium/incoming/*.jsonl`（前一日及更早），做 LLM 二筛 + 四象限（MUST/WANT/HOW/IS）压缩落 medium、归档原 incoming 文件到 `incoming/processed/`；不派子 agent |

**`"main"` 适用范围硬约束**：`agent_type="main"` 仅用于**以记忆为输入产出的治理子任务**（当前两个案例：`governance_memory_distill` 输入 transcript JSONL 输出 medium 记忆条目；`governance_incoming_triage` 输入 incoming 队列 JSONL 输出 medium 记忆条目 + 归档 incoming 文件）。两者全程在主 agent 上下文内即可完成，无需独立子 agent 上下文，且 HR 不拥有 `memory_create`。架构治理（`governance_knowledge`）与能力册治理（`governance_capability`）**不**适用此例外，仍须经 architect / hr 子 agent 派工——这两类治理需要专属角色身份、独立提示词预算、与 coordinator 上下文隔离。

> **同一 agent_type 可对应多个 Collect leaf**：`"main"` 类型同时承载 `governance_memory_distill → CollectMemDistill` 与 `governance_incoming_triage → CollectIncomingTriage`，Runner 走 `(agent_type, subtask_id)` 二级路由（`DREAM_AGENT_SUBTASK_TO_LEAF`，优先于单级 `DREAM_AGENT_TYPE_TO_LEAF` 兜底），从而让同一 agent 类型的不同治理职责映射到各自的 Collect 节点。HR 在治理循环中仅承担能力册扫描（`governance_capability` → `CollectHRAdvice`）。

## `DreamRunSummary` — `dream_list_runs` 单条返回

| 字段 | 类型 | 说明 |
|------|------|------|
| `run_id` | `str` | 治理 tick 唯一 ID |
| `trigger_reason` | `str` | `"catchup"` / `"manual"` / `"forced"` |
| `status` | `str` | `"running"` / `"done"` / `"failed"` / `"abandoned"` |
| `started_at` | `str` | ISO8601 时间戳 |
| `finished_at` | `str \| None` | ISO8601 时间戳；running / abandoned 可为 None |
| `step_results` | `dict[str, str]` | 三步状态摘要：`{"memory": "success", "knowledge": "failure", "capability": "skipped"}` |
| `report_path` | `str \| None` | report.md 绝对路径；未生成则 None |

**稳定承诺**：字段名与 status 取值集合（`running` / `done` / `failed` / `abandoned`）锁定；新增字段向后兼容追加。

## `AbortResult` — `dream_abort` 返回

| 字段 | 类型 | 说明 |
|------|------|------|
| `aborted` | `bool` | True = 成功标记 abandoned；False = run_id 不存在或非 running |
| `run_id` | `str` | 回传输入的 run_id |
| `reason` | `str` | 回传输入的 reason |
| `abandoned_at` | `str` | ISO8601 时间戳；aborted=False 时仍填当前时间 |

**稳定承诺**：字段名锁定；新增字段向后兼容追加。

---

## 不在契约内的部分

| 项 | 归属 |
|----|------|
| 黑板 schema 与字段写者表 | 归 design `WORKFLOW-DREAM.zh-CN.md §五`；通过 `bb.json.schema_version` 管理演进，不通过本契约暴露 |
| 节点 ABC、组合节点、装饰器实现 | 复用 `engine/core/` 子模块内部；外部不可见、不可继承（C1 单接口原则） |
| `SequenceTolerant` 组合节点的内部实现 | 归 `engine/core/composite.py`（作为共享原语新增）；外部只通过 `tree/` 静态拼装可见 |
| Action 实现内部的 in-process 记忆服务调用 | 归 `actions/mem_*.py` 内部；通过构造器注入 memory 客户端，对外只通过 `tick(bb) → Status` 暴露 |
| 治理模式 prompt 模板 | 归 `actions/dispatch_*.py` 内部；prompt 结构演进不通过本契约暴露 |
| 树拓扑（节点排列、装饰器叠加顺序） | 归 `tree/dream_root.py`；可静态审计但不通过运行时 API 暴露——审计请直读源码 |
| `trace.jsonl` 单条事件结构 | 复用 `engine/persistence/trace.py` 格式（与执行循环共享）；事件类型是观测约定，不是 RPC 契约——下游消费者按 best-effort 解析 |
| abandoned run 自动恢复策略 | **明确不做**；abandoned 是终态，20 小时窗口正常滚动后由下次 SessionStart 触发**新的** dream tick 而非续跑 |
| 直派 Architect / HR 的回调接口 | **明确不做**；任何派工一律经 yield → Task tool → resume 回路 |
| SessionStart hook 注入提示的具体文案 | 归 `.claude/hooks/cbim_session_start.py` 内部；本契约只约束 `dream_tick` 入口，不约束触发提示语 |
