# JSON 产物结构验证验收

日期：2026-11-07。对应 [Step22 开发计划](../task/json-artifact-validation.md)，承接 `0107b86`。本片验证冻结的文件结构要求、真实文件字节、执行候选和主审阅之间的关系；结构符合不代表业务目标正确或人工验收。

## 真实 Pi 链路

`pnpm exec vitest run tests/json-validation-pi.test.ts --reporter=json --outputFile=test-results/json-validation-pi-initial.json` 首轮 **3/3 通过**。使用真实 Application、Pi、正式执行成员、原生 write/read、文件基线采集、结构验证服务、canonical 日志和调度器。只有模型响应由本机确定性供应商提供，不调用在线模型或用户账号。

模块通过实际知识提交保存唯一 `cbim-workflow` JSON 块：业务副作用前必须有本轮计划，交付要求本轮 read 及 `json-schema-v1` 检查。Schema 要求非空 `name` 字符串和至少为 1 的整数 `count`，禁止额外字段；文件路径由冻结约定确定，模型只传模块、要求、基线和进度版本。

| 场景 | 主请求 / 成员请求 | 实际结果 |
| --- | ---: | --- |
| 修正后完成 | 6 / 16 | 真实写入不合结构的 JSON；验证 rejected；步骤可以引用检查事实，交付仍被 `WORKFLOW_VALIDATION_REQUIRED` 拒绝。修正写入清除旧证据，重新 read/capture/validate 得到 passed，主审阅完成 |
| 验证后外部变化 | 7 / 16 | 成员形成真实候选后、主审阅前，仅测试拥有的文件被改为另一份 JSON。真实主审阅返回 `GOAL_WORKFLOW_UNMET`，随后记录 blocked 审阅，周期 failed；旧 passed 保留为当时字节事实 |
| 修正前停止 | 3 / 9 | 在第一次交付拒绝后、第二次写入前停止。周期 cancelled，只有一次原生 write，没有交付候选；释放测试响应后也未启动修复 |

三场均核对 `validation.checked` 先于对应真实 `tool.finished`，工具回执为 succeeded 与结构结论 rejected 分别表达。passed 的文件大小、SHA-256 与实际 UTF-8 字节一致；新、旧基线和 validationId 不同，冻结 Schema 身份相同。新交付证明只引用 fresh read 和 passed 检查，不借用旧 rejected 或写入前证据。诊断没有输出不合格字段的原值。

重建 Application 后，任务图、调度记录、canonical/原生 JSONL 字节、业务文件内容与修改时间均不变，模型请求不增加。证据：[首轮 Pi 结果](../../test-results/json-validation-pi-initial.json)、[测试](../../tests/json-validation-pi.test.ts)、[供应商](../../tests/json-validation-provider.ts)、[真实知识准备](../../tests/json-validation-fixture.ts)。

增强的三个场景复用真实已完成 summary/run，追加文件复核端口边界断言：正确平台读取通过；缺端口明确拒绝；声称 matches 却返回错误 expected、错误 observed、缺 observed、缺文件或缺检查项均拒绝。外部文件已变化时，`memberWorkflowFiles` 仍保留过去的原字节证明，`validateMemberWorkflow` 则拒绝将其作为当前交付依据。端口坏值仅为测试边界注入，不进入真实模型流程或改写日志。

## 文件变化后的人工负面意见

审查发现，新增当前 JSON 文件复核曾过度阻止人工查看历史候选、保存负面意见和负面接续。修复后新增两条实际 Pi 回归，分别记录 reject 和 request_evidence，最终 **2/2 通过**，各 **主 10 / 成员 16** 请求。

两例都先通过真实成员检查生成候选、由主调度请求人工判断并进入安全 waiting，然后实际修改本测试的 JSON 文件。新的人工 preview 仍保留可信历史依据与 changed 文件观察，只允许 reject/request_evidence；accept 请求被拒绝且不改变原等待记录。负面决定保存及原命令重复提交均无新模型、无图/日志变化。重建 Application 后仍 waiting，没有自动继续。

测试再通过独立 `loop.humanContinue` 显式接续同一目标，主调度读取真实状态、重新计划并记录 blocked，周期 failed；没有新成员或假造返工，也没有将旧 passed 解释为新字节通过。原任务、候选、旧日志与人工记录保留，周期关闭只释放执行实例。再次重开及重复原接续命令均不增加模型请求。

证据：[人工负面最终回归](../../test-results/json-validation-pi-human-final.json)。第一次新增用例已完成实际负面流程，但测试错误要求 waiting→closed 后整个图完全相等，忽略关闭周期会释放执行实例，使 agent revision 与图 cursor 各增加 1。定位后改为精确核对该释放增量、原任务/边/主实例完全不变，未改产品或放宽证据规则。[初轮 3 过 / 2 失败](../../test-results/json-validation-pi-human-initial.json)及[单例定位](../../test-results/json-validation-pi-human-diagnostic.json)保留。

## Windows 桌面

最终产物 `build/20261107-164948/CBIM Assistant-win32-x64/CBIM.exe`，manifest `stage: make`，完成于 `2026-11-07T08:50:37.133Z`。四个命令均显式固定 `CBIM_TEST_EXE` 到同一产物、串行执行，**四场首轮全部 exit 0**；未修改产品或重新构建。

