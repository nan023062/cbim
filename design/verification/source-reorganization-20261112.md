# CBIM 按 V&B 模块归属整理源码（2026-11-12）

> 导航维护说明（2026-11-14）：正文保留当时的路径、结论与验证边界；可点击源码链接已更新到当前归属，仅供导航，不作为历史版本证据。未留存的阶段入口另行注明，不伪造源码或制品归档。

用户直接授权实施；开放 Issues 为空，不另建工单或实时待办。整理前 Git 基线为 `63497206`（develop），产品源码与上一轮 V&B 快照 `3f249cf8` 的 668 个文件哈希一致。复用已核实的职责、源码与依赖映射，只复核迁移边界及消费者，没有重新生成包含全部源码的大型 HTML。

## 结果与阅读入口

迁移 185 个源码文件；668 个源码/样式文件仍完整，原 3,075 条源码引用逐条映射后没有新增或丢失。移动时同步 9 份已有契约；其中原任务持久化契约再按资料、履历、运行日志和派发拆到所属目录。86 个代码目录都有与当前源码一致的类图。

先读 [后端模块与源码导航](../../src/logic/BOUNDARIES.md)，再读 [实际目录类图](../../src/logic/ARCHITECTURE.md)。本报告保留迁移事实，当前结构以 src 的契约和类图为准；原 V&B HTML/报告仍是原版本的审阅快照，没有被改写成新版本证据。

`git diff 63497206 <本次提交> -- src tests scripts forge.config.ts` 可查看完整代码变化；省略路径选择器可查看全部文档与规则变化。文件移动清单见文末。

## 为什么这样整理

| 原归属 | 当前归属 | 维护目的 |
| --- | --- | --- |
| core/brain 中具体引擎与模型协议混放 | core/execution、core/models、backend/engines | 核心执行机制不认识 SDK；仅调度 assembly 选择具体引擎 |
| core/tasks 内混放预算、证据、文件、派发端口 | core/budget、evidence、file-operations、dispatch；任务规则留在 tasks | 按已核实职责定位规则和契约 |
| team/model、workspace/model 与 snapshot 分散 | core/knowledge/read-models | 私有读模型集中，保持 index 公开入口及原单向依赖 |
| scheduler-engine/execution 集中多个业务服务 | admission、assembly、conversation、members、goals、evidence、budget、dispatch | 将编排职责变成可直接定位的目录 |
| main/persistence 按技术层堆放实现 | knowledge、models、settings、materials、history、run-storage、dispatch-storage | 保持存储状态归属，同时让应用职责集中 |
| main/platform 混放隔离与文件实现 | platform/isolation、platform/files | 保持技术边界及对应子进程入口清晰 |

保留 frontend、bridge、main、updater 的编译与运行边界；前端已有的职责目录不强制重排。不是把 74 个 review 分组都声明为独立模块。execution/runtime、execution/capabilities 是执行模块的内部组织；没有把它们伪装成已独立解耦的系统。

本步为 C3 专项治理、L3 全局结构交付：S1 直接授权与源码基线；S2 复用 V&B 事实并核对哈希/消费者；S3 区分目录问题与共享状态问题；S4 冻结纯迁移清单；S5 同步真实消费者与入口；S6 做语法/引用对照、定向验证和资料同步；S7 交付可 review 的提交和本记录。人工 review 尚未进行。

## 边界、状态与兼容

