# src/backend/core 架构

## 目录定位

核心领域与通用执行契约。大脑、团队、业务模块、知识和工具各自维护语义；不导入 main、调度、IPC 或界面。brain/tasks、knowledge/team/workspace 的目录双向箭头来自不同契约文件，不代表文件级循环。

本文描述当前实现。通过分析目录边界后维护的 [源码架构脚本](../../../scripts/source-architecture.mjs) 同步清单和声明；代码变更时仍须核对职责、关键成员与关系。

## 代码清单

本层无直接代码文件。

## 架构类图

```mermaid
classDiagram
class N_src_backend_core_brain["brain/"] {
  <<directory>>
}
class N_src_backend_core_connectors["connectors/"] {
  <<directory>>
}
class N_src_backend_core_foundation["foundation/"] {
  <<directory>>
}
class N_src_backend_core_governance["governance/"] {
  <<directory>>
}
class N_src_backend_core_knowledge["knowledge/"] {
  <<directory>>
}
class N_src_backend_core_policy["policy/"] {
  <<directory>>
}
N_src_backend_core_brain ..> N_src_backend_core_foundation : 导入依赖
N_src_backend_core_brain ..> N_src_backend_core_policy : 导入依赖
N_src_backend_core_governance ..> N_src_backend_core_foundation : 导入依赖
N_src_backend_core_knowledge ..> N_src_backend_core_foundation : 导入依赖
N_src_backend_core_knowledge ..> N_src_backend_core_connectors : 导入依赖
N_src_backend_core_policy ..> N_src_backend_core_governance : 导入依赖
```

```mermaid
classDiagram
class N_src_backend_core_runtime["runtime/"] {
  <<directory>>
}
class N_src_backend_core_tasks["tasks/"] {
  <<directory>>
}
class N_src_backend_core_team["team/"] {
  <<directory>>
}
class N_src_backend_core_tools["tools/"] {
  <<directory>>
}
class N_src_backend_core_workspace["workspace/"] {
  <<directory>>
}
N_src_backend_core_runtime ..> N_src_backend_core_tasks : 导入依赖
N_src_backend_core_runtime ..> N_src_backend_core_team : 导入依赖
N_src_backend_core_tasks ..> N_src_backend_core_tools : 导入依赖
N_src_backend_core_tasks ..> N_src_backend_core_team : 导入依赖
N_src_backend_core_tasks ..> N_src_backend_core_workspace : 导入依赖
N_src_backend_core_team ..> N_src_backend_core_tasks : 导入依赖
```

各图中的同名节点表示同一目录边界；跨组及完整直接依赖如下（无边不代表继承）：

- `brain` → `foundation`：导入。
- `brain` → `tasks`：导入。
- `brain` → `tools`：导入。
- `brain` → `policy`：导入。
- `connectors` → `tools`：导入。
- `governance` → `foundation`：导入。
- `knowledge` → `foundation`：导入。
- `knowledge` → `team`：导入。
- `knowledge` → `workspace`：导入。
- `knowledge` → `connectors`：导入。
- `policy` → `tools`：导入。
- `policy` → `governance`：导入。
- `runtime` → `tasks`：导入。
- `runtime` → `brain`：导入。
- `runtime` → `team`：导入。
- `tasks` → `foundation`：导入。
- `tasks` → `tools`：导入。
- `tasks` → `team`：导入。
- `tasks` → `brain`：导入。
- `tasks` → `policy`：导入。
- `tasks` → `workspace`：导入。
- `team` → `knowledge`：导入。
- `team` → `foundation`：导入。
- `team` → `tasks`：导入。
- `team` → `brain`：导入。
- `tools` → `policy`：导入。
- `tools` → `foundation`：导入。
- `tools` → `connectors`：导入。
- `workspace` → `knowledge`：导入。
- `workspace` → `foundation`：导入。

## 子目录导航

- [brain/](brain/ARCHITECTURE.md)：引擎无关的执行循环、事件与计量。文件采集和检查点沿真实工具授权封闭并发；专用成员续执行保留身份并清空旧证据，普通启动不变成恢复入口。停止覆盖准备与复核，正常关闭后才确认停泊。
- [connectors/](connectors/ARCHITECTURE.md)：链接器定义、查询与唯一身份检查；当前不执行外部插件。
- [foundation/](foundation/ARCHITECTURE.md)：少量跨领域基础：错误、序列化、严格 JSON、标识及路径端口。files.ts 是 Node 文件原语，不管理应用目录、事务或账户。
- [governance/](governance/ARCHITECTURE.md)：模块知识治理的纯协议、保护规则与有界主工具投影。可信来源、冻结意见引用与本机评价独立于正式实施，旧意见替代不改历史，不把治理记录当业务验收。
- [knowledge/](knowledge/ARCHITECTURE.md)：知识快照、校验、领域查询、对象变更和可移植静态包规划。团队能力可独立复用，业务模板必须完整；物理事务与预览缓存经端口注入，不携带动态成员或任务。Team/Workspace 只依赖快照辅助，不依赖查询门面。
- [policy/](policy/ARCHITECTURE.md)：内部运行的统一授权：业务与知识写入共用 read/ask/execute，平台边界不可豁免；不声称操作系统隔离。
- [runtime/](runtime/ARCHITECTURE.md)：应用级只读监管、真实周期白名单与独立准入契约。周期等待/结算和模型轮次分开，严格传输不补造缺失计量；游标、票据和占用不签发恢复权。
- [tasks/](tasks/ARCHITECTURE.md)：任务计划、派发图、目标与等待。检查点纯规则核实文件操作全集、成功回执及正常终态，预约与领取消费分别持久化；原任务/实例/会话不变且只续一次。关闭封存待办，历史不冒充验收或恢复授权。 人工决定用独立有界追加历史绑定当前依据，模型不能构造批准或夹带图变化。
- [team/](team/ARCHITECTURE.md)：Team、小组、Agent 和父链 Skill 视图、实例及静态角色 Session 履历契约。主实例归主会话，业务实例归周期与任务；履历按角色聚合真实通道，释放或删定义后保留，旧记录不补造实例。
- [tools/](tools/ARCHITECTURE.md)：工具 Schema、版本、副作用、调用决策、结构化提问及回执；统一校验结果的 JSON 传输快照，拒绝缺失文本等无效内容。回执绑定运行身份与输入结果哈希；注册和发现不授予执行权限。
- [workspace/](workspace/ARCHITECTURE.md)：领域工程、Module、本模块 Workflow 的只读视图及显式维护关系类型；作者与维护人分开，与 main/workspace 生命周期分开。

[返回上层](../ARCHITECTURE.md)。

每次修改本目录代码，同步维护文件头、关键契约说明及本图。未实现的治理、证据验收和自动编排能力不列入当前类图。
