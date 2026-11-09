# 受控来源代次与明确采纳

Step32 / R02-C 前置，承接 `2f4cb66`。状态：已完成，2026-11-08完成最终桌面验收。Step31 已完成责任控制面；本片为实际负责人派发提供可信来源身份，尚不切换任务路由。实时进度见[roadmap](../tool-architecture-roadmap.md)，证据见[验证报告](../verification/knowledge-source-lifecycle-20261107.md)。

## 可交付行为

1. 受控 Agent/Module 的创建、删除、移动、整包替换及模块可见性变化进入原 DispatchStore 的独立来源记录。普通正文、继承 Skill 或 Workflow 编辑保持对象代次；能力与知识指纹仍照常变化。删除重建不按路径或同字节内容复活旧代次。
2. 新登记、明确能力采纳和负责人设置从真实知识快照纳入来源。旧记录缺少来源时保持原样，只通过明确采纳升级；改名、启停和模型采纳不暗补。内置执行者使用实际内置内容引用，不伪造项目目录代次。
3. 知识写前先保存完整原 prepared journal，再在同 Store 持久记录 pending，成功后才写正式知识。按原 journal 的 committed/rolled_back 事实结算；未知、损坏和冲突保留屏障，不重放副作用、不回滚已经提交的知识。
4. 岗位和责任详情展示当前来源、需采纳或未核实原因。来源采纳沿现有预览、明确提交和原命令恢复，不新增独立来源管理页。责任同 owner 的来源更新用明确 `adopt_source` 操作，保留 bindingId、递增责任版本和历史。

## 内部协议与文件分工

- Core `workspace/knowledge-source` 为纯叶子来源 Schema：逻辑 kind/id、workspace、不可复用 generationId；来源记录保存 observed_existing/controlled_create/controlled_replace 起点与退役事实。独立 sourceCursor 不推进岗位、责任或任务图游标；读取不自动建立来源。
- Core tasks 校验 source capture/prepared/resolved。首次真实观察可与一条明确岗位/责任采纳同事务保存；必须先验证精确组合许可，其余混合 mutation 仍拒绝。既有来源只能采纳当前 ref；任一 pending 暂停新 capture、能力采纳和负责人设置，更改名称、暂停、解除继续按原规则。
- Main KnowledgeStore 持有来源 authority；完整原 request、稳定意图、before/after 和来源变更留在原知识 journal。Dispatch 只保存紧凑绑定，不复制知识正文。ObjectPlan/ImportPlan v2 的 immutable planHash 覆盖实际有序操作、mode/target与替换范围，进度缓存不进入固定意图。公共 ChangeRequest 不接受来源或许可字段；私有提交入口按 planId 重读校验原计划。
- 同路径同字节的完整替换必须有真实私有计划证明；全包零差异维持原拒绝，不能为来源追踪开放空 raw 事务。真实 replace 中另一个文件变化、目标对象正文不变时，仍按完整 reset 范围更换代次。
- 统一锁序为 Knowledge serial → Dispatch transact。原命令查询先释放 Store，再进入知识 snapshot 锁；Store 回调不能反向排队知识或调用同 Store 的成员查询。Application 获取工作区锁后装配唯一 Store，先恢复知识和来源，再发布执行服务；禁止临时恢复 Store 与正式 Store 并存。
- Core 维护来源 schema/rules、DispatchState和两登记协议；Main 维护知识事务、计划意图、生命周期装配和真实采纳；Bridge/UI 仅导出纯协议并展示明确采纳。中文注释、CONTRACT与各目录类图随实际代码同步。

## 兼容与不确定性

现有 captureId、definitionHash、knowledgeRevision 不升级为 generationId。首次 observed_existing 仅表示从本次观察开始追踪，不能证明此前历史连续，也不能发现两次观察间没有受控事件的离线同字节删除重建。旧日志、旧回执和缺省来源字段不补造历史；新来源 journal 严格核完整原记录，旧无来源日志保持原兼容。

prepared 无 pending 在持锁重开且原 before 可核实时安全回滚；pending 却丢失 journal 属于损坏，不能据“查不到”解除。committed 后来源结算失败只保留 pending，明确核实或重开只补原结算。跨存储没有 ACID；正式写前屏障与原事务恢复给出可核实边界。本片未接实际派发，因此不声称已阻止所有旧任务领取；R02-C 后续必须接同一来源门禁。

来源、事件与单次变更设置明确容量；prepare 为 terminal 预留额度，不能写入知识后才因审计容量不足无法结算。旧计划缺少新意图时，已提交只查原回执；未提交要求重新预览，不能猜原替换语义。

## 验收矩阵

- 普通编辑不换代；创建、级联删除、移动、受控同路径重建、真实整包 replace、模块隐藏/重现按实际闭包更新，兄弟对象不误改。Agent 不误套模块过滤规则。
- 新登记/采纳与生命周期 pending 两向竞争；原能力、模型、责任回执保持；退休引用规则继续成立。未采纳、已退役、缺失和未核实状态明确可见。
- 严格重放验证：坏 source 记录、混合批次、来源/消费者不匹配、超限、旧格式及日志身份冲突；当前内容碰巧相同不能补造历史成功。
- 故障窗口：prepared 前后、pending 保存未知、正式写入中、committed 后 final 失败、final 回复丢失、journal 缺失/损坏。知识实际成功不被回滚，原命令只结算一次，未知不重做。
- 真实 Application/ObjectCrud/资源包走现入口，无模型代造来源。最终 Windows EXE 在隔离测试工作区验证明确采纳、内容编辑、删除重建、旧引用提示与原命令重开；进程故障测试覆盖真实日志窗口。真实桌面与确定性测试分别报告。
- 类型、架构、含类型循环、边界及相关回归通过；本片涉及统一知识事务与启动装配，完成后运行全仓测试。最终构建和真机验收后更新 roadmap、开发记录并独立提交。

本片完成后仍须[按负责人规划/派发/领取](module-owner-dispatch.md)与 R02-D 的存量显式交接。最终包`20261107-235854`正常/旧版本两场通过；全仓中的真实历史回归已修、单个旧队列夹具采样修正后定向通过，具体分批结果如实保留在报告。第9组只保留计划，不扩大本轮范围。
