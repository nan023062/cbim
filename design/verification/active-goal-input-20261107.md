# 运行中补充的目标输入版本与完成门禁验证

状态：2026-11-07，Step27 已完成最终相关回归和同包 Windows 真机验证。本文区分修复前基线、首轮测试问题、最终冻结源码及桌面事实，不将本机确定性模型等同在线自主质量。

## 修复前的独立基线

在产品修改前，以 `git archive ea680de` 导出完整源代码、运行规范和测试到独立临时目录，仅 `node_modules` 连接已有依赖，没有切换主工作树或修改 Git 状态。位置回执为 `test-results/active-goal-input-baseline-location.json`。基线测试和 `source.tar` 仍保留在该目录，可重复运行，不依赖正在修改的产品源码。该目录含依赖 junction，明确保留，不纳入桌面临时目录清理，也不递归删除或声称所有临时目录均已清除。

两条真实 Application + Pi 链均使用本机确定性 HTTP/SSE 供应商：主计划、派工、成员实际读取文件、提交候选、主保存 `complete` 或 `awaiting_user` 审阅后，保持该主运行并调用真实 `loop.queueInsert`。原生 `queued` 和 canonical `accepted` 日志已经出现，新用户正文也进入后续模型请求，但 `goal` 整体不变，输入版本仍为 1、目标版本仍为 3，未产生目标补充记录。

| 旧审阅 | 新补充后供应商行为 | 基线实际结果 | 主/成员 HTTP 请求 |
| --- | --- | --- | --- |
| `complete` | 故意只回复，不重新规划或审阅 | `closed/completed` | 7 / 5 |
| `awaiting_user` | 故意只回复，不重新规划或审阅 | `waiting` | 7 / 5 |

`test-results/active-goal-input-baseline-pi.json` 的 **2/2** 表示成功复现旧缺陷，不表示旧行为正确。两份完整身份/版本/原生日志事实在 `active-goal-input-baseline-stale-complete.json`、`active-goal-input-baseline-stale-waiting.json`。

## 新版本真实 Pi 覆盖

新文件为 `tests/active-goal-input-provider.ts`、`active-goal-input-fixture.ts`、`active-goal-input-pi.test.ts`。供应商只控制响应和保持窗口，计划、图、文件读取、成员候选、原生日志、插入与目标事务使用真实产品路径。

| 场景 | 实际结果 | 主/成员请求 |
| --- | --- | --- |
| 旧完成审阅后接收补充但不重新规划 | 输入版 2、旧审阅清除，周期失败 | 7 / 5 |
| 旧等待审阅后接收补充但不重新规划 | 不允许沿旧审阅停泊，周期失败 | 7 / 5 |
| 接收一次后重规划及审阅 | 输入版 2，按新计划完成 | 12 / 5 |
| 同一原主运行接收两次 | 两个接收记录共用原 run，输入版 3 | 17 / 5 |
| active 补充后安全 waiting，再显式继续 | `activeInputs` 与 `continuations` 合并为连续输入版 3 | 17 / 5 |
| 同 run 两次补充、waiting、显式继续 | 原始目标不变，连续输入版 4，原成员不重跑 | 22 / 5 |
| 真实原生 queued 后测试丢确认 | `unknown`，旧审阅不能完成；重试不再次发送 | 7 / 5 |
| 真实 ACK 后目标接收事务前故障 | 原记录 `pending`，周期失败，不冒充未发送 | 7 / 5 |
| 真实 `get_state` 返回保持期间停止 | 未发 steer，记录 `rejected`，不升输入版 | 6 / 5 |
| 真实 queued ACK 保持期间停止 | 接收记录先保留并升版，周期最终取消 | 6 / 5 |

所有场景保留原始 `goal.input`；目标与原生主会话身份沿实际记录核对。重复同队列身份不重发、不重复升版。结束后关闭并重新创建 Application，核对图、周期、主日志和原生文件字节；队列仅沿已有重启规则变为暂停，无新增模型请求。

首轮 `active-goal-input-pi-initial.json` 为 **8/10**：两个等待续接场景的测试配置误写 `provider:'pi'`，真实配置应为 `cbim-<profileId>`，因此被生产模型配置检查正确拒绝。修正测试配置后，仅补跑等待相关三个匹配场景，`active-goal-input-waiting-pi-final.json` 为 **3/3**；十个场景去重均已通过。首轮另有测试错误读取不存在的摘要 `nativeSessionId`，已改为严格读取 `session.bound.data.sessionId` 并要求非空；最终冻结回归须覆盖这一加强后的断言。

故障注入只发生在测试层：Pi RPC 在真实 ACK 后抛出明确测试错误，或者接收服务在真实 ACK 后、目标事务提交前失败。没有伪造业务读取、候选、目标完成或恢复回执。

## 旧队列回归断言与持久幂等

首轮全仓 `test-results/active-goal-input-full-before-final-fix.json` 共 **232 文件、1425 项，1423 通过、2 失败**，耗时 763.41 秒；该结果发生在最后门禁修正之前，不能称为最终全仓通过。两个失败均为旧测试的精确返回语义已随本片持久记录变化：

- `queue-insert.test.ts` 原来要求原运行结束后的同队列插入拒绝；现在先查询持久 `accepted` 并成功返回 `undefined`。测试已要求实际 steer 仍恰好一次、模型请求数不变、输入仍为第 2 版，并逐字比较 canonical 与原生文件、完整周期和空队列。
- `queue-insertion-pi.test.ts` 的 `state-stop` 在 get_state 前已登记尝试，原 run/queue 的持久 `rejected` 重查应返回 `QUEUE_INSERT_STOPPED`；附件准备期尚未登记的 `images-stop` 仍精确要求 `QUEUE_INSERT_STALE`。二者均额外核对无新 steer、周期和队列不改、旧摘要/原生字节不改，新主 run 没有接收旧输入。

