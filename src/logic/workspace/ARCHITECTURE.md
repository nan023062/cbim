# src/logic/workspace 架构

## 目录定位

工作区定义、工作流和执行范围规则；服务与规则分开归属，实际依赖通过明确入口验证。

本文描述当前实现。通过分析目录边界后维护的 [源码架构脚本](../../../scripts/source-architecture.mjs) 同步清单和声明；代码变更时仍须核对职责、关键成员与关系。

## 代码清单

| 文件 | 当前职责 |
| --- | --- |
| [contracts.ts](contracts.ts) | 工作区登记与运行视图的公开数据，由工作区业务拥有，供桥接协议转接。 |

## 架构类图

```mermaid
classDiagram
class N_src_logic_workspace_ports["ports/"] {
  <<directory>>
}
class N_src_logic_workspace_rules["rules/"] {
  <<directory>>
}
class N_src_logic_workspace_service["service/"] {
  <<directory>>
}
class N_src_logic_workspace_contracts_ts["contracts.ts"] {
  <<module>>
}
N_src_logic_workspace_service ..> N_src_logic_workspace_contracts_ts : 导入依赖
N_src_logic_workspace_service ..> N_src_logic_workspace_rules : 导入依赖
N_src_logic_workspace_service ..> N_src_logic_workspace_ports : 导入依赖
```

各图中的同名节点表示同一目录边界；跨组及完整直接依赖如下（无边不代表继承）：

- `service` → `contracts.ts`：导入。
- `service` → `rules`：导入。
- `service` → `ports`：导入。

## 子目录导航

- [ports/](ports/ARCHITECTURE.md)：工作区存储路径的结构化端口，规则不依赖宿主 Paths 实现。
- [rules/](rules/ARCHITECTURE.md)：领域工程、Module、Workflow与稳定岗位责任协议。来源代次和写前屏障由纯规则投影；内容指纹、来源身份、负责人关系分别核实。同负责人明确采纳递增关系版本，不迁移任务；旧缺省记录不补造来源。Workflow验证不自行读文件或签发业务验收。 只读视图归 logic/knowledge/rules/read-models，外部通过其 index.ts 访问；项目根定义仍为独立纯公开契约。 executionScope只收窄原权限，全模块一致冻结，预算合并取小。 主调度的负责人发现按所选模块真实分组，缺口不推测继承或默认负责者。
- [service/](service/ARCHITECTURE.md)：本机工作区、静态编辑与受控来源协调。获取工作区锁后在唯一DispatchStore核身份、恢复知识和来源，再发布服务。岗位和负责人以同知识快照明确采纳；首次真实观察与消费者同事务保存。来源、能力、模型分别展示，不以登记回执启动实例或改写旧任务。 负责岗位和模块责任只读发现供实际主工具调用；当前配置观察与历史执行事实分开。 原知识事务适配复用现有串行 journal 核验，固定计划与旧实例只读；不提交、刷新、恢复或修剪目录。 ControlledFiles 连接原成员授权、唯一 Store、文件平台与私有备份；原not_applied与真实退出才解除运行屏障，显式补偿重新核文件身份/摘要/关闭周期，未知不重试。

[返回上层](../ARCHITECTURE.md)。

每次修改本目录代码，同步维护文件头、关键契约说明及本图。未实现的治理、证据验收和自动编排能力不列入当前类图。
