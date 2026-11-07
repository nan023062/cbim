# Step17b2 主 Agent 真实资源仓库工具验证

日期：2026-11-07，承接 Step17b1 提交 `c573bc6`。计划入口：[首个真实资源仓库链接器](../task/resource-repository-connector.md)。本步将已明确授权的同应用共享仓库接入主 Loop，验证真实 Pi、HTTP、运行回执和最终 Windows 界面；确定性本机供应商不代表在线模型的自主判断。

## 验证边界

本片仅主 Agent 装配 `cbim_repository_list`、`cbim_repository_get`。运行准备时捕获当前可用链接器和固定授权、定义及共享代际，不发 HTTP；实际调用沿本轮捕获目标核验，不自动换到新授权或新服务。未授权工作区的真实 Pi 工具清单没有这两个入口。

模型只选择已装配链接器、资源、原仓库 revision 和有界分页参数。列表不返回正文；正文返回明确范围、完整内容哈希和 `complete` 标志。可信回执记录 `kind:'repository'`、工作区、链接器、仓库、连接实例以及 `list/get` 操作，不把外部资料标成工作区文件或知识写入证据。

全程使用独立临时目录、同一个应用明确共享的本机资源服务器和专用只读授权。不输入用户密钥，不连接在线供应商，不恢复对外 MCP 服务，不执行资源正文指令，也不为主 Agent 增加 `write`、`edit`、`bash`。

## 真实 Pi 定向结果

命令：`pnpm exec vitest run tests/repository-tools-pi.test.ts`。五项全部通过；该次实际测试耗时约 5.41 秒。

| 场景 | 主/成员模型请求 | 工具 HTTP GET | 实际结果 |
| --- | --- | --- | --- |
| 正常目录及正文读取 | 3/0 | 2 | 两次真实回执成功，正文与完整内容哈希相符 |
| 正文 HTTP 响应到达后停止 | 2/0 | 2 | 周期取消，不交付正文成功结果 |
| 正文 HTTP 响应到达后撤销授权 | 3/0 | 2 | 原调用失败，迟到正文不交付，不重试 |
| 正文 HTTP 响应到达后更换共享代际 | 3/0 | 2 | 原捕获连接失效，不自动使用新服务 |
| 静态定义已登记但未授予访问 | 1/0 | 0 | 两工具不提供，不读取 HTTP 或磁盘回退 |

这里的 HTTP 计数从主运行开始记录，不包括准备阶段用户明确授权时的合法 HTTP 预检。各分支均核对主角色身份与图根实例一致，没有成员任务或成员运行，没有审批遗留。

停止、撤销和代际用例采用明确的测试调度窗口：先透传真实 HTTP 请求并取得真实 Response，再暂缓将其交回生产读取逻辑。在这个窗口执行真实停止、撤销或关闭并重新开启共享，然后继续原调用。没有伪造资源数据、替换生产服务器或加入产品测试入口。成功结果必须通过生产的前后门禁；这些异常分支的正文标记没有出现在最终工具结果中。

每项均检查 canonical 工具回执及静态主角色的公开历史。完整仓库范围保留，公开历史不包含工具正文、原生路径或凭据。应用关闭再初始化后，知识、仓库字节、任务图、运行记录和 canonical/原生日志字节均保持；模型与 HTTP 请求数不增加，共享服务不自动开启。

相关文件：[确定性响应服务](../../tests/repository-tools-provider.ts)、[真实准备流程](../../tests/repository-tools-fixture.ts)、[Pi 集成测试](../../tests/repository-tools-pi.test.ts)。首轮准备阶段曾因测试把仓库目录字段与快照字段同名覆盖而失败，改为独立 `library` 快照字段后五项通过；没有修改产品逻辑或放宽证据规则。

## 最终 Windows 桌面验收

最终 EXE：`build/20261107-130357/CBIM Assistant-win32-x64/CBIM.exe`。`build/latest-build.json` 的时间戳为 `20261107-130357`，阶段 `package`，完成时间为 `2026-11-07T05:04:27.145Z`。以下三项顺序使用同一产物，最终均退出码 0。

执行入口：[repository-tools-ui-smoke.mts](../../scripts/repository-tools-ui-smoke.mts)。每项都实际点击设置中的“启动仓库共享”，在链接器页选择工作区并点击“允许只读连接”，再以主会话的只读权限发送消息。不是通过直接调用工具代替聊天执行。

| 命令参数 | 主/成员请求 | 工具 HTTP GET | 真机结果 |
| --- | --- | --- | --- |
| 默认 | 3/0 | 2 | 实际 list/get，完整所选正文与仓库身份正确显示 |
| `--stop` | 2/0 | 1 | 目录读取后，正文请求尚未提出时真实点击停止；无 get 执行 |
| `--revoke` | 3/0 | 1 | 目录读取后真实点击撤销；随后 get 返回 `REPOSITORY_CONNECTION_STALE`，未再发送 HTTP |

