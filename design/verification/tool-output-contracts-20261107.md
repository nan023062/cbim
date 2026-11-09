# Step17a 知识工具业务输出契约验证

日期：2026-11-07，承接 Step16a 提交 `df60966`。本报告记录真实 Pi 定向测试和同一最终 Windows 包的桌面验收；不将确定性模型响应视为在线模型质量验证。

## 验证范围

原有 26 个知识工具补业务输出契约，新增 `cbim_knowledge_tool_catalog`、`cbim_knowledge_tool_describe` 两个按需说明入口。实际目录包含 28 项，`family` 为 `knowledge`；目录返回名称、版本和副作用摘要，单项说明才返回输入/输出 Schema、取消与恢复说明。目录不包含主调度工具或原生业务工具，说明也不授予执行权限。

本次端到端路径依次调用真实身份、目录、知识提交契约、知识快照、无效候选预览及不存在的维护任务查询。无效预览返回 `validation.structural=false` 和真实问题列表，`not_found` 同样作为合法业务结果记录成功回执。两种诊断均不修改正式知识。

主 Agent 随后建立治理目标计划，经逐次审批调用知识事务修改隔离项目的 `.cbim/README.md`，再读取实际新版本，以真实 `main-knowledge` 回执完成审阅。整个流程没有派发成员，也未提供主 Agent 的 `write`、`edit` 或 `bash` 工具。

## 真实 Pi 定向结果

命令：`pnpm exec vitest run tests/knowledge-contract-pi.test.ts`。实际 3 项全部通过；该次运行耗时约 5.38 秒。

| 场景 | 主/成员模型请求 | 实际结果 |
| --- | --- | --- |
| 正常查询、合法诊断、审批后知识提交与审阅 | 11/0 | 提交恰好一次，周期 `completed` |
| 知识提交尚在等待审批时停止 | 8/0 | 未调用提交，文件和知识版本不变，周期 `cancelled` |
| 真实事务完成后，测试注入损坏的返回字段 | 11/0 | 返回 `TOOL_OUTPUT_INVALID`，工具回执失败，周期 `failed`；实际提交保留且没有重试 |

故障注入仅位于测试：先调用真实 `workspace.commit` 并等待事务完成，再将返回值的 `changed` 数组替换为错误类型。没有模拟磁盘提交，也没有向产品添加测试入口。测试核实实际提交调用仅一次、正文标记仅出现一次、原请求事务文件仅一份；canonical 和 Pi 原生历史均保存完整的错误工具结果，错误不泄露注入的正文标记。后续仅重新读取实际知识并记录阻塞，没有重复提交。

三项均核对审批清空、无悬而未决工具、无成员任务/运行。应用关闭再初始化后，知识版本、任务图和持久记录保持，canonical 与原生日志字节不变，模型请求数没有增加。

相关文件：

- [真实 Pi 测试](../../tests/knowledge-contract-pi.test.ts)
- [本机确定性响应服务](../../tests/knowledge-contract-provider.ts)
- [隔离应用准备](../../tests/knowledge-contract-fixture.ts)

`pnpm typecheck` 已通过。桌面 `.mts` 入口另以严格 TypeScript 配置检查通过；本节不代替最终完整回归。

## 最终 Windows 桌面验收

最终产物为 `build/20261107-120219/CBIM Assistant-win32-x64/CBIM.exe`；`build/latest-build.json` 的时间戳为 `20261107-120219`，阶段为 `package`。两项均使用此 EXE、真实 Electron/Pi、隔离工作区和本机确定性响应服务，不使用在线供应商或用户账号。

执行入口：[knowledge-contract-ui-smoke.mts](../../scripts/knowledge-contract-ui-smoke.mts)。

| 命令参数 | 主/成员请求 | 真实界面操作与结果 |
| --- | --- | --- |
| 默认 | 11/0 | 等待知识提交审批，确认正式知识尚未修改；真实点击“允许一次”，提交一次后目标显示完成 |
| `--stop` | 8/0 | 在真实知识审批卡出现后点击“停止执行”；未提交、知识保持原样，界面显示本轮已停止 |

两项均验证 28 项目录、单项提交恢复说明 `same_request`、合法无效预览与 `not_found` 诊断。桌面场景不注入损坏返回值，故障注入与真实点击证据分开保留。

两项页面错误、通信错误及原生弹窗均为 0。主会话及另一会话的独立草稿均保留；完整关闭重开后，无新增模型请求、知识变更或任务重放，任务图与持久记录保持，已有 canonical/原生日志字节不变。真实审批、完成/停止和重开截图已经查看。结束后核实该构建的进程数为 0，自有 `cbim-knowledge-contract-ui-*` 临时目录数为 0；未清理其它测试或用户数据。

回执与截图：

- [正常场景回执](../../test-results/knowledge-contract-complete-ui-smoke.json)、[真实审批](../../test-results/knowledge-contract-complete-real-approval.png)、[完成](../../test-results/knowledge-contract-complete-result.png)、[重开](../../test-results/knowledge-contract-complete-restored.png)
- [停止场景回执](../../test-results/knowledge-contract-stop-ui-smoke.json)、[待批现场](../../test-results/knowledge-contract-stop-real-approval.png)、[停止](../../test-results/knowledge-contract-stop-result.png)、[重开](../../test-results/knowledge-contract-stop-restored.png)

## 完整回归

首次完整回归覆盖 173 个文件、982 项测试，981 项通过、1 项失败。唯一失败为 `tests/builtins.test.ts` 的旧工具数量断言仍期望 26，实际新增两个按需说明入口后为 28；回执为 [knowledge-contract-unit.json](../../test-results/knowledge-contract-unit.json)。不能将这次运行记为全量通过。

随后仅修正该测试的数量断言，并显式核对两个新增工具，不改产品代码，因此最终 EXE 无需重打。修正后 `builtins`、`knowledge-tool-contracts`、`tool-output-wire`、`knowledge-tool-output` 四文件共 16 项全部通过，结果见 [定向 JSON](../../test-results/knowledge-contract-final-targeted.json)。没有重新运行完整回归，不改写上述首次全量事实。

## 限制与结论边界

- 输出 Schema 核验的是业务返回协议，不证明知识正文语义、架构设计或业务验收正确。
- 协议错误不表示事务已回滚；提交后损坏用例明确证明“工具失败”与“没有发生修改”不能等同。恢复仍须按真实请求 ID、输入和领域规则核实，不做通用自动重试。
- `preflight_only` 说明只在调用前响应取消。本次停止在审批尚未放行时发生，不宣称可以中断或回滚已经开始的事务。
- 端到端测试执行了代表性知识查询、预览和提交；并未逐项调用所有 28 个工具的每一个输出分支。工具映射与严格 Schema 异常分支由独立契约测试补充，不宣称穷尽全部业务数据组合。
- 本步没有接通外部插件传输，没有为主 Agent 增加业务文件/命令权限，也没有证明在线 LLM 的自主规划、供应商账单或跨机器行为。
