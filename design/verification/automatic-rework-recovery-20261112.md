# 有界返工与可靠结果自动恢复：实施验证记录

> 导航维护说明（2026-11-14）：正文保留当时的路径、结论与验证边界；可点击源码链接已更新到当前归属，仅供导航，不作为历史版本证据。未留存的阶段入口另行注明，不伪造源码或制品归档。

日期：2026-11-12。基线：`2187842f` 加既有未提交清理与通用代码验证实现。来源：用户要求“依次完成其它缺口”；查询开放 Issues 为空，按直接授权先实现最终验收返工，再实现重启接收。没有创建或回填工单；本记录不是实时待办。

## 已实现行为与边界

1. 最终验收的可修复拒绝先重核完整主/成员日志，再以 `goal-repair` 系统消息交回原主会话。最多三次，同一问题且任务成果无变化最多两次；复用原权限、软预算、32 次主运行上限和停止屏障。旧成功候选可由精确 `rejectedCandidate` 业务拒绝后被新候选替代，原历史与人工条件保留。
2. 主轮结算、成员启动前持久保存精确待回传批次。宿主意外退出后，仅当全部成员可靠交付、原主链与当前声明的证据仍有效、模型未变、结果信封未消费，自动启动新的主接收轮并完成原目标。成员不再次执行；启动意图已登记但日志缺失的情况不再次发送。
3. 运行中断、未知副作用、损坏日志、已停止目标、旧无批次记录、人工等待和过期证据仍按原边界停放或封存。本次不是任意断点恢复或命令重试框架；文件有效性仅覆盖原交付声明的验证范围。正常退出会关闭活动周期，不等同意外崩溃。

当前协议及维护入口见[任务契约](../../src/logic/tasks/rules/CONTRACT.md)。主代码入口：

- [goal-repair.ts](../../src/logic/dispatch/runtime/goal-repair.ts)：错误分类、反馈及限次。
- [scope-goal-service.ts](../../src/logic/tasks/runtime/scope-goal-service.ts)：`repairContext` 与旧候选/当前交付证据核验。
- [automatic-return.ts](../../src/logic/tasks/rules/automatic-return.ts)：持久批次的严格结构与不可变不变量。
- [automatic-return-service.ts](../../src/logic/dispatch/runtime/automatic-return-service.ts)：记录原批次、重启前核实。
- [auto-collaboration.ts](../../src/logic/dispatch/runtime/auto-collaboration.ts)：最终关闭、返工调度、恢复批次及停止竞态。
- [execution-manager.ts](../../src/logic/conversation/runtime/execution-manager.ts)：共享系统接续机制、去重、原生会话与准入。

## 代表性运行证据

`goal-repair-pi.test.ts` 实际执行 Node 检查，发现文件为 `broken` 后退出码为 1；首轮提前结束触发验收拒绝，系统启动第二主轮，实际写入 `fixed`、再执行检查退出码为 0，审阅并完成。原失败回执保留。

`application-collaboration-pi.test.ts` 的 restart 分支在独立 Node 宿主内实际启动 Application/Pi，成员写入成果并交付后，在回传前强制终止宿主。新 Application 读取原持久状态，自动回传、审阅关闭；成员始终只有一个 run，模型请求数未增长，成果文件保留。再次打开不重放。负向分支分别覆盖损坏原日志、已有无启动日志的主轮意图、已取消及模型配置改变，均不启动新模型。

这些用例使用真实执行引擎、文件系统、调度日志和进程；模型响应由 localhost 的确定性 SSE 服务提供。未进行在线模型推理能力、桌面 UI 或真实项目长时间无人值守验收，不能把这组机制验证等同于这些结论。

## 实际测试命令与结果

下表测试命令均使用 `pnpm exec vitest run` 加列出的文件/选择器，同时带 `--reporter=default --reporter=json --outputFile=test-results/<报告>.json`；控制台输出保存在同目录或对应本地日志。分批测试在新增实现、失败修正及新边界出现时执行，没有重复运行全仓。