仅修改上述两个旧测试后，`test-results/active-goal-input-legacy-pi-final.json` **2 文件、6/6** 通过。没有把任意错误视为成功，也没有放宽原运行或停止边界；两文件也进入下述最终组合回归。

## 交叉审查发现的补充门禁问题

最终全仓回归期间保持源码冻结；独立审查在不修改源码的前提下，用合法完整图批次复现了两个同源问题：活动未决输入的派发限制只判断 `task.dispatched` 标签，换成 `task.created` 可以绕过；相同检查又会把已关闭旧周期的 unknown 记录应用到同主会话的新周期，误拦新派工。

最终实现按实际新增任务/运行及活动周期范围判定，不把事件标签当成事实。已关闭旧周期保留未知历史，但不能永久阻止新周期；已接收后的旧计划只阻止原周期的新领取，已有运行结算仍可完成。Core 最终相关 6 文件 **64/64**、实际 FileDispatchStore 服务 **9/9**，其中合法完整派发批次只改 cause 仍被未决门禁拒绝，解消后同一批次可提交；已关闭 unknown 后的新周期能真实派发和持久领取。全仓结果和最后修正后的定向结果分别保留。

## 最终冻结产品验证

- `pnpm typecheck`、`pnpm check:architecture` 均退出 0。51 个目录、392 个源码/样式文件；715 个维护文件、3415 条含类型依赖、0 循环。更新 11 份目录类图，Core brain/tasks、调度 conversation/execution/tools、前端 tasks 共 6 份 CONTRACT 与相关中文注释同步。
- 最终 22 个相关测试文件 **213/213**：`test-results/active-goal-input-combined-final.json`；包括十条真实 Pi、旧队列、目标/等待/人工继续、成员执行与新门禁回归。另 2 文件 **13/13** 架构边界：`active-goal-input-boundaries-after-gate.json`。这两个统计与前面的全仓初轮区分，不宣称最后源码重新通过全部 1425 项。
- `pnpm make` 退出 0，`build/latest-build.json` 为 `stage:make`，最终包号 **20261107-194848**，程序 `build/20261107-194848/CBIM Assistant-win32-x64/CBIM.exe`。Forge 依赖的 `fs.rmdir` 弃用提示不影响本次构建结果。

## Windows 桌面验收结果

脚本 `scripts/active-goal-input-ui-smoke.mts` 在最终 EXE `20261107-194848` 依次完成三种模式，均退出 0：

- 正常：真实点击两次插入，同 run 输入升版；任务根查看两条历史，安全等待后两卡共享补充，再明确点击继续，最终第 4 版完成。
- `--stop`：测试仅暂存该 EXE 自有 Pi 子进程对精确 steer 命令 ID 的真实 queued 回包，实际点击可用停止按钮后释放；接收事实与最终取消分别核对。
- `--unknown`：测试在同一精确回包边界保存原 queued 事实，再将其替换为明确传输故障；核对 `unknown`、暂停队列、旧审阅不能完成及重开无重放。此为受控确认丢失注入，不宣称自然网络故障复现。

| 模式 | 实际结果 | 主/成员请求 |
| --- | --- | --- |
| 正常 | 同原运行两次接收，等待后两处表单共享补充，明确继续后输入第 4 版完成；原始目标不改、原成员不重跑 | 22 / 5 |
| 停止 | 真实停止 IPC 开始取消后释放原 queued ACK，保存 accepted、输入第 2 版，最终 `closed/cancelled` | 6 / 5 |
| 确认丢失 | 保留真实 queued 原回包，替换精确 RPC 回复后得到 unknown；输入不升版，旧审阅不能完成、队列暂停 | 7 / 5 |

三场普通草稿均保留，页面/通信错误 0；完整重开后原图、周期、canonical/原生字节与请求数不变。回执为 `test-results/active-goal-input-{complete,stop,unknown}-ui-smoke.json`。正常等待界面 `active-goal-input-complete-root-waiting-history.png` 显示输入 2/3 版；停止重开 `active-goal-input-stop-restored.png` 明确“本轮已停止”；未知 `active-goal-input-unknown-settled.png` 显示“补充接收结果待核实”。Root 已实际查看这三张截图。`stop-settled.png` 为后端收口后、界面轮询尚未更新的过渡帧，不作为最终停止界面证据。

正常首轮脚本只等待历史长度为 2，就提前断言输入第 3 版，捕获了合法 pending 窗口。保留 `active-goal-input-complete-initial/` 及失败 JSON/截图；修正为等待 accepted 和输入版后同包通过。正常模式另补了截图前等待实际前端 waiting，确保记录不把旧 replanning 帧标为等待；最终脚本专项 strict TypeScript 检查退出 0，未因此修改产品。

成功场次的隔离临时目录已清理，桌面和供应商进程均已关闭。首次失败目录 `C:\Users\User\AppData\Local\Temp\cbim-active-input-ui-aqdGCc` 的删除被自动审批拒绝，工具原因仅 `blocked by policy`；已保留，没有换方式或重试。前述独立基线及依赖 junction 继续有意保留，不声称所有测试目录已清空。

## 验证限制

本机确定性供应商用于稳定产生真实工具调用和竞争窗口，不证明在线模型能自主理解新增要求，也不证明业务语义或计费正确。原生接收只表示进入输入队列，不表示模型已处理；成员候选和结构化完成审阅仍不等同人工验收。未知记录不通过新规划洗白，不自动重插或恢复旧运行。

上述日志和 JSON 均保留实际初轮失败与最终结果；不将测试脚本、构建成功或本机确定性模型结果等同于桌面业务与在线质量验收。
