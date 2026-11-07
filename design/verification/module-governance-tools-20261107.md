# Step18b 主 Agent 模块治理工具验证

日期：2026-11-07，承接桌面治理提交 `b71d61f`。计划：[主 Agent 的模块治理工具](../task/module-governance-tools.md)。本步沿用已登记保护、真实知识版本和治理账本，验证主运行的有界获取、观察、提案与原回执查询；人工决定和实施仍是独立桌面动作。

## 真实 Pi 验证

入口：[准备流程](../../tests/module-governance-tools-fixture.ts)、[确定性供应商](../../tests/module-governance-tools-provider.ts)、[Pi 测试](../../tests/module-governance-tools-pi.test.ts)。只使用独立临时项目和无认证的本机确定性 HTTP 模型响应服务，实际执行 Pi 子进程和产品工具；不使用在线供应商或用户密钥。

主流程通过真实 `cbim_governance_get` 读取保护与目录、`cbim_governance_observe` 保存观察，再按明确 observationId 读取完整正文，最后 `cbim_governance_propose` 保存精确方案、`cbim_governance_receipt` 查询原调用。模型没有登记保护、人工决定或实施工具，也没有主角色业务 `write/edit/bash`。

| 场景 | 主 / 成员模型请求 | 核对内容 |
| --- | --- | --- |
| 正常主提案 | 8 / 0 | 四工具真实结果、知识范围、副作用分类和可信主来源；精确提案仅一份 |
| 非法身份字段与 UTF-8 正文超限 | 10 / 0 | 额外 workspaceId/actor 与超过 16 KiB 的正文拒绝；随后合法提案只保存一次，无审批遗留 |
| 提案保存后回复失联 | 8 / 0 | 返回脱敏 `GOVERNANCE_UNKNOWN` 与原 commandId，只查询原 toolCallId 恢复同一提案 |
| 观察后、提案前停止 | 5 / 0 | 先等待周期取消且活动运行归零，再放行迟到测试模型响应；保留观察，未调用提案保存 |
| 执行者实际工具清单 | 0 / 1 | 默认执行者真实 Pi 没有四项主治理工具或派发工具；未宣称业务交付 |

首次运行五项时，四项通过，回复失联分支因测试期待底层 `TEST_RESPONSE_LOST` 字样而失败。产品实际正确输出了脱敏 `GOVERNANCE_UNKNOWN` 及原命令 ID。仅修正测试期待公开协议，再执行 `-t lost-reply`，结果 1 项通过、4 项跳过；没有修改产品或放宽证据要求。最终完整回归由 Root 单独记录，不把首次运行写成五项全过。

每条主场景都核对实际 canonical 回执、图根主实例、逻辑主通道、rootSessionId、runId 和 toolCallId。观察/提案的可信来源与主运行绑定一致，图中没有伪造业务任务或成员执行。正式知识 snapshot 与所有原知识事务文件字节保持不变。普通 Workspace.commit 改写受保护正文仍被 `GOVERNANCE_PROTECTED` 拒绝；此检查是实际服务调用，不冒称为模型成功或桌面点击。

关闭并重新初始化后，图、周期记录、canonical/原生日志字节、正式知识和原 journal 不变，没有新增模型请求或自动重放。执行者清单用例另运行一个真实独立实例，仅用于核实能力隔离，没有交付候选，因此不宣称业务完成。

## 回复失联注入的准确边界

仅在 Pi 定向测试中包装 `proposeFromMain`：先调用真实实现并等待提案可靠保存，再抛出测试侧错误，模拟保存后回复未能交付。真实服务及治理账本没有被替换，也没有产品测试入口。

主模型只看见公开的 `GOVERNANCE_UNKNOWN`、稳定原 commandId 和应查询原回执的提示，底层注入错误不泄露。之后调用 `cbim_governance_receipt({action:'propose',toolCallId:'governance-propose'})`，回执命令必须等于之前公开错误里的命令。测试确认真实 propose 调用数为 1，账本的提案命令数为 1，没有再次保存或正式知识写入。

停止测试的受控点位于模型返回 propose 声明之前，并不声称已经进入可靠保存的操作可以回滚。持久化前后取消、旧来源和跨 root 查询等服务边界由专门单元测试承担。

## 最终 Windows 桌面验收

最终 EXE：`build/20261107-141357/CBIM Assistant-win32-x64/CBIM.exe`，`stage: package`，完成时间 `2026-11-07T06:14:27.369Z`。两种模式均在同一产物上真实运行，退出码 **0**。入口：[module-governance-tools-ui-smoke.mts](../../scripts/module-governance-tools-ui-smoke.mts)。

