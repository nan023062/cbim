# 队列插入原运行绑定与停止屏障验收

对应 [Step26 计划](../task/queue-insertion-boundary.md)，承接 `dda55f1`。使用隔离临时工作区、实际 Application/Pi 和本机确定性 SSE 供应商，不涉及用户账号、密钥或真实项目。供应商只控制响应内容/时机，不替代实际队列、运行、文件读取或原生插入。

## 真实 Pi / Application

新增 `tests/queue-insertion-pi.test.ts` 五个场景。每次均先启动真实只读主轮，队列项保存另一模型和 execute 权限；插入只能沿原 run、模型和权限。

| 场景 | 真实边界 |
| --- | --- |
| 正常插入 | 首模型响应保持进行，真实 Pi 确认 queued 后才放行响应；原 `read` 工具照常完成，下一模型请求含一次补充，没有中断原请求或授予 write/edit/bash。 |
| 附件返回迟到 | 先实际读取本工作区 PNG 快照并核对字节，测试只延迟 `inputImages` 返回；停止后放行，插入报 `QUEUE_INSERT_STOPPED`，消息仍暂停。 |
| 原生状态查询迟到 | 先得到真实 Pi `get_state` 回包，测试只延迟返回；停止后不发送 steer，原队列未消费。 |
| 原生 queued 回包未知 | 真正调用 steer 并得到 queued 后，仅测试层丢弃回包；报 `QUEUE_INSERT_UNKNOWN`、队列暂停，不自动重插。原生实际上已收到消息，因此旧运行可以继续处理，不能宣称“未发生”。 |
| 已 queued 后停止 | 真正得到 queued 后延迟交回上层，此时停止，再放行已确认回包；保留原受理事实并消费队列，不改称未接受，原运行随后 cancelled。 |

两种发送前停止场景随后显式开始同一主会话的新 run，拿旧 `expectedRunId` 再次插入明确 `QUEUE_INSERT_STALE`；新模型请求没有旧队列正文，原消息、附件和发送设置仍保留。完整重开后核对图、周期、主日志、原生文件字节和模型请求不重放。

首轮 `test-results/queue-insertion-pi-initial.json` 为 **2/5**：正常和确认 queued 后停止通过。其余三场全部通过执行边界后，仅在重开队列整体相等断言失败；既有 `MessageQueue.loadOnce` 会把暂停原因改为“应用已重启，请确认后继续队列”。测试修正为精确匹配该恢复提示，仍逐项比较 ID、正文、附件、模型、权限和暂停状态；未修改产品或放松执行门禁。修正后五场 **5/5 通过**，记录 `test-results/queue-insertion-pi-final.json`。正常、两种发送前停止后显式新轮、原生 ACK 未知各为2次真实模型请求，已确认 ACK 后停止为1次；全部重开无新增请求。

## 最终 Windows EXE

最终同一 Windows EXE `build/20261107-185053/CBIM Assistant-win32-x64/CBIM.exe`，`pnpm make` exit 0、manifest `stage=make`。桌面脚本 `scripts/queue-insertion-ui-smoke.mts` 正常、`--stop`、`--unknown` **三场通过**，各为 **2次真实模型请求**，页面错误和模型传输错误均 **0**。正常与未知场首轮通过；停止场的两次脚本问题及修正保留如下，产品没有因此修改或重新构建。

| 桌面场景 | 实际核实 |
| --- | --- |
| 正常 | 主轮只读运行时，通过真实模型/权限选择器为队列选择另一模型和 execute，再输入排队并点击插入。IPC 固定原 `expectedRunId`，原 `read` 完成，模型请求仍是旧模型且没有 write/edit/bash，队列仅消费一次。 |
| 附件返回期间停止 | 实际快照读取完成后延迟返回；界面停止按钮仍可点击，真实点击后返回 `QUEUE_INSERT_STOPPED`，旧消息及附件保留 paused。随后通过测试显式 `loop.resume` IPC 创建同 root 新主轮，旧 run 的插入请求返回 `QUEUE_INSERT_STALE`；新请求不含旧队列正文，原普通草稿保持。 |
| 成功插入后桌面回复丢失 | 实际插入成功、队列已消费后仅丢弃一次 IPC 回复；界面显示 `TEST_RESPONSE_LOST`，原运行中的用户补充可见。原生只有一次插入，后续读取不受影响，没有自动重插。 |

正常/未知场从实际输入框把消息入队，再点击真实插入按钮。停止场先通过真实 IPC 建立含本测试 PNG 的排队项；只在测试 Electron 进程内包装 `fs.promises.readFile`，仅精确匹配这一个自有快照路径，真实读取成功后延迟返回。界面实际点击插入和停止，验证停止按钮不被插入锁阻挡；不新增产品测试入口、不伪造文件或问题状态。

