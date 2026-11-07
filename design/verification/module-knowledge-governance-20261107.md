# Step18a 模块知识治理验证

日期：2026-11-07。承接 Step17b2 提交 `21756c0`，计划入口：[模块知识治理](../task/module-knowledge-governance.md)。本步验证静态业务模块的保护登记、真实观察、精确提案、人工决定和独立实施，不包含模型治理工具或业务代码执行。

## 验证范围

使用独立临时工作区创建 `governed` 与 `free` 两个真实模块。`governed` 的既有 `module.json` 与绑定说明正文登记保护后，只有明确批准的精确正文方案可经独立实施写入；身份、模块定义和正文绑定保持不变。所有知识创建和变更均经过真实 Application、对象预览/提交及 KnowledgeStore，没有直接伪造产品账本。

本片不配置模型，不使用 Pi、在线供应商、用户密钥、用户项目或账号。模型请求数和成员运行数均为 **0**；通过无运行日志文件、全局活动运行归零及重开记录不变核对。人工决定的操作者是本机明确点击，不等同认证身份、组织所有者或业务验收人。

## Application 定向测试

入口：[准备流程](../../tests/module-governance-fixture.ts)、[Application 测试](../../tests/module-governance-application.test.ts)。命令：

```text
pnpm exec vitest run tests/module-governance-application.test.ts
```

批准、驳回、暂缓 **3/3 通过**，测试本体约 1.90 秒。

- 登记保护与保存观察、提案、决定都不修改正式知识正文；观察保存真实原文、知识版本及校验结果。
- 普通 Workspace.commit 和对象修改入口试图改写受保护正文，均被 `GOVERNANCE_PROTECTED` 拒绝；未保护模块仍可走正常提交。
- 批准之后仍须独立 apply。实施得到真实 `committed` 知识回执，实际正文等于提案的精确 afterText，`module.json` 不变，保护版本推进。
- 同决定命令、同实施命令重复调用返回原回执；实施仍只有一项记录和一个原 requestId 的知识事务文件。
- 驳回和暂缓之后的直接 apply 被 `GOVERNANCE_DECISION` 拒绝，没有实施记录或正文修改。
- 完整关闭并重新初始化后，保护、提案、决定和原回执可读；不自动实施，也不产生模型或成员运行。

测试准备初期曾为说明正文新增二级、三级标题，被既有模块结构校验拒绝。最终 fixture 改为在原“定位”段落追加说明，保留既有正文结构。该失败属于无效测试输入，没有放宽产品规则。

## 最终 Windows 桌面验收

最终 EXE：`build/20261107-135435/CBIM Assistant-win32-x64/CBIM.exe`。`build/latest-build.json` 标记 `stage: package`，完成时间 `2026-11-07T05:55:02.745Z`。以下批准、暂缓、驳回三种模式均在这一最终产物上重新执行并退出码 **0**；批准场景还断言 pending 不得残留旧成功提示，实际截图确认该问题已修复。

初轮包 `20261107-133242` 的三种桌面模式也通过，但随后全量发现两项已受理提交的关闭／重启回归，因此旧包不作为最终验收。17 份初轮 JSON/PNG 原样保留至 [初轮证据目录](../../test-results/module-governance-initial-133242/)。

生命周期修复后的中间包 `20261107-135036` 三种模式同样退出码 0。实际查看回复丢失截图时却发现：待确认区正确保留原命令，上方残留上一步“原治理命令已确认”的成功提示。数据和门禁没有误通过，但文案会误导，Root 因此修复操作开始时清除旧提示。该轮 17 份证据原样保留至 [中间包证据目录](../../test-results/module-governance-intermediate-135036/)。两轮历史证据未覆盖、删除或改写。

入口：[module-governance-ui-smoke.mts](../../scripts/module-governance-ui-smoke.mts)。实际从业务架构选择模块、点击“知识治理”，依次登记保护、填写观察、填写完整提案、勾选已审阅并点击人工决定。批准和实施是两个独立点击。

| 场景 | 实际结果 | 模型 / 成员运行 | 页面错误 / 意外弹窗 |
| --- | --- | --- | --- |
| 默认 approve | 保存批准；模拟一次真实成功回复丢失；查询原回执恢复；独立实施精确正文 | 0 / 0 | 0 / 0 |
| `--defer` | 保存暂缓及复查条件，实施按钮不可用，原正文保留 | 0 / 0 | 0 / 0 |
| `--reject` | 保存驳回，实施按钮不可用，原正文保留 | 0 / 0 | 0 / 0 |

每种模式都另外通过真实 IPC 尝试普通知识提交绕过保护，得到 `GOVERNANCE_PROTECTED`；该负向检查没有使用 UI 作为写入入口，不能算作用户点击测试。Application 层另覆盖对象修改入口和未批准 apply 的后端拒绝。

