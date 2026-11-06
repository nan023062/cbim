# src/backend/core 架构

## 目录定位

核心领域与通用执行契约。大脑、团队、业务模块、知识和工具各自维护语义；不导入 main、调度、IPC 或界面。

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
class N_src_backend_core_knowledge["knowledge/"] {
  <<directory>>
}
class N_src_backend_core_policy["policy/"] {
  <<directory>>
}
class N_src_backend_core_runtime["runtime/"] {
  <<directory>>
}
N_src_backend_core_brain ..> N_src_backend_core_foundation : 导入依赖
N_src_backend_core_brain ..> N_src_backend_core_policy : 导入依赖
N_src_backend_core_knowledge ..> N_src_backend_core_foundation : 导入依赖
N_src_backend_core_knowledge ..> N_src_backend_core_connectors : 导入依赖
N_src_backend_core_runtime ..> N_src_backend_core_brain : 导入依赖
```

```mermaid
classDiagram
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
N_src_backend_core_tasks ..> N_src_backend_core_team : 导入依赖
N_src_backend_core_tasks ..> N_src_backend_core_tools : 导入依赖
```

各图中的同名节点表示同一目录边界；跨组及完整直接依赖如下（无边不代表继承）：

- `brain` → `tools`：导入。
- `brain` → `foundation`：导入。
- `brain` → `tasks`：导入。
- `brain` → `policy`：导入。
- `knowledge` → `foundation`：导入。
- `knowledge` → `team`：导入。
- `knowledge` → `workspace`：导入。
- `knowledge` → `connectors`：导入。
- `policy` → `tools`：导入。
- `runtime` → `brain`：导入。
- `runtime` → `tasks`：导入。
- `runtime` → `team`：导入。
- `tasks` → `team`：导入。
- `tasks` → `foundation`：导入。
- `tasks` → `tools`：导入。
- `team` → `knowledge`：导入。
- `team` → `foundation`：导入。
- `tools` → `foundation`：导入。
- `workspace` → `knowledge`：导入。
- `workspace` → `foundation`：导入。

## 子目录导航

- [brain/](brain/ARCHITECTURE.md)：引擎无关的执行循环与事件契约。工具决策、任务修订和回执先落盘；副作用及恢复使旧计划证据失效，执行结束不自动验收或重放未知操作。
- [connectors/](connectors/ARCHITECTURE.md)：链接器定义、查询与唯一身份检查；当前不执行外部插件。
- [foundation/](foundation/ARCHITECTURE.md)：少量跨领域基础：错误、序列化、严格 JSON、标识及路径端口。files.ts 是 Node 文件原语，不管理应用目录、事务或账户。
- [knowledge/](knowledge/ARCHITECTURE.md)：知识快照、校验、领域查询和对象变更规划。物理事务通过 KnowledgeWorkspace 注入，预览缓存通过 ObjectStorage 注入。Team/Workspace 仅依赖本目录的只读快照辅助，不依赖查询门面或工具注册。
- [policy/](policy/ARCHITECTURE.md)：内部运行的统一授权：业务与知识写入共用 read/ask/execute，平台边界不可豁免；不声称操作系统隔离。
- [runtime/](runtime/ARCHITECTURE.md)：应用级运行监管契约：动态成员、派发任务、旧 Loop 任务、轮次用量和负载分开表达；只读投影不签发调度、租约或权限。
- [tasks/](tasks/ARCHITECTURE.md)：任务计划、成员派发图类型及原子存储端口。图校验派发/依赖/等待关系，按游标增量读取；执行计划只产生交付候选，不自动验收。
- [team/](team/ARCHITECTURE.md)：Team、小组、Agent 和父链 Skill 的只读视图，以及独立成员实例/会话的共享类型；身份契约不引用调度与平台实现。
- [tools/](tools/ARCHITECTURE.md)：工具 Schema、版本、副作用、调用决策、结构化提问及回执；统一校验结果的 JSON 传输快照，拒绝缺失文本等无效内容。回执绑定运行身份与输入结果哈希；注册和发现不授予执行权限。
- [workspace/](workspace/ARCHITECTURE.md)：领域工程、Module、本模块 Workflow 的只读视图及显式维护关系类型；作者与维护人分开，与 main/workspace 生命周期分开。

[返回上层](../ARCHITECTURE.md)。

每次修改本目录代码，同步维护文件头、关键契约说明及本图。未实现的治理、证据验收和自动编排能力不列入当前类图。