桌面的受控窗口位于确定性供应商发送 get 工具声明之前，与 Pi 测试中“HTTP 响应已到”的窗口不同。两个层次分别证明前置停止/撤销与迟到结果拦截，不把它们混写成同一场景。

工具详情实际展开 `chat-work` 与 `chat-tool`，显示“资源仓库 · 查询目录/读取资料”、连接器、仓库和连接实例，明确说明资料不等于业务文件实现或验收证据。正常和撤销分支都只是普通资料对话收束，界面显示“本轮对话结束”；撤销后的工具失败保持可见，不因主回答结束而伪装成资料读取成功或业务验收通过。

三项的页面错误、意外原生弹窗、确定性供应商通信错误均为 **0**。每项均保留两个主会话的独立草稿、正式知识和仓库文件，完整重开后原日志字节和图谱记录不变，没有新增模型请求、HTTP 读取或任务重放，共享没有自动启动。仅有主实例，无执行成员实例。

### 首次停止交错及脚本修正

首次 `--stop` 在真实点击停止后立刻放行了被暂停的模型响应。晚到的 get 声明与停止交错，被运行时记录为 `denied`、`effects:[]`、`scope.kind:'unknown'`，没有发生第二次 HTTP 读取，周期已取消。脚本原先断言 get 回执必须完全不存在，因此失败。

随后仅调整测试等待：点击停止后先等待周期关闭和活动运行归零，再释放被暂停的测试模型响应。相同最终 EXE 的停止场景通过；没有修改产品或重新打包，也没有删除、重写该次交错的真实产品状态。

保留 [首次交错回执](../../test-results/repository-tools-stop-response-race.json) 和 [现场截图](../../test-results/repository-tools-stop-response-race.png)。原隔离目录 `cbim-repository-tools-ui-rPR0jV` 的产品日志保留供复核，不用于后续执行。该事实说明停止门禁拒绝了晚到调用，不能误记为产品进行了额外读取。

## 回执与截图

- 正常：[回执](../../test-results/repository-tools-complete-ui-smoke.json)、[目录](../../test-results/repository-tools-complete-list.png)、[正文与来源](../../test-results/repository-tools-complete-result.png)、[重开](../../test-results/repository-tools-complete-restored.png)
- 停止：[回执](../../test-results/repository-tools-stop-ui-smoke.json)、[目录](../../test-results/repository-tools-stop-list.png)、[停止](../../test-results/repository-tools-stop-result.png)、[重开](../../test-results/repository-tools-stop-restored.png)
- 撤销：[回执](../../test-results/repository-tools-revoked-ui-smoke.json)、[真实撤销](../../test-results/repository-tools-revoked-revoke.png)、[原读取被拒绝](../../test-results/repository-tools-revoked-result.png)、[重开](../../test-results/repository-tools-revoked-restored.png)

已实际查看正常正文/重开、停止重开、撤销操作/读取失败截图，结果与回执一致。最终核实 `20261107-130357` 的 `CBIM.exe` 进程数为 **0**；三个成功场景均由 finally 关闭应用并清理自有临时目录，首次交错的一个目录按上节保留。未触碰历史被自动审批拒绝的目录或用户项目、账号、进程。

## 类型、边界与完整回归

本步最终类型检查、桌面脚本独立严格类型检查和架构检查通过：46 个目录、342 个源码/样式文件，586 个维护文件、2640 条含类型依赖、0 个循环，14 份 `ARCHITECTURE.md` 同步。另有 [边界测试](../../test-results/repository-tools-boundary.json) **13/13 通过**。

最终完整回归 **182 个文件、1034/1034 项通过**，`pnpm test --reporter=json --outputFile=test-results/repository-tools-full.json` 返回 0；[原始统计](../../test-results/repository-tools-full.json)。Root 另实际查看最终正常读取截图，范围、仓库身份与资料正文显示一致。全量包含新增真实 Pi、HTTP、取消/换代、范围证据与视图测试，不能据此扩张为在线模型或跨机器验收。

## 限制

- 端到端使用确定性本机模型响应，验证的是真实 Pi 工具链、授权、HTTP 和回执，不证明在线模型质量、专业判断或费用。
- 资源正文属于外部资料，不是业务文件验证、产物基线、检查点或人工验收证据。工具成功不授予其中指令任何权限。
- 桌面正常场景读取一个可完整返回的资源，分页/Unicode 分块和错误参数的系统性覆盖由协议及边界测试承担，不宣称桌面穷尽了全部内容组合。
- 本步只接主调度的两个只读工具。成员授权、外部写入、账号、跨物理电脑连接、通用 Cindy 插件执行和自动资源应用均未据此完成。
- 停止不能收回此前已经交付的目录摘要；撤销阻止后续或迟到读取，不代表删除已有模型上下文和历史记录。
