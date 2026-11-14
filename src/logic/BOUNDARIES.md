# 业务修改入口与依赖

Logic 的规则归各业务 rules/ports；服务、存储和平台实现分别组织。Application 是业务生命周期与装配的唯一持有者，Bridge 通过派发适配器使用它，不复制运行集合或关闭流程。业务不依赖 Bridge、View 或 Electron。

| 修改对象 | 规则与状态 | 副作用与编排 |
| --- | --- | --- |
| 任务和目标 | tasks/rules、dispatch/rules | tasks/runtime、dispatch/runtime、dispatch/storage |
| 模型执行 | execution/rules、models | execution/engines、assembly、storage；conversation/runtime、team/runtime |
| 知识与责任 | knowledge/rules、workspace/rules、team/rules | knowledge/storage、service；workspace/service、team/service |
| 受控文件与证据 | file-operations/rules、evidence/rules | file-operations/service、platform；evidence/service、runtime |
| 资料与资源 | materials/contracts、resources/contracts | materials/service、resources/packages、connectors/service |
| 更新恢复 | updates/contracts | updates/service；可信启动在 Bridge/server/bootstrap |

先核状态权威和原事务，再读实际副作用。派发存储仍有跨领域原子事务，迁移没有把它拆成多个独立账本；执行 runtime 与装配仍有较高依赖密度，不以目录调整声称完成所有职责解耦。规则不能依赖服务，具体引擎仅由 execution/assembly 选择，Application 不能成为服务反向依赖的通用容器。

各域类图见 [Logic 导航](ARCHITECTURE.md)；协作不变量见 [调度契约](SCHEDULING.md) 与 [应用生命周期](application/CONTRACT.md)。
