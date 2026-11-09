# Step17b1 工作区资源仓库只读连接验证

日期：2026-11-07。对应计划：[首个真实资源仓库链接器](../task/resource-repository-connector.md)。本报告验证当前应用明确共享的本机仓库、独立工作区授权和真实 HTTP 读取；本片尚未装配主 Loop 工具，没有 Pi 或模型调用。

## 验证范围

同一个隔离 CBIM 应用登记两个工作区，使用测试专属临时目录保存实际资源。用户先明确开启当前仓库共享，再预览并提交工作区的 `resource_repository_v1` 静态定义，随后单独授予只读连接。定义只含仓库身份，不含地址、令牌或运行授权。

核验通过真实 HTTP GET 返回资源数量、版本及前 20 项摘要，不展示正文或秘密，不执行资源中的指令。只读令牌只在主进程使用；桌面脚本没有读取或输入凭据，也没有引入第二个应用服务、在线账号或任意 URL 连接。

## Application 与服务验证

`pnpm exec vitest run tests/repository-connection-application.test.ts` 两项通过，使用真实 Application、磁盘资源仓库和 HTTP 客户端。测试以透传方式记录请求方法与地址，不保存授权头，不替换真实 HTTP 返回。

- 工作区 A 的登记与授权分开；授权后的核验确实访问 `/v1/resources`。工作区 B 即使登记同一仓库，也因没有独立授权而被拒绝。
- 查询原授权回执不增加 HTTP 请求；撤销后核验被拒绝。停止共享后，磁盘资源仍存在且字节不变，连接核验返回 `REPOSITORY_CONNECTION_NOT_SHARED`，没有回退到本地读取。
- 在共享开启时关闭应用，再初始化后保留静态定义与授权记录，不自动开启共享或发送 HTTP 请求。显式重开共享后可沿原授权核验，但连接代际已变化。
- 两项均没有模型配置、运行日志或活动运行。

相关文件：[隔离准备](../../tests/repository-connection-fixture.ts)、[Application 测试](../../tests/repository-connection-application.test.ts)。首次测试曾将第二次明确授权自身的合法 HTTP 预检误计入“停止后的读取”，修正统计区间后两项通过，未修改产品或放松请求断言。

Root 最终定向回归汇总为 **13 个文件、76 项通过**：其中 [主要回归](../../test-results/repository-connection-unit.json) 71 项、[超时与故障分支](../../test-results/repository-connection-failure.json) 5 项。另有 [边界回归](../../test-results/repository-connection-boundary.json) **13 项通过**。这些是本步相关定向验证，不声明重新运行了全仓库完整测试。

服务定向覆盖只读令牌的 POST/DELETE 拒绝、撤销与代际竞争、取消、真实超时、返回上限、错误不泄露凭据，以及旧实例原请求回执与明确未受理查询。桌面没有为这些分支添加生产测试入口。

## 最终 Windows EXE

产物：`build/20261107-123831/CBIM Assistant-win32-x64/CBIM.exe`。`build/latest-build.json` 时间戳 `20261107-123831`，阶段 `package`。执行命令：

```text
pnpm exec tsx scripts/repository-connection-ui-smoke.mts
```

最终脚本进程退出码为 **0**。同一 EXE 完成以下实际界面操作：

1. 为两个工作区填写不同的普通会话草稿；在设置中保存隔离仓库目录，在人才市场真实保存一份资源，再明确启动仅本机共享。
2. 在链接器页选择工作区 A，预览静态定义并确认登记。预览阶段知识版本不变，登记后仍未授权；随后真实点击“允许只读连接”和“核验连接”，显示真实资源名称、摘要和版本，不显示正文标记。
3. 工作区 B 单独登记同一仓库，但不授权。“核验连接”禁用，独立调用后端核验返回 `REPOSITORY_CONNECTION_NOT_GRANTED`，不继承 A 的授权或结果。
4. A 明确撤销访问，版本递增且读取被拒绝；重新明确授权后，停止共享。仓库文件仍存在且字节不变，后端拒绝核验，旧 HTTP 端口已关闭。
5. 再次通过设置明确开启共享，保持服务真实开启后退出 EXE。完整重开时共享仍关闭，刚才端口不可连接，原知识和授权记录保留，两个普通草稿保留。