| 场景 | 主 / 成员模型请求 | 真实桌面结果 |
| --- | --- | --- |
| 默认完整流程 | 8 / 0 | 聊天运行四工具，生成一份提案；业务架构核对真实主来源和精确前后正文，随后独立批准与实施 |
| `--stop` | 5 / 0 | 观察完成、模型提案声明尚未返回时点击停止；周期取消后才放行响应，没有提案或知识变更 |

两个流程都由实际主会话发送消息，权限为只读。只读权限仍允许保存私有观察、预览性质的提案，不授予正式知识写入。实际聊天工具回执包含主来源，业务架构中的“知识治理”面板显示根会话、主实例、逻辑通道、run、toolCall 与工具名，逐项与可信运行和图根核对。界面明确提示“尚不构成人工决定”。

完整流程先核实正式知识和所有原知识 journal 字节未变，提案决定列表与实施列表为空，实施按钮不可用；然后实际填写意见、勾选已审阅、点击批准。批准保存后再次核实知识和 journal 没有改变，最后独立点击实施，取得真实知识事务回执，实际文件恰好等于精确方案。模型请求数始终为 8，不因桌面决定或实施再启动模型。

停止流程只保留一项来源完整的观察，提案历史为空，界面显示“本轮已停止”；没有把已保存观察假称为已回滚。两个流程均保留两个主会话各自草稿，完整重开后图和运行记录、canonical/原生日志字节、正式知识及 journal 不变，无新增模型请求、工具重放或自动实施。最终页面错误、意外原生弹窗和本机供应商通信错误均为 **0**。

### 截图时序修正

首遍两个桌面流程的数据断言已经通过，但聊天截图发生在后端收口、前端下一轮投影尚未同步的间隙，正常图仍显示“普通对话处理中”。仅在脚本中补充等待 `conversation-goal-summary` 显示真实终态，再对同一 EXE 重跑两个模式，最终截图分别显示“本轮对话结束”和“本轮已停止”。产品源码没有因此修改或重新打包，也没有把投影延迟解释成额外模型运行。

首遍成功 JSON 和较早的聊天截图保留于 [时序修正前证据](../../test-results/module-governance-tools-before-ui-settled/)，最终文件如下。

- 完整流程：[JSON 回执](../../test-results/module-governance-tools-complete-ui-smoke.json)、[主工具与对话终态](../../test-results/module-governance-tools-complete-chat.png)、[真实来源和精确差异](../../test-results/module-governance-tools-complete-source.png)、[独立实施](../../test-results/module-governance-tools-complete-applied.png)、[重开历史](../../test-results/module-governance-tools-complete-restored.png)。
- 停止：[JSON 回执](../../test-results/module-governance-tools-stop-ui-smoke.json)、[保留观察与停止状态](../../test-results/module-governance-tools-stop-chat.png)、[来源及空提案历史](../../test-results/module-governance-tools-stop-source.png)、[重开历史](../../test-results/module-governance-tools-stop-restored.png)。

已实际查看最终聊天终态、来源、精确差异、实施回执，以及停止和重开截图。最终核实该构建的 `CBIM.exe` 进程数 **0**，本片 `cbim-governance-tools-ui-*` 临时目录数 **0**；所有成功场景正常关闭并清理自有资源，未触碰用户数据和历史要求保留的目录。

## 类型、架构与完整回归

脚本独立严格类型检查和仓库 `pnpm typecheck` 通过。Root 报告最终类型、架构、13 项边界测试通过：50 个目录、355 个源码/样式文件，612 个维护文件、2755 条含类型依赖、0 个循环，13 份架构文档同步。边界原始记录：[module-governance-tools-boundary.json](../../test-results/module-governance-tools-boundary.json)。

最终完整回归 `pnpm test --reporter=default --reporter=json --outputFile=test-results/module-governance-tools-full.json` 退出码 0：**191 文件、1096/1096 项通过**，包含上述五个真实 Pi 场景及 Step18a 关闭/重启回归。原始 [JSON](../../test-results/module-governance-tools-full.json) 与 [执行日志](../../test-results/module-governance-tools-full.log) 保留。此次完整回归使用最终源码；旧首次定向测试断言错误仍按前文保留，不被后续通过覆盖。

相关定向验证另包括 Core 六文件 74 项、Main 最后三文件 13 项及原服务 7 项、界面来源与待确认两文件 8 项通过。维护范围为 Core governance/policy/tasks、Main 真实主运行与治理持久层、Scheduler 执行与工具、Bridge 和 Frontend；中文注释、10 份 CONTRACT、13 份 ARCHITECTURE 已同步。

## 限制

- 本机确定性响应验证真实工具和记录链，不证明在线模型的工程判断、方案质量或费用。
- 私有治理记录不等于正式知识变更，不自动授予批准或实施权限，也不是业务交付证据。
- 本片只覆盖已保护模块的说明正文，不扩张到通用治理对象、业务迁移、解除保护或认证负责人。
- 记录中的真实模型来源是可追溯调用身份，不代表人工责任认领或人工验收。
