# 正式派发选择模块 Workflow 验收

日期：2026-11-07。对应 [Step23 开发计划](../task/dispatch-workflow-selection.md)，承接 `0fe0be3`。验证在一个模块实际挂载两份 Workflow 时，主调度明确选择第二项；选择贯穿目标计划、派发、成员冻结配置与交付证明，不回退默认首项。

## 测试方式与边界

独立入口为 [Pi 用例](../../tests/workflow-selection-pi.test.ts)、[知识准备与绑定断言](../../tests/workflow-selection-fixture.ts)、[桌面脚本](../../scripts/workflow-selection-ui-smoke.mts)。复用 Step22 本机确定性供应商与真实 JSON 链，仅新增可选流程选择配置；缺省时原 Step22 语义不变，回执、截图及桌面临时目录使用独立 `workflow-selection` 前缀。

准备过程通过真实 ObjectCrud/知识提交创建第二份 `validate_json` 流程，默认 `build` 只有 read 工具证据出口，没有 JSON 检查要求。主调度的目标分配和派发都显式提供第二项 ID。正式独立成员真实写入错误 JSON、read、capture、检查 rejected，交付被拒；修正后重新读取/采集/验证 passed，再由主调度审阅。另一例在修正前停止，核对没有第二次写入与候选。

逐层断言目标分配与 TaskNode 的 `workflowSelections`、`ModuleBinding.workflow`、prepared module、`run.started.workflowContracts`、每次 validation requirement、最终 Workflow proof 都绑定同一第二项 ID 和内容版本。桌面额外真实展开目标计划与成员模块详情，检查“指定流程”来自持久选择；重开图、记录、日志字节和模型请求不变。

这些场景使用真实 Application、Pi、原生文件工具、知识存储和打包 Electron；本机确定性模型只负责按步骤发起调用，不证明在线模型自主选择质量或业务验收。

## 首轮发现

[首轮 Pi 结果](../../test-results/workflow-selection-pi-initial.json) 两例均在创建第二份 Workflow 的知识草案校验时失败，主/成员请求均 **0/0**，不是执行工具或选择逻辑已通过。实际错误为 `TypeError: a.valueOf is not a function`，来自 Ajv `uniqueItems` 对多项流程对象的比较；严格 JSON 解析的对象形态与比较器不兼容。未绕过真实知识提交，也未删去唯一性检查；已交由实现负责人修复，首轮证据保留。

Rules/Ajv 边界修复后保持原 fixture，通过真实知识服务重跑，最终 [Pi 2/2 通过](../../test-results/workflow-selection-pi-final.json)：正常场景主 6 / 成员 16 请求，停止场景主 3 / 成员 9。第一项无 JSON 出口、第二项实际生效；所有持久选择、冻结绑定及证明一致。正常交付只引用修正后本轮验证；停止只有首次错误写入，无候选。重开任务图、调度记录、canonical/原生日志、文件修改时间与请求数均不变。

新脚本及测试专项 strict TypeScript 检查通过。

## 最终 Windows 桌面

固定 `CBIM_TEST_EXE` 为 `build/20261107-171643/CBIM Assistant-win32-x64/CBIM.exe`，manifest `stage: make`，完成于 `2026-11-07T09:17:40.575Z`。同一最终包串行执行以下真实点击流程，没有重建或修改产品源码：

| 命令（前缀 `pnpm exec tsx`） | 主请求 / 成员请求 | 实际结果 |
| --- | ---: | --- |
| `scripts/workflow-selection-ui-smoke.mts` | 6 / 16 | [正常回执](../../test-results/workflow-selection-complete-ui-smoke.json)：第二流程拒绝不合 Schema 的 JSON；修复后重验通过，目标 completed，实际 write 2 次 |
| `scripts/workflow-selection-ui-smoke.mts --stop` | 3 / 9 | [停止回执](../../test-results/workflow-selection-stop-ui-smoke.json)：首次拒绝后真实点击停止，目标 cancelled，只有原 write 1 次，没有修复写入或交付候选 |

两场页面和供应商通信错误均 0。主目标分配、节点显式选择、真实模块绑定、执行准备、原日志、结构验证及交付证明全部为 `.cbim/workspace/game/workflows/validate_json`，没有回退默认 `build`。两场保留普通聊天草稿，完整关闭重开后图、调度记录、canonical/原生 JSONL 字节、文件修改时间及请求数不变。

已查看 [主计划指定第二流程](../../test-results/workflow-selection-complete-workflow-plan.png)、[成员模块详情的持久指定流程](../../test-results/workflow-selection-complete-history.png)、[停止后的原计划和指定流程](../../test-results/workflow-selection-stop-settled.png)。界面仍将成员结果显示为交付待审阅，不把结构通过误写成人工验收。

首次正常桌面测试因新脚本将三个 `details.member-scope` 都定位为模块区而失败，主 3 / 成员 9 时产品已真实拒绝错误 JSON。脚本改为按目标 moduleId/workflowId 限定详情后，同包重跑正常和停止均成功；无产品修改。[首份失败 JSON](../../test-results/workflow-selection-initial-171643/workflow-selection-complete-ui-failure.json)、[截图](../../test-results/workflow-selection-initial-171643/workflow-selection-complete-failure.png)保留，不当成产品失败或首轮桌面全过。

成功两场的隔离目录正常清理，本次测试进程检查为 0。首轮失败留下的 `C:\Users\User\AppData\Local\Temp\cbim-workflow-selection-ui-IFL4Rf` 已核实位于测试临时目录且无存活进程，但手动删除被自动审批策略拒绝，工具只返回 `blocked by policy`，未给进一步原因。该目录保留，未换方式重试，也未触碰其他用户或旧测试目录。

## 其他验证

最终冻结产品源码执行 `pnpm test --reporter=default --reporter=json --outputFile=test-results/workflow-selection-full.json`，**217 个测试文件、1284/1284 项全部通过**，进程退出码0；包含原 Step22 默认五项 Pi、原人工/检查点/知识事务回归和本轮新增用例。见[全仓结果](../../test-results/workflow-selection-full.json)。全仓期间仅修正上述冒烟脚本定位，产品源码未变；修正后专项脚本类型与架构检查再次通过。

最终类型、架构及 13 项依赖/分层边界通过：51 个目录、382 个源码/样式文件、678 个维护文件、3159 条含类型依赖、0 循环，10 份 ARCHITECTURE 同步。主 Agent 自选业务 Workflow 会在输入、持久目标、人工主体与严格输出中被拒绝，原模块知识治理仍可用。新选择字段不补入旧记录，改选不能借用旧候选、人工接受、检查点或前置替换。

服务初轮曾因测试模块命名不符合规范，以及卸载流程后测试夹具留下孤立正文而失败，已修正夹具并复测，`workflow-selection-service-initial.json`、`workflow-selection-services.json` 保留；没有绕过生产知识校验。Rules 的 Ajv 副本兼容保留唯一性检查，多流程重复项、畸形自有字段和重复 JSON 字段仍被拒绝。