停止场真实原运行 `93b0e77f-e429-4436-b53f-194618fefd41` 的插入被拒；显式新运行 `fa85b6ac-7991-41fc-8241-d74cc11ab935` 保留同主会话，旧队列项 `4f71dd28-be36-4ffb-8d0c-987124c84d85` 没有消费。新轮由真实 IPC 建立，不宣称通过普通草稿“发送”启动；暂停队列存在时普通输入按既有语义继续排队，此行为没有被测试绕写或更改。

桌面 `--unknown` 是**原生与后端均已确认插入后，仅桌面 IPC 回复丢失**，此时队列应已消费。它与 Pi 定向测试的“原生 ACK 未确认→队列暂停”不同；两者都不能自动重插，报告分别记录，不能把已受理的消息说成未发送。

停止场首次在测试 hook 安装阶段失败：tsx/esbuild 为序列化 `evaluate` 内的 `restore` 箭头属性生成 `__name` helper，而目标上下文没有该 helper；改为普通对象方法后继续同包。第二次已经验证真实停止和队列保留，仅在额外新轮步骤错误地等待“发送消息”按钮超时；暂停队列下该按钮应为“加入队列”。额外身份验证改用显式真实 `loop.resume` IPC，核心插入/停止仍是实际点击。首两次 JSON/PNG 分别存于 `test-results/queue-insertion-stop-initial/`、`test-results/queue-insertion-stop-second/`；没有把它们归为产品失败，也没有删除原失败证据。

三场完整退出重开后，图、周期、主日志、原生文件字节和请求计数保持；有消息的旧队列仍 paused，仅恢复提示变为“应用已重启，请确认后继续队列”。普通草稿完整保留，没有自动继续旧队列或补发插入。

已实际打开并审阅截图：

- `test-results/queue-insertion-complete-queued.png`：原主轮仍运行，队列选择的新模型和 execute 仅留在下一轮设置，普通草稿独立。
- `test-results/queue-insertion-stop-inserting-stop-available.png`：真实附件等待时，队列编辑/发送不可用，停止按钮仍可用。
- `test-results/queue-insertion-stop-restored.png`：原停止轮、新主轮及保留的暂停队列都在，普通草稿未丢失。
- `test-results/queue-insertion-unknown-response-lost.png`：错误提示与已插入的用户补充同时可见，未重新出现同一排队项。
- `test-results/queue-insertion-unknown-restored.png`：原工具与补充历史保留，重开没有重放。

机器证据为 `test-results/queue-insertion-{complete,stop,unknown}-ui-smoke.json`，汇总 `test-results/queue-insertion-desktop-final-summary.json`。正常、停止、未知三个成功目录 `cbim-queue-insertion-ui-d0qv1n`、`cbim-queue-insertion-ui-inXsXq`、`cbim-queue-insertion-ui-c0daPq` 自动清理；两次失败目录 `cbim-queue-insertion-ui-505ww4`、`cbim-queue-insertion-ui-wNbo8N` 在保留证据并核实真实绝对路径/临时目录父级后清理。复核本包及本轮临时目录相关测试进程为0，没有触碰其他步骤保留的目录。

## 其他验证与限制

- 本片修复中发现旧界面 `busy` 共用锁会禁用插入等待时的停止按钮，已交前端 owner 同片处理，最终包已通过真实延迟窗口内点击停止的验证。
- 新脚本独立严格 TypeScript 检查与 `pnpm typecheck` 已通过；最终冻结组合 **19文件154/154**、**13项边界**、类型及架构检查全部通过。51个目录、387个源码/样式文件、702个维护文件、3315条含类型依赖、0循环，12份目录类图同步。本片未跑全仓。
- 后端 owner 初期新测试存在语法/类型问题，其原报告保留；最终组合已覆盖修正后的相关测试。它与上述真实 Pi 首轮恢复提示断言失败分别记录，不把测试编写问题误记为产品运行缺陷。
- 成员活动或安全 waiting 时普通消息仍只能排队，不把队列“同意”变成目标补充或人工验收。该兼容由相关既有实际链与本轮定向回归覆盖，不伪造快照宣称模型活动。
- 全部供应商为本机确定性响应，不证明在线模型的选择质量、真实网络故障分布或费用。
- 本片尚未把 active 插入接入结构化目标的输入版本；新要求之后旧目标审阅仍可能有效，已列为下一片修复。上述正常链是轻量对话验证，不作为该目标治理能力的证明。