页面错误 **0**，意外原生对话框 **0**；没有未处理的 IPC 失败。未授权、撤销和停共享的预期业务拒绝均有明确断言。模型请求 **0**，没有配置模型，重开前后均无运行日志、活动运行或任务重放。

### 原回执查询的明确故障注入

真实点击 A 的授权并取得成功结果后，测试从实际 `cbim:call` 捕获该次公开请求参数，将完全相同的请求重新保存为本地 pending，以模拟响应丢失。没有伪造后端授权或回执，也没有修改生产代码。

切换页面再回来后，界面显示原授权待确认，并禁止发起新的核验。真实点击“查询原命令回执”后，pending 清除；授权记录和版本不变，新增授权调用 **0**、新增 HTTP 请求 **0**。统计只观察调用数量，不记录令牌、授权头或资源正文。

### 脚本定位修正

最终成功前有两次相同的测试定位超时：侧栏按钮的完整可访问名称为“链接器 工具桥梁”，旧脚本以 `exact:true` 仅匹配“链接器”。第一轮尝试修正时，PowerShell 到 Node 的中文字符串替换没有匹配原文，第二次仍执行了旧定位。随后用补丁将定位收敛到侧栏 `.primary-nav` 内的 `/^链接器/`，确认落盘后，同一 EXE 完整通过。

两次均在资源已保存、共享已开启后、进入连接页前发生，页面错误和弹窗均为 0；它们是脚本失败，不记为产品功能失败。产品源码未为此修改或重打包。失败证据独立保留，不覆盖最终成功结论。

## 回执、截图与清理

- [最终桌面回执](../../test-results/repository-connection-ui-smoke.json)
- [开启共享](../../test-results/repository-connection-sharing.png)、[定义预览](../../test-results/repository-connection-preview.png)、[HTTP 核验](../../test-results/repository-connection-verified.png)
- [待确认原授权](../../test-results/repository-connection-pending-receipt.png)、[查询回执后](../../test-results/repository-connection-receipt-queried.png)
- [工作区 B 未授权](../../test-results/repository-connection-workspace-isolation.png)、[A 撤销](../../test-results/repository-connection-revoked.png)、[停止共享](../../test-results/repository-connection-sharing-stopped.png)、[完整重开](../../test-results/repository-connection-restored.png)
- [首次定位失败](../../test-results/repository-connection-initial-selector-failure.json)、[第二次相同定位失败](../../test-results/repository-connection-repeated-selector-failure.json)

已实际查看 HTTP 核验、工作区隔离、待确认回执和重开截图，界面状态与断言一致。结束后核实本构建 `CBIM.exe` 进程数为 **0**，本片 `cbim-repository-connection-ui-*` 临时目录数为 **0**。只清理经过绝对路径校验的本片隔离目录；历史被自动审批拒绝的目录和用户数据均未触碰。报告与截图保留在 `test-results/`。

Root 最终类型检查与架构检查通过：**575 个维护文件、2575 条依赖、0 个循环**；337 个源码/样式文件、46 个目录，本步同步 9 份 `ARCHITECTURE.md`。桌面入口也通过独立严格 TypeScript 检查。

## 限制

- 本片只完成桌面真实只读连接核验；主 Agent 调用属于后续 Step17b2，不能把本片零模型请求解释为 Pi 已接通。
- 未接账号、跨物理电脑或任意外部仓库连接，未给通用 Cindy 插件增加可执行能力。
- HTTP 成功证明指定版本的资源摘要可读取，不证明内容正确、可信或已被应用到业务项目；资源内容不授予工具权限。
- 桌面验证覆盖代表性正常授权、撤销、共享生命周期和原回执查询；并发、异常输入、只读令牌写拒绝等由服务/边界测试覆盖，不宣称穷尽全部网络故障。
- 未恢复 CBIM 对外 MCP 服务，也没有自动共享、隐式重试或磁盘回退。