批准场景核实了实际知识文件、模块定义、原知识事务唯一性和重复原 apply 回执。三种模式均保留普通主会话草稿，完整重开后再次实际打开治理历史，决定与保护记录保持一致，正式知识快照不变，没有自动实施或任务重放。

## 明确故障注入：决定已保存但回复丢失

仅默认批准场景在测试侧包装真实 `ipcMain` 的 `cbim:call` 处理函数。它先等待原生产 `governance.decide` 成功返回，确认真实回执为批准决定，才将这一次返回替换为明确的 `TEST_RESPONSE_LOST` 错误。没有伪造成功或回执，没有增加产品测试入口，没有重试决定，也没有损坏治理账本或知识 journal。

最终包实际原决定命令为 `3bd5063e-cd09-4b1e-a582-5a5eb88c3108`。核验事实：

1. 界面保留原命令的待确认记录及本地 pending，显示错误，没有上一操作的成功提示，不能实施；后端实际已保存一项批准决定。
2. 真实 `governance.decide` 调用数为 **1**，持久治理账本中的 decide 命令也只有 **1**，命令、决定和待确认标识一致。
3. 实际点击“查询原命令回执”恢复原决定并清除 pending；恢复结果与被丢弃的真实回执完全相同。
4. 回执查询前后治理 ledger 和完整性 anchor 的文件字节一致，知识 snapshot 和知识事务文件列表保持不变，没有重复决定或提前 apply。
5. 之后才独立点击“实施已批准的知识变更”。实际提交结果及重开历史均通过。

这验证回复不确定时的保留和只读查询恢复，不模拟断电、OS 崩溃、磁盘损坏或所有存储故障。账本完整性、知识 journal 故障及恢复边界由专门服务测试承担。

## 回执、截图与清理

- 批准：[JSON 回执](../../test-results/module-governance-approve-ui-smoke.json)、[精确提案](../../test-results/module-governance-approve-proposal.png)、[回复丢失后的 pending](../../test-results/module-governance-approve-decision-pending.png)、[原回执恢复](../../test-results/module-governance-approve-decision-recovered.png)、[实施结果](../../test-results/module-governance-approve-result.png)、[重开历史](../../test-results/module-governance-approve-restored.png)。
- 暂缓：[JSON 回执](../../test-results/module-governance-defer-ui-smoke.json)、[决定](../../test-results/module-governance-defer-decision.png)、[重开历史](../../test-results/module-governance-defer-restored.png)。
- 驳回：[JSON 回执](../../test-results/module-governance-reject-ui-smoke.json)、[决定](../../test-results/module-governance-reject-decision.png)、[重开历史](../../test-results/module-governance-reject-restored.png)。

已实际查看批准提案、pending、回执恢复、实施结果，以及暂缓和驳回重开截图。屏幕状态与回执一致；实施结果明确提示知识变更已提交并核实、业务验证未执行。

三次成功场景均由 finally 正常关闭自己的 Electron 并清理隔离目录。最终查询该构建的 `CBIM.exe` 进程数 **0**，`cbim-module-governance-ui-*` 临时目录数 **0**。没有触碰历史被审批拒绝或要求保留的目录、用户应用和用户数据。

## 类型、架构与完整回归

桌面脚本独立严格类型检查通过（包含 JavaScript 构建定位辅助文件）。Root 报告最终类型、架构检查通过：50 个目录、351 个源码/样式文件；601 个维护文件、2691 条含类型依赖、0 个循环；13 份架构文档同步。[最终边界报告](../../test-results/module-governance-boundary-final.json) 为 **2 个文件、13/13 项通过**。

初轮完整回归为 **187 个文件、1065 项，其中 1063 项通过、2 项失败**，见[原始全量报告](../../test-results/module-governance-full.json)。失败涉及真实生命周期：知识提交已经受理后，在关闭／重启窗口的后置 `owner.assert` 误拒了应按原事务完成的提交。

Main 修复后，类型检查及相关 **11 个文件、71 项定向测试通过**，包含关闭、工作区重启，以及治理 apply 在 verify 阶段重启的确定性回归。修后未重复全量，不能将此结果写成“1065 项全量通过”。最终桌面已在同时包含生命周期和旧提示修复的 `20261107-135435` 上重新验证批准、暂缓、驳回，三个场景全部通过。

## 限制

- 本步仅治理既有模块的绑定说明正文。修改模块定义、移除保护、移动/删除模块、业务代码迁移等不在此片已验收范围。
- 批准是对精确知识提案的本机决定，不自动实施，不代表业务代码正确或架构、业务验收通过。
- 没有模型执行路径，因此没有为零模型场景虚构 Pi 或在线模型验收。自动提案、模型治理工具和跨机器身份认证未在此片实现。
- 重复原请求仅查询/返回同一事实，不意味着旧提案在新基线或新决定下仍可重新实施；变更基线需要新的观察和提案。
