# 知识刷新原事务绑定验证

2026-11-08，Step41 / R03-D4，承接6d14944，约定范围已完成。本地独立提交，不推送；R03未覆盖范围仍按[支持矩阵](../task/recovery-support-matrix.md)跟踪，第9组仅计划。

## 实现

- cbim_knowledge_refresh v2 明确要求原 revision/requestId，构造固定空 changes 请求，先查完整原成功 journal，未提交时核原版本和结构后提交。重复不再写入，返回的结构校验仍属于当前快照，不宣称原回包逐字相同。旧缺字段的新执行在授权前拒绝，原 v1 日志保持可读。
- KnowledgeTools.describe 返回实际契约版本；Runtime 自身授权记录正整数 contractVersion，不信模型参数、调用顶层和引擎事件同名字段。其它知识工具仍v1，权限与原回执形状不变。
- 统一观察只有原可信 allowed v2 才解析刷新请求并复用原 journal 读取、两次稳定性比较及处置。v1/缺版本/错误版本不能借同名输入字段冒用新协议；不以今天索引或最近事务推测原结果。

## 验证

| 检查 | 实际结果 |
| --- | --- |
| 首批 | 5文件26/26，刷新幂等/版本/取消/原字段与可信版本、知识契约及原对象CRUD |
| 真实Pi原事务 | direct/object/refresh三场3/3，实际提交后坏返回、明确处置、旧实例重开，无重放 |
| 最终相关 | 20文件145/145，0失败/跳过；含上述及原知识Pi、read/ask/execute、运行门禁、受控写、Workflow、检查点/求助、13项依赖/分层；批次重叠不累加 |
| 类型及脚本类型 | pnpm typecheck；独立桌面脚本tsc，通过 |
| 架构/依赖 | 51目录495源码/样式、0文档差异；930维护文件4924含类型依赖、0循环、3处已审核外部动态加载 |
| 最终构建 | 20261108-065808；501项源码/配置前后指纹 5b36bde74f0d609e07cfa1fffb88f5c2482c6267015f2249e70faeeb44ed7ac3 |

本片未重跑全仓，Step37全仓记录仅为前序证据。本片定向与桌面均首次通过，没有用测试替身代替实际知识事务或界面点击。

## 最终EXE

隔离源码 Application 使用真实Pi及本地确定性HTTP模型，读取实际v2契约与旧知识版本；样本预置一个未进入派生索引的真实模块。刷新实际提交1次，journal明确改变1项索引后测试破坏返回，原工具failed保留。种子共8次模型请求。最终EXE不注入产品钩子，通过实际按钮核实committed、保存/查询处置、关闭并重开读取原记录；EXE及重开新增模型请求0。

原journal/canonical/native字节、原周期/运行、草稿保持；处置只追加自身记录，重开journal与basis不变。原失败与原committed同时显示，不自动验收或重做。页面/通信/服务错误0，自有程序/服务/目录清理完成。生成3张截图且全部目检。真实Pi工具链与确定性响应不代表在线自主业务质量。

证据：test-results/refresh-effect-{first,pi,related,make-final-receipt}.json、refresh-effect-{direct,object,refresh}-pi-evidence.json、knowledge-effect-refresh-ui-smoke.json；原字节归档knowledge-effect-refresh-ui-original/，截图knowledge-effect-refresh-*.png。临时证据不提交到源码仓库。

## 产物

- build/20261108-065808/CBIM Assistant-win32-x64/CBIM.exe：213976576字节；SHA-256 65274ecf141ee635194c57ac9bfd37c8bc325a9cb8608f061cb2ac2218ea82eb
- build/20261108-065808/CBIM Assistant-win32-x64/resources/app.asar：3000117字节；SHA-256 6ccab27a0ecf7e1600639b224aca123e6c2f2fb621a2a85ae67fa1aef26b5ea6
- build/20261108-065808/make/zip/win32/x64/CBIM-Assistant-20261108-065808-win32-x64-0.1.0.zip：180252212字节；SHA-256 0a3cb558e6309c174557d8d693a190d53d9333c18fee299220da55aa473bfa2b

## 同步与接续

中文文件头、关键接口/版本来源说明、6份CONTRACT及6份ARCHITECTURE（Core brain/knowledge/policy/tasks，Scheduler tools/execution）同步；内置common-rules反映真实v2调用。依赖仍单向，后端请求解析不进入前端纯DTO。

R03已覆盖本地原主命令、单文件观察、知识/治理/责任、受控文件及独立补偿；旧刷新、临时维护/预览缺持久来源、任意shell及外部写仍明确受限，不能称全通道恢复完成。下一片R04-2补未领取任务的通用原子依赖修订；随后R05–R17，R03与R07/R13对应缺口按矩阵联动验收。