| 文件与选择器 | 报告前缀 | 结果及选取原因 |
| --- | --- | --- |
| `tests/goal-repair.test.ts tests/application-collaboration-pi.test.ts tests/auto-collaboration.test.ts tests/scope-goal.test.ts` | `goal-repair-initial` | 64 通过；策略、协调器、目标核验及真实 Pi 漏审阅后补审阅 |
| `tests/auto-collaboration.test.ts tests/scope-goal.test.ts tests/continuation-source-core.test.ts tests/continuation-source-view.test.ts tests/claude-engine.test.ts tests/codex-engine.test.ts tests/public-run-events.test.ts` | `goal-repair-boundaries` | 85 通过、1 失败；发现业务拒绝的持久化不变量遗漏，保留失败报告 |
| `tests/scope-goal.test.ts tests/human-continuation-core.test.ts tests/human-continuation-service.test.ts` | `goal-repair-rejection` | 修正后 38 通过；业务替代与人工接受不能混淆 |
| `tests/goal-repair-pi.test.ts` | `goal-repair-real-command` | 1 通过；真实失败命令→自动修复→复测成功 |
| `tests/application-collaboration-pi.test.ts tests/auto-collaboration.test.ts tests/auto-continuation-recovery.test.ts tests/dispatch-scope.test.ts tests/dispatch-scope-wait.test.ts` | `automatic-return-initial` | 66 通过；新增持久批次对已有协作、重启封存及等待的影响 |
| `tests/application-collaboration-pi.test.ts -t 'reopen \(restart\)'` | `automatic-return-crash` | 1 通过；真实宿主被终止后自动回传，其他用例被选择器排除 |
| `tests/application-collaboration-pi.test.ts -t 'restart-corrupt\|restart-pending\|restart-stopped'` | `automatic-return-crash-negative` | 3 通过；损坏、未知启动意图、已停止均不重放 |
| `tests/automatic-return.test.ts tests/application-collaboration-pi.test.ts tests/auto-collaboration.test.ts -t 'restart-model\|批次\|旧周期\|最终验收返工'` | `automatic-return-final-boundaries` | 16 通过；冻结批次、旧数据、模型变化、返工及停止竞态 |
| `tests/scope-budget-pi.test.ts tests/scope-run-tracking.test.ts tests/member-pause-service.test.ts tests/scope-detail-recovery.test.ts` | `automatic-return-consumers` | 27 通过；原预算、累计主轮、显式成员等待及公开恢复详情消费者 |

表中选择器的 `\|` 是 Markdown 表格转义，命令中的正则为 `|`。`pending` 计数来自 `-t` 排除其它用例，不是被跳过的失败或尚未实施功能。崩溃测试宿主最初遇到 tsx/CJS 不支持顶层 await，改为显式 async 入口后通过。

按现行测试名称去重，共 **20 个测试文件、164 项通过、0 项未解决失败**。初版 `scope-goal` 单用例后来展开为 `stale/rejected` 两个参数用例，不将已替换的旧名称重复计数。旧失败由后续同名 `rejected` 用例通过覆盖；不相加多轮报告的测试次数冒充覆盖量。

静态检查：

- `pnpm typecheck`：通过；日志 `test-results/automatic-return-typecheck-final.log`。此前发现新恢复协议错误使用 `claude`，已改为共享 `loopEngineSchema` 的真实 `claude-code` 类型。
- `node scripts/source-architecture.mjs`：按实际代码同步受影响图；最终 `pnpm check:architecture` 通过，87 个目录无图差异，1348 文件、6875 条依赖、零循环、零边界违规。日志 `test-results/automatic-return-architecture-final.log`。
- `git diff --check`：通过；本机 LF/CRLF 提示不涉及差异格式错误。

## 维护者 review 与演进判断

这次是 C1 变更验证、L2 跨模块状态与恢复语义交付；没有调整全局分层或退役旧引擎。阅读范围集中在目标、协作、主会话、持久协议、三个引擎来源转换和公开投影及其消费者，不声称全仓逐行审计。

四问归档：保护原 Store 的不可变历史、运行去重、权限、预算与人工验收；将返工分类放在纯策略、恢复资格放在独立服务，共享已有日志核验和系统启动机制；按实际传播到来源协议、引擎适配、等待/预算/人工消费者选择上表验证；下一次增加可修复错误先改 `goal-repair.ts`，增加可恢复场景先改 `AutomaticReturnService.inspect` 和真实崩溃用例。第五问暂无新增强制规则候选。

相比继续遇错即阻塞，本次允许可信可修复错误自动推进；相比无条件重放，只接收已完成成果。代价是新增一个只追加批次协议及核实 IO，并有意不自动接管未完成/失败成员。协议为可选扩展，旧日志保持原样；新行为异常时应停止自动启动、保留原记录，再修正策略，不能回删日志或重新执行旧命令。

源码注释及架构文档同步覆盖 `core/execution`、`core/tasks`、三个引擎、`scheduler-engine/conversation`、`dispatch`、`goals`、`runtime`、`frontend/execution-view`；当前任务契约同步恢复范围，旧审计通过链接保留当时结论。暂未提交、推送、人工 review、合并或发布；本轮未再跑全量测试、打包或安装升级验收。此前通用代码验证的全量结果不能代替此次变更后的全量集成结果。
