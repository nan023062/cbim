# Step50 / R08：跨等待人工意见核验与重新决定

日期：2026-11-08。承接本地提交 d906011。本片按独立本地提交交付，不推送；第1–8组继续，第9组仅计划。

## 实际交付

- 同周期同人工项可明确选择“对照上次意见，重新决定”。服务重读原主/成员 canonical 日志，比较原来源、最新意见、等待、验收项原文、知识、候选/运行、明确选择及当前产物八项，分别显示一致、变化或无法核实。
- 第一次对照清空旧文件选择、意见及接受状态，只列候选。明确选择后才读取当前产物；即使比较证据一致，也须用户明确提交新意见。旧接受不自动适用新等待，新保存与继续仍是独立动作。
- 新决定以 reconsidersDecisionId 关联最新旧意见，保留两份不可变依据；提交重核当前版本、来源和文件，历史重放拒绝伪造或跨周期关联。换候选可按新的可信依据重新决定，不能借旧接受跳过新验收。
- 未知请求保持原命令冻结；迟到预览、切换及重开不能串用。接续卡只显示当前等待的意图，新等待尚无意见时不显示上一次已受理卡；旧请求保留可查。

## 验证

最终源码类型、脚本类型（--noEmit）和架构检查通过：51目录、532源码/样式，1025维护文件、5516条含类型依赖、0环；3处既有外部动态加载保留审核。

最终冻结相关回归 **27文件、249/249，0失败、0跳过，约251秒**。包含协议/存储、真实服务、控制器、实际Pi两次等待、原JSON/完整产物/删除移动/Workflow及架构边界。本片没有重跑全仓；Step46全仓2068是历史证据，不计入本片通过数。

最终Windows EXE **20261108-142543** 实际通过两次等待至最终完成：主/成员模型请求16/8，两份决定分别绑定两个等待且明确关联。真实Pi使用本机确定性服务，未访问在线模型。

成品覆盖：显式对照不预选接受；相同证据仍须重新决定；完整集合新增阻止接受；原日志损坏显示无法核实；恢复后重开保留草稿但不自动核实或提交；新接受后成果变化阻止继续；恢复原文件并明确继续后完成；重开无新请求。原候选、原意见及原日志保持；完成时仅允许正常成员释放所需的图更新，任务/候选仍一致，最终图重开不变。页面/传输错误均0。8张截图生成，4张目检确认提示与记录可读。自有成功样本和进程已由脚本关闭清理，未操作用户原运行。

## 失败与修正记录

1. 开发服务测试42/43：知识更新测试错误地比较更新前整个存储；改为核对真实知识更新后的状态，并继续断言原scope/graph/runs没有额外变化。修正后开发44/44。
2. 初次最终回归248/248通过、EXE20261108-140459却暴露新等待展示旧已受理接续卡。修正按wait身份选卡并新增回归；失败EXE报告保留，未当作成功。
3. 修正后249项中248通过：旧测试对共享subject.criteria追加内容，污染新测试夹具。scopeState改用独立深拷贝，原严格主体校验不变；该文件13/13通过后，再执行上述完整27文件回归。
4. 最终成品脚本在运行前修正了关闭时整图不变的错误假设，改为核对原任务/候选保持及最终图重开保持。该修正与最终夹具同时纳入最终类型、回归、构建和EXE验收的同一指纹，没有混用不同测试树。

## 证据与指纹

- [最终检查](../../test-results/human-reconsideration-release-checks-receipt.json)、[相关回归](../../test-results/human-reconsideration-release-targeted.json)、[冻结回执](../../test-results/human-reconsideration-release-targeted-receipt.json)、[构建](../../test-results/human-reconsideration-release-make-receipt.json)。
- [初次EXE失败](../../test-results/human-reconsideration-ui-failure.json)、[共享夹具失败](../../test-results/human-reconsideration-verified-targeted.json)、[夹具定向修正](../../test-results/human-reconsideration-view-fixture-fixed.json)。
- [最终成品回执](../../test-results/human-reconsideration-release-ui-smoke.json)、[目检记录](../../test-results/human-reconsideration-visual-review.json)、[产物摘要](../../test-results/human-reconsideration-artifacts.json)。

最终源码/配置541项、内置资料21项及测试/脚本528项在检查、回归、构建和验收间完全一致。

源码：88f34c199e15781058ad3679dda452a2c5399c671b745411d57c273ee4d3febf

内置资料：6fcd8d9e7f8691486bc7b273c3fb3154d72acb25d7c927f4ce81514e93691f06

测试/脚本：92b26447c069222dda3510a20c8db49401633bc5d67e7293db65e06487419629

- C:\XDTWorkspace\cbim-ai\build\20261108-142543\CBIM Assistant-win32-x64\CBIM.exe：213976576字节，SHA-256 158593de91f6837642bd013ce5d988561d9edb8b13efa9d6032c9f8c7c64551e
- C:\XDTWorkspace\cbim-ai\build\20261108-142543\CBIM Assistant-win32-x64\resources\app.asar：3195436字节，SHA-256 88bf9d9c2858ad10c4e88b7082ec75f7be2471126f8a61f5167909666ce6aa0b
- C:\XDTWorkspace\cbim-ai\build\20261108-142543\make\zip\win32\x64\CBIM-Assistant-20261108-142543-win32-x64-0.1.0.zip：180376844字节，SHA-256 952d9f94f82dc0d3c1c772830158a5aad65f0fc16d24d4ff05e1a5b25ff16513

## 维护与范围

9个源码文件的中文文件头、关键接口及关联字段同步；core/tasks、scheduler-engine/execution、bridge/contracts、frontend/tasks四组CONTRACT/ARCHITECTURE同步。纯比较留在后端core，真实日志读取在scheduler，Bridge只公开DTO，前端不依赖后端实现。内置执行说明明确不继承旧接受。

R08约定的同周期跨等待人工依据核验与重新决定范围完成。比较结果只说明上述证据，不声称旧完整业务主体语义相等、真人理解、认证审批或跨周期迁移。没有自动批准或恢复权限；文件观察仍不提供跨外部进程原子快照。R07-C外部产物与R13真实适配、R03其它异常通道，以及R09–R17继续保留；下一片先列R09专业验证支持矩阵和代表任务。