- 引擎适配只依赖自身及 Core；Core 不可反向依赖引擎。scheduler-engine 只有 assembly 可以引用 engines；Main 通过调度装配接入，不能另行直接引用具体引擎。已有 13 组逻辑边界的成员路径同步，公开/私有入口和其他约束不放宽。
- 真实主会话链：main/assembly/execution → scheduler-engine/conversation/execution-manager → scheduler-engine/assembly/loop-engine → Core 运行内核 + engines；事件仍通过原 RunStorage 写入。成员派发与 FileDispatchStore 的事务不被目录移动拆开。
- 运行数据目录、IPC 名称、工具名、存储格式、事务、权限、取消、资源释放及恢复行为不作功能修改；Forge 的两个源入口同步到新平台目录，入口 basename 与打包输出名保留。真实打包尚未重新验收。
- 变更原因是定位与依赖边界。SDK/传输与领域规则有不同变化原因，未用提交次数虚构频率或成熟度。新引擎进入 engines 和 assembly；真实契约变化仍须评估 Core 消费者。
- 本轮仍保留 LoopRuntime、loop-engine、ScopeGoalService 的高依赖密度及共享 DispatchStore。迁移没有消除这些依赖，也没有为它们引入事件总线、空接口或临时兼容转发文件。后续若治理，应另按真实状态与事务边界切片。
- 回退按本次提交整体撤回源码路径、消费者、规则和文档；不要只回退目录而留下新引用。本轮未改运行数据，不需要数据格式回滚。

## 验证证据与范围

1. 迁移前逐文件 SHA-256 核对 V&B 源码快照。迁移后 AST 叶子 token 对照忽略 JSDoc 并将引用路径还原成同一个源文件：621 个源码脚本无其他差异；3075 条源码边一一保留。此对照支持行为保持的判断，不代替实际平台验收。
2. `pnpm typecheck` 通过。`pnpm check:architecture` 通过：86 个目录、668 个源码/样式文件，文档零漂移；1300 个维护脚本、6685 条依赖，零循环、零分层/逻辑违规。
3. `pnpm exec vitest run tests/dependencies.test.ts tests/layer-boundaries.test.ts tests/source-architecture.test.ts`：29 个用例通过。修正虚拟项目的旧目录/别名和父子目录样例；保留原违规断言，并新增 Core 反向引用、普通调度/Main 绕过装配的拒绝验证。最后收紧 Main 规则后单独重跑前两个文件，25 个用例通过。
4. 受影响行为：选择真实引擎接入、loop 装配、模型请求预算、知识公开入口、自动化、受控文件、履历与共享派发存储的消费者，20 个文件/123 个用例通过。精确命令：

`pnpm exec vitest run tests/engine-capabilities.test.ts tests/engine-tools.test.ts tests/claude-engine.test.ts tests/codex-engine.test.ts tests/loop-engine.test.ts tests/engine-configuration.test.ts tests/knowledge-queries.test.ts tests/knowledge-query-ports.test.ts tests/request-budget-ports.test.ts tests/model-request-budget-transport.test.ts tests/model-request-budget-usage.test.ts tests/model-request-budget-bootstrap.test.ts tests/automation-application.test.ts tests/automation-scheduler.test.ts tests/controlled-file-platform.test.ts tests/controlled-file-service.test.ts tests/agent-history-store.test.ts tests/agent-history-assembly.test.ts tests/dispatch-store.test.ts tests/application-runtime.test.ts`

5. src 全部 Markdown 本地链接存在；三份 architecture-maintenance 入口同内容。清除了无关链接格式变动，保留未涉及的历史记录。

首次架构测试有 9 个失败，原因均为测试夹具内旧路径（包括别名、虚拟片段、node_modules 相对深度）或原 brain/llm 父子关系样例；未放宽断言，按新真实路径修正后通过。语法对照第一次把 JSDoc 计入差异，明确排除注释节点后通过；引用图始终无增减。

未运行全仓回归、真实模型在线调用、全部 UI 冒烟、打包、原生隔离/安装升级或发布。当前结果不代表这些阶段通过，也不代表历史隔离恢复竞争已修复。后续 PR/发布按原流程验证。

本机原始证据位于 `test-results/reorganize-20261112/`：equivalence.json、architecture-tests.log、boundary-final.log、affected-tests.log、typecheck.log、architecture-check.log；此目录是忽略的本机验证产物，不属于源码实现。

## 维护者四问