| 命令（前缀 `pnpm exec tsx scripts/json-validation-ui-smoke.mts`） | 主请求 / 成员请求 | 真实结果与回执 |
| --- | ---: | --- |
| 默认 complete | 6 / 16 | [正常完成](../../test-results/json-validation-complete-ui-smoke.json)：rejected 拦交付，修复后当前字节 passed，主审阅 completed；实际 write 2 次 |
| `--changed` | 7 / 16 | [文件变化](../../test-results/json-validation-changed-ui-smoke.json)：候选之后仅外部改测试文件，主审阅 `GOAL_WORKFLOW_UNMET`，目标 failed；原生 write 仍 2 次 |
| `--stop` | 3 / 9 | [真实停止](../../test-results/json-validation-stop-ui-smoke.json)：点击停止后 cancelled，无修复写入及候选；原生 write 1 次 |
| `--human-negative` | 10 / 16 | [人工负面继续](../../test-results/json-validation-human-negative-ui-smoke.json)：安全 waiting 后文件变化，明确预览并选基线；接受的提交禁用，记录拒绝无新模型，再明确继续进入主调度，最后 blocked/failed，无新成员或假造完成 |

人工决定 ID `698fbfe3-960a-4404-9442-fd2a06a3b6b1`，独立接续 ID `b8c2bddc-d4f6-4f20-88a5-3a9f06c7387f`。保存拒绝后仍为主 6 / 成员 16，原图和全部日志字节不变；另一次实际点击继续才增加主调度请求。继续沿原 scope、原目标和当前人工决定，不把意见当作新用户自由文本。

四场页面错误、供应商通信错误均 **0**。全部保留普通输入草稿；完整关闭/重开后，任务图、持久调度记录、canonical/原生 JSONL 字节、文件修改时间和内容不变，模型请求不增加。结束后只读检查本次 `cbim-json-validation-ui-*` 进程和临时目录均为 0；未触碰用户应用或旧保留目录。

已实际查看关键截图：

- [修复后的历史与当前结构验证](../../test-results/json-validation-complete-passed.png)：旧不符合记录与新通过记录独立保存，并说明仅代表当时字节。
- [外部变化后的目标未完成](../../test-results/json-validation-changed-settled.png)、[停止后的目标状态](../../test-results/json-validation-stop-settled.png)。
- [真实文件变化与人工负面预览](../../test-results/json-validation-human-negative-changed-preview.png)：基线明确选定，文件变化可见，不能接受。
- [拒绝记录仍安全等待](../../test-results/json-validation-human-negative-decision.png)、[独立继续后的历史与状态](../../test-results/json-validation-human-negative-settled.png)：保存意见和继续执行分开。

界面原结论与展示状态分开断言：`data-validation-outcome` 保留 passed/rejected，`data-outcome` 表示当前可见日志支持的状态。修复写入后旧 rejected 标 stale；外部文件改动没有日志事件时，历史 passed 仍只称“当时符合结构”，由当前主审阅拒绝完成，而不虚构额外验证事件。脚本专项 strict TypeScript 检查也已通过。

## 其他验证与限制

首轮组合回归 29 文件、210 项通过（`test-results/json-validation-final-regression.json`），包含增强后的三场真实 Pi、现有 Workflow、人工继续、执行计划、工具输出契约和文件基线。类型检查、13 项层级/循环检测边界通过；51 个目录、381 个代码/样式文件，669 个维护文件、3090 条含类型依赖，0 循环，14 份类图同步。

随后只读审阅发现组合测试尚未覆盖的交叉边界：结构验证后文件变化时，新候选复核会连人工“拒绝/补证”的历史来源核实一起阻断。已分离历史事实核验与当前接受许可，并补专门服务回归和上述两条真实 Pi；保留前述首轮数字，不将它们当作修正后的最终验收。

最终冻结源码的 [33 文件组合回归](../../test-results/json-validation-frozen-regression.json) **242/242 通过**，包含增强后的五项实际 Pi。类型检查、最终 13 项依赖/分层边界、架构检查通过：51 目录、381 源码/样式、670 个维护文件、3104 条含类型依赖、0 循环，14 份 ARCHITECTURE 同步。本次未执行全仓测试。

人工服务修后相关测试去重 **23 项通过**；一次并行批次加载了修正前的错误码断言，初轮 22/23，随后单独补测修正断言。最终冻结组合已覆盖这些修复，不将全部中途轮次写成首次通过。

Runtime 首轮测试曾因测试代码迟挂取消 rejection 的断言出现未处理拒绝，不能视为通过；修正断言时序后的 4 文件 23 项通过且无 unhandled，再补跨模块条件总数上限后 3 文件 21 项通过，两个报告去重为 6 文件 37 项（`json-validation-runtime-final.json`、`json-validation-runtime-policy.json`）。

外部改动是测试在明确暂停点对自己临时目录的文件写入，不是生产故障入口。没有修改 canonical、伪造工具回执、让模型自报 Schema 或 passed，也没有为验证绕过调度及权限。检查针对指定文件当次读取字节；不承诺全工作区原子快照或监测所有外部并发变化。
