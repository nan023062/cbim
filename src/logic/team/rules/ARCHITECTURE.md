# src/logic/team/rules 架构

<a id="contract"></a>

## 设计意图

保存引擎调用所需的成员快照、自动执行与工具名称规则。当前组织目录与 Agent 设置由 projects 管理，不运行旧成员服务。

## 主要组成

| 组成 | 定位 |
| --- | --- |
| [automatic-execution](automatic-execution.ts) | 定义用户选择的协作模式和自动兜底的冻结身份，供计划、任务与运行共用。 |
| [member-execution-binding](member-execution-binding.ts) | 岗位负责人派发的纯选择与冻结身份契约，供目标、任务、运行和公开视图共用。 |
| [workspace-member-rules](workspace-member-rules.ts) | 岗位登记的规范指纹、预览依据、不可变审计与单条事件投影；由可信服务与 Store 重放共同调用。 |
| [workspace-member-tools](workspace-member-tools.ts) | 助理岗位治理的窄输入、回执和装配端口，独立于 UI 与存储。 |
| [workspace-member](workspace-member.ts) | 定义工作区长期岗位、采纳快照、版本化登记命令与公开查询协议，供 Main、Store 和桌面共用。 |

<!-- architecture:generated:start -->

## 架构关系

```mermaid
classDiagram
class N_6d3db0fcdfc5["workspace-member"] {
  <<module>>
}
click N_6d3db0fcdfc5 href "workspace-member.ts"
class N_4eaf1f6efc7c["workspace-member-rules"] {
  <<module>>
}
click N_4eaf1f6efc7c href "workspace-member-rules.ts"
class N_95d605e61301["workspace-member-tools"] {
  <<module>>
}
click N_95d605e61301 href "workspace-member-tools.ts"
class N_d22612ba4b6a["automatic-execution"] {
  <<module>>
}
click N_d22612ba4b6a href "automatic-execution.ts"
class N_849821aceb27["member-execution-binding"] {
  <<module>>
}
click N_849821aceb27 href "member-execution-binding.ts"
N_4eaf1f6efc7c ..> N_6d3db0fcdfc5 : 依赖
N_95d605e61301 ..> N_6d3db0fcdfc5 : 依赖
```

[上层设计](../ARCHITECTURE.md)

<!-- architecture:generated:end -->