- Q1 保护了什么：既有执行/授权/存储行为与文件级无环约束，新增明确的引擎适配物理边界。
- Q2 变化应在哪里：引擎差异归 engines 与 assembly，领域规则按 budget/evidence/tasks 等定位，文件副作用归 Main 对应实现。
- Q3 依据是什么：源码哈希、归一化语法与引用对照、152 个定向用例、类型和架构检查；线上/原生制品和人工 review 尚无新结果。
- Q4 下次怎么改：从后端导航选择业务对象，沿契约 → 编排 → 副作用读取，只验证受影响消费者，并同步所在目录文档。
- Q5 规则候选：后续 review 优先复用版本化契约、依赖扫描及 Git diff；不足时再扩大分析，不每轮重新生成全仓全文快照。本轮未新增审查平台或改写既有治理流程。

## 完整源码迁移映射

旧路径 → 新路径（均相对仓库根目录）：

- `src/backend/core/brain/artifact-capture.ts` → `src/backend/core/execution/capabilities/artifact-capture.ts`
- `src/backend/core/brain/claude/engine.ts` → `src/backend/engines/claude/engine.ts`
- `src/backend/core/brain/claude/sdk.ts` → `src/backend/engines/claude/sdk.ts`
- `src/backend/core/brain/claude/tools.ts` → `src/backend/engines/claude/tools.ts`
- `src/backend/core/brain/codex/binary.ts` → `src/backend/engines/codex/binary.ts`
- `src/backend/core/brain/codex/engine.ts` → `src/backend/engines/codex/engine.ts`
- `src/backend/core/brain/codex/model-proxy.ts` → `src/backend/engines/codex/model-proxy.ts`
- `src/backend/core/brain/codex/rpc.ts` → `src/backend/engines/codex/rpc.ts`
- `src/backend/core/brain/codex/session.ts` → `src/backend/engines/codex/session.ts`
- `src/backend/core/brain/codex/tools.ts` → `src/backend/engines/codex/tools.ts`
- `src/backend/core/brain/conversation-binding.ts` → `src/backend/core/execution/conversation-binding.ts`
- `src/backend/core/brain/engine-instructions.ts` → `src/backend/core/execution/engine-instructions.ts`
- `src/backend/core/brain/engine-session.ts` → `src/backend/core/execution/engine-session.ts`
- `src/backend/core/brain/engine-tools.ts` → `src/backend/core/execution/engine-tools.ts`
- `src/backend/core/brain/index.ts` → `src/backend/core/execution/index.ts`
- `src/backend/core/brain/input-source.ts` → `src/backend/core/execution/input-source.ts`
- `src/backend/core/brain/llm/catalog.ts` → `src/backend/core/models/catalog.ts`
- `src/backend/core/brain/llm/config.ts` → `src/backend/core/models/config.ts`
- `src/backend/core/brain/llm/engine.ts` → `src/backend/core/models/engine.ts`
- `src/backend/core/brain/llm/ports.ts` → `src/backend/core/models/ports.ts`
- `src/backend/core/brain/llm/request-budget-transport.ts` → `src/backend/engines/transport/request-budget-transport.ts`
- `src/backend/core/brain/llm/request-budget-usage.ts` → `src/backend/engines/transport/request-budget-usage.ts`
- `src/backend/core/brain/llm/request-budget.ts` → `src/backend/core/models/request-budget.ts`
- `src/backend/core/brain/member-checkpoint.ts` → `src/backend/core/execution/capabilities/member-checkpoint.ts`
- `src/backend/core/brain/member-run.ts` → `src/backend/core/execution/member-run.ts`
- `src/backend/core/brain/member-tool-capabilities.ts` → `src/backend/core/execution/capabilities/member-tool-capabilities.ts`
- `src/backend/core/brain/model-errors.ts` → `src/backend/core/execution/model-errors.ts`
- `src/backend/core/brain/native-tools.ts` → `src/backend/engines/native-tools.ts`
- `src/backend/core/brain/output-manifest-capture.ts` → `src/backend/core/execution/capabilities/output-manifest-capture.ts`
- `src/backend/core/brain/pi/bridge.ts` → `src/backend/engines/pi/bridge.ts`
- `src/backend/core/brain/pi/engine.ts` → `src/backend/engines/pi/engine.ts`
- `src/backend/core/brain/pi/request-budget-bootstrap.ts` → `src/backend/engines/pi/request-budget-bootstrap.ts`
- `src/backend/core/brain/pi/rpc.ts` → `src/backend/engines/pi/rpc.ts`
- `src/backend/core/brain/pi/runtime-config.ts` → `src/backend/engines/pi/runtime-config.ts`
- `src/backend/core/brain/repeated-tool-failures.ts` → `src/backend/core/execution/repeated-tool-failures.ts`
- `src/backend/core/brain/run-artifact-transition.ts` → `src/backend/core/execution/capabilities/run-artifact-transition.ts`
- `src/backend/core/brain/run-controlled-file.ts` → `src/backend/core/execution/capabilities/run-controlled-file.ts`
- `src/backend/core/brain/run-scoped-execution.ts` → `src/backend/core/execution/capabilities/run-scoped-execution.ts`
- `src/backend/core/brain/run-validation.ts` → `src/backend/core/execution/capabilities/run-validation.ts`
- `src/backend/core/brain/runtime.ts` → `src/backend/core/execution/runtime/runtime.ts`
- `src/backend/core/brain/scope-usage.ts` → `src/backend/core/execution/scope-usage.ts`
- `src/backend/core/brain/storage.ts` → `src/backend/core/execution/storage.ts`
- `src/backend/core/brain/types.ts` → `src/backend/core/execution/types.ts`
- `src/backend/core/brain/usage.ts` → `src/backend/core/execution/usage.ts`
- `src/backend/core/knowledge/read-models.ts` → `src/backend/core/knowledge/read-models/index.ts`
- `src/backend/core/knowledge/snapshot.ts` → `src/backend/core/knowledge/read-models/snapshot.ts`
- `src/backend/core/policy/tool-policy.ts` → `src/backend/core/tools/policy/tool-policy.ts`
- `src/backend/core/policy/types.ts` → `src/backend/core/tools/policy/types.ts`
- `src/backend/core/tasks/artifact-baseline.ts` → `src/backend/core/evidence/artifact-baseline.ts`
- `src/backend/core/tasks/artifact-evidence.ts` → `src/backend/core/evidence/artifact-evidence.ts`
- `src/backend/core/tasks/artifact-tools.ts` → `src/backend/core/evidence/artifact-tools.ts`
- `src/backend/core/tasks/artifact-transition-evidence.ts` → `src/backend/core/file-operations/artifact-transition-evidence.ts`
- `src/backend/core/tasks/artifact-transition.ts` → `src/backend/core/file-operations/artifact-transition.ts`
- `src/backend/core/tasks/complete-output-evidence.ts` → `src/backend/core/evidence/complete-output-evidence.ts`
- `src/backend/core/tasks/controlled-file-event.ts` → `src/backend/core/file-operations/controlled-file-event.ts`
- `src/backend/core/tasks/controlled-file-invariants.ts` → `src/backend/core/file-operations/controlled-file-invariants.ts`
- `src/backend/core/tasks/controlled-file-operation.ts` → `src/backend/core/file-operations/controlled-file-operation.ts`
- `src/backend/core/tasks/controlled-file-rules.ts` → `src/backend/core/file-operations/controlled-file-rules.ts`
- `src/backend/core/tasks/dispatch-storage.ts` → `src/backend/core/dispatch/dispatch-storage.ts`
- `src/backend/core/tasks/isolated-execution-recovery.ts` → `src/backend/core/file-operations/isolated-execution-recovery.ts`
- `src/backend/core/tasks/model-request-budget-invariants.ts` → `src/backend/core/budget/model-request-budget-invariants.ts`
- `src/backend/core/tasks/model-request-budget-rules.ts` → `src/backend/core/budget/model-request-budget-rules.ts`
- `src/backend/core/tasks/model-request-budget-storage.ts` → `src/backend/core/budget/model-request-budget-storage.ts`
- `src/backend/core/tasks/model-request-budget.ts` → `src/backend/core/budget/model-request-budget.ts`
- `src/backend/core/tasks/output-manifest-evidence.ts` → `src/backend/core/evidence/output-manifest-evidence.ts`
- `src/backend/core/tasks/output-manifest-identity.ts` → `src/backend/core/evidence/output-manifest-identity.ts`
- `src/backend/core/tasks/output-manifest-tools.ts` → `src/backend/core/evidence/output-manifest-tools.ts`
- `src/backend/core/tasks/output-manifest.ts` → `src/backend/core/evidence/output-manifest.ts`
- `src/backend/core/tasks/progress-schema.ts` → `src/backend/core/evidence/progress-schema.ts`
- `src/backend/core/tasks/progress-tools.ts` → `src/backend/core/evidence/progress-tools.ts`
- `src/backend/core/tasks/progress.ts` → `src/backend/core/evidence/progress.ts`
- `src/backend/core/tasks/scope-budget-invariants.ts` → `src/backend/core/budget/scope-budget-invariants.ts`
- `src/backend/core/tasks/scope-budget.ts` → `src/backend/core/budget/scope-budget.ts`
- `src/backend/core/tasks/scope-usage.ts` → `src/backend/core/budget/scope-usage.ts`
- `src/backend/core/tasks/scoped-execution.ts` → `src/backend/core/file-operations/scoped-execution.ts`
- `src/backend/core/tasks/validation-evidence.ts` → `src/backend/core/evidence/validation-evidence.ts`
- `src/backend/core/tasks/validation-tools.ts` → `src/backend/core/evidence/validation-tools.ts`
- `src/backend/core/tasks/validation.ts` → `src/backend/core/evidence/validation.ts`
- `src/backend/core/tasks/workflow-evidence.ts` → `src/backend/core/evidence/workflow-evidence.ts`
- `src/backend/core/team/model.ts` → `src/backend/core/knowledge/read-models/team.ts`
- `src/backend/core/workspace/model.ts` → `src/backend/core/knowledge/read-models/workspace.ts`
- `src/backend/main/agent-history.ts` → `src/backend/main/history/assembly.ts`
- `src/backend/main/application.ts` → `src/backend/main/assembly/application.ts`
- `src/backend/main/automation.ts` → `src/backend/main/automation/service.ts`
- `src/backend/main/execution-admission.ts` → `src/backend/main/assembly/execution-admission.ts`
- `src/backend/main/execution.ts` → `src/backend/main/assembly/execution.ts`
- `src/backend/main/member-dispatch.ts` → `src/backend/main/assembly/member-dispatch.ts`
- `src/backend/main/persistence/governance/module-governance-store.ts` → `src/backend/main/governance/storage/module-governance-store.ts`
- `src/backend/main/persistence/knowledge/files.ts` → `src/backend/main/knowledge/files.ts`
- `src/backend/main/persistence/knowledge/governance-port.ts` → `src/backend/main/knowledge/governance-port.ts`
- `src/backend/main/persistence/knowledge/knowledge-store.ts` → `src/backend/main/knowledge/knowledge-store.ts`
- `src/backend/main/persistence/knowledge/object-storage.ts` → `src/backend/main/knowledge/object-storage.ts`
- `src/backend/main/persistence/knowledge/planned-commit.ts` → `src/backend/main/knowledge/planned-commit.ts`
- `src/backend/main/persistence/knowledge/source-journal.ts` → `src/backend/main/knowledge/source-journal.ts`
- `src/backend/main/persistence/settings/admission-settings.ts` → `src/backend/main/settings/admission-settings.ts`
- `src/backend/main/persistence/settings/budget-settings.ts` → `src/backend/main/settings/budget-settings.ts`
- `src/backend/main/persistence/settings/llm-profiles.ts` → `src/backend/main/models/llm-profiles.ts`
- `src/backend/main/persistence/settings/main-agent-settings.ts` → `src/backend/main/models/main-agent-settings.ts`
- `src/backend/main/persistence/settings/web-settings.ts` → `src/backend/main/settings/web-settings.ts`
- `src/backend/main/persistence/tasks/agent-history.ts` → `src/backend/main/history/file-store.ts`
- `src/backend/main/persistence/tasks/automations.ts` → `src/backend/main/automation/storage.ts`
- `src/backend/main/persistence/tasks/chat-inputs.ts` → `src/backend/main/materials/chat-inputs.ts`
- `src/backend/main/persistence/tasks/chat-material-imports.ts` → `src/backend/main/materials/chat-material-imports.ts`
- `src/backend/main/persistence/tasks/chat-source-readers.ts` → `src/backend/main/materials/chat-source-readers.ts`
- `src/backend/main/persistence/tasks/dispatch-store.ts` → `src/backend/main/dispatch-storage/dispatch-store.ts`
- `src/backend/main/persistence/tasks/isolation-records.ts` → `src/backend/main/platform/isolation/isolation-records.ts`
- `src/backend/main/persistence/tasks/request-budget-store.ts` → `src/backend/main/dispatch-storage/request-budget-store.ts`
- `src/backend/main/persistence/tasks/run-journal.ts` → `src/backend/main/run-storage/run-journal.ts`
- `src/backend/main/persistence/tasks/run-storage.ts` → `src/backend/main/run-storage/run-storage.ts`
- `src/backend/main/platform/artifact-files.ts` → `src/backend/main/platform/files/artifact-files.ts`
- `src/backend/main/platform/controlled-file-blobs.ts` → `src/backend/main/platform/files/controlled-file-blobs.ts`
- `src/backend/main/platform/controlled-file-child.ts` → `src/backend/main/platform/files/controlled-file-child.ts`
- `src/backend/main/platform/controlled-file-protocol.ts` → `src/backend/main/platform/files/controlled-file-protocol.ts`
- `src/backend/main/platform/controlled-file-transport.ts` → `src/backend/main/platform/files/controlled-file-transport.ts`
- `src/backend/main/platform/controlled-file-win32.ts` → `src/backend/main/platform/files/controlled-file-win32.ts`
- `src/backend/main/platform/isolated-node-protocol.ts` → `src/backend/main/platform/isolation/isolated-node-protocol.ts`
- `src/backend/main/platform/isolated-node-win32.ts` → `src/backend/main/platform/isolation/isolated-node-win32.ts`
- `src/backend/main/platform/isolated-node.ts` → `src/backend/main/platform/isolation/isolated-node.ts`
- `src/backend/main/platform/isolation-record.ts` → `src/backend/main/platform/isolation/isolation-record.ts`
- `src/backend/main/platform/isolation-recovery-win32.ts` → `src/backend/main/platform/isolation/isolation-recovery-win32.ts`
- `src/backend/main/platform/output-manifest-files.ts` → `src/backend/main/platform/files/output-manifest-files.ts`
- `src/backend/main/platform/png-validator.ts` → `src/backend/main/platform/files/png-validator.ts`
- `src/backend/main/platform/public-http.ts` → `src/backend/main/web/public-http.ts`
- `src/backend/main/platform/scoped-execution-files.ts` → `src/backend/main/platform/files/scoped-execution-files.ts`
- `src/backend/main/resources/github-api.ts` → `src/backend/main/feedback/github-api.ts`
- `src/backend/main/resources/github-feedback-auth.ts` → `src/backend/main/feedback/github-feedback-auth.ts`
- `src/backend/main/resources/github-feedback.ts` → `src/backend/main/feedback/github-feedback.ts`
- `src/backend/main/resources/web-service.ts` → `src/backend/main/web/web-service.ts`
- `src/backend/main/runtime-monitor.ts` → `src/backend/main/assembly/runtime-monitor.ts`
- `src/backend/main/workspace/artifact-transitions.ts` → `src/backend/main/file-operations/artifact-transitions.ts`
- `src/backend/main/workspace/controlled-files.ts` → `src/backend/main/file-operations/controlled-files.ts`
- `src/backend/main/workspace/isolated-executions.ts` → `src/backend/main/file-operations/isolated-executions.ts`
- `src/backend/main/workspace/knowledge-effect-reader.ts` → `src/backend/main/evidence/knowledge-effect-reader.ts`
- `src/backend/main/workspace/knowledge-sources.ts` → `src/backend/main/registry/knowledge-sources.ts`
- `src/backend/main/workspace/main-module-ownership-tools.ts` → `src/backend/main/registry/main-module-ownership-tools.ts`
- `src/backend/main/workspace/main-workspace-member-tools.ts` → `src/backend/main/registry/main-workspace-member-tools.ts`
- `src/backend/main/workspace/module-ownerships.ts` → `src/backend/main/registry/module-ownerships.ts`
- `src/backend/main/workspace/persistent-effect-reader.ts` → `src/backend/main/evidence/persistent-effect-reader.ts`
- `src/backend/main/workspace/workspace-members.ts` → `src/backend/main/registry/workspace-members.ts`
- `src/backend/scheduler-engine/execution/admission-wait.ts` → `src/backend/scheduler-engine/admission/admission-wait.ts`
- `src/backend/scheduler-engine/execution/agent-manager.ts` → `src/backend/scheduler-engine/members/agent-manager.ts`
- `src/backend/scheduler-engine/execution/artifact-report-service.ts` → `src/backend/scheduler-engine/evidence/artifact-report-service.ts`
- `src/backend/scheduler-engine/execution/auto-collaboration.ts` → `src/backend/scheduler-engine/dispatch/auto-collaboration.ts`
- `src/backend/scheduler-engine/execution/checkpoint-abandonment-service.ts` → `src/backend/scheduler-engine/members/checkpoint-abandonment-service.ts`
- `src/backend/scheduler-engine/execution/command-verification-service.ts` → `src/backend/scheduler-engine/evidence/command-verification-service.ts`
- `src/backend/scheduler-engine/execution/dispatch-service.ts` → `src/backend/scheduler-engine/dispatch/dispatch-service.ts`
- `src/backend/scheduler-engine/execution/effect-controlled-file.ts` → `src/backend/scheduler-engine/evidence/effect-controlled-file.ts`
- `src/backend/scheduler-engine/execution/effect-observation-service.ts` → `src/backend/scheduler-engine/evidence/effect-observation-service.ts`
- `src/backend/scheduler-engine/execution/effect-source.ts` → `src/backend/scheduler-engine/evidence/effect-source.ts`
- `src/backend/scheduler-engine/execution/execution-manager.ts` → `src/backend/scheduler-engine/conversation/execution-manager.ts`
- `src/backend/scheduler-engine/execution/execution-report-facts.ts` → `src/backend/scheduler-engine/evidence/execution-report-facts.ts`
- `src/backend/scheduler-engine/execution/execution-report-service.ts` → `src/backend/scheduler-engine/evidence/execution-report-service.ts`
- `src/backend/scheduler-engine/execution/human-decision-evidence.ts` → `src/backend/scheduler-engine/evidence/human-decision-evidence.ts`
- `src/backend/scheduler-engine/execution/human-evidence-state.ts` → `src/backend/scheduler-engine/evidence/human-evidence-state.ts`
- `src/backend/scheduler-engine/execution/loop-engine.ts` → `src/backend/scheduler-engine/assembly/loop-engine.ts`
- `src/backend/scheduler-engine/execution/main-command-request.ts` → `src/backend/scheduler-engine/goals/main-command-request.ts`
- `src/backend/scheduler-engine/execution/member-checkpoint-verifier.ts` → `src/backend/scheduler-engine/members/member-checkpoint-verifier.ts`
- `src/backend/scheduler-engine/execution/member-events.ts` → `src/backend/scheduler-engine/runtime/member-events.ts`
- `src/backend/scheduler-engine/execution/member-execution.ts` → `src/backend/scheduler-engine/members/member-execution.ts`
- `src/backend/scheduler-engine/execution/member-help-state.ts` → `src/backend/scheduler-engine/members/member-help-state.ts`
- `src/backend/scheduler-engine/execution/member-pause-service.ts` → `src/backend/scheduler-engine/members/member-pause-service.ts`
- `src/backend/scheduler-engine/execution/member-resume-service.ts` → `src/backend/scheduler-engine/members/member-resume-service.ts`
- `src/backend/scheduler-engine/execution/member-state.ts` → `src/backend/scheduler-engine/members/member-state.ts`
- `src/backend/scheduler-engine/execution/member-workflow.ts` → `src/backend/scheduler-engine/members/member-workflow.ts`
- `src/backend/scheduler-engine/execution/model-request-budget-service.ts` → `src/backend/scheduler-engine/budget/model-request-budget-service.ts`
- `src/backend/scheduler-engine/execution/output-manifest-report-service.ts` → `src/backend/scheduler-engine/evidence/output-manifest-report-service.ts`
- `src/backend/scheduler-engine/execution/owner-execution-service.ts` → `src/backend/scheduler-engine/dispatch/owner-execution-service.ts`
- `src/backend/scheduler-engine/execution/public-run-events.ts` → `src/backend/scheduler-engine/runtime/public-run-events.ts`
- `src/backend/scheduler-engine/execution/queued-dependency-addition-service.ts` → `src/backend/scheduler-engine/goals/queued-dependency-addition-service.ts`
- `src/backend/scheduler-engine/execution/queued-dependency-replacement-service.ts` → `src/backend/scheduler-engine/goals/queued-dependency-replacement-service.ts`
- `src/backend/scheduler-engine/execution/queued-dependency-revision-service.ts` → `src/backend/scheduler-engine/goals/queued-dependency-revision-service.ts`
- `src/backend/scheduler-engine/execution/queued-task-cancel-service.ts` → `src/backend/scheduler-engine/goals/queued-task-cancel-service.ts`
- `src/backend/scheduler-engine/execution/scope-active-input-evidence.ts` → `src/backend/scheduler-engine/goals/scope-active-input-evidence.ts`
- `src/backend/scheduler-engine/execution/scope-active-input-service.ts` → `src/backend/scheduler-engine/goals/scope-active-input-service.ts`
- `src/backend/scheduler-engine/execution/scope-budget-service.ts` → `src/backend/scheduler-engine/budget/scope-budget-service.ts`
- `src/backend/scheduler-engine/execution/scope-continuation-service.ts` → `src/backend/scheduler-engine/goals/scope-continuation-service.ts`
- `src/backend/scheduler-engine/execution/scope-goal-service.ts` → `src/backend/scheduler-engine/goals/scope-goal-service.ts`
- `src/backend/scheduler-engine/execution/scope-human-continuation-service.ts` → `src/backend/scheduler-engine/goals/scope-human-continuation-service.ts`
- `src/backend/scheduler-engine/execution/scope-human-decision-service.ts` → `src/backend/scheduler-engine/goals/scope-human-decision-service.ts`
- `src/backend/scheduler-engine/execution/scope-recovery-service.ts` → `src/backend/scheduler-engine/goals/scope-recovery-service.ts`
- `src/backend/scheduler-engine/execution/scope-replan-service.ts` → `src/backend/scheduler-engine/goals/scope-replan-service.ts`
- `src/backend/scheduler-engine/execution/scope-usage-service.ts` → `src/backend/scheduler-engine/budget/scope-usage-service.ts`
- `src/backend/scheduler-engine/execution/workspace-lease.ts` → `src/backend/scheduler-engine/admission/workspace-lease.ts`
- `src/backend/scheduler-engine/runtime/agent-history.ts` → `src/backend/scheduler-engine/history/agent-history.ts`
- `src/backend/scheduler-engine/runtime/run-admission.ts` → `src/backend/scheduler-engine/admission/run-admission.ts`
