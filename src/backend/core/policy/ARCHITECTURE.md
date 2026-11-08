# src/backend/core/policy 架构

## 目录定位

内部运行的统一授权：业务与知识写入共用 read/ask/execute，平台边界不可豁免；不声称操作系统隔离。 受控文件工具必须是本轮实际内部注册、唯一 business-write 效果及固定工作区范围；只读拒写，本轮免询不绕过平台检查。

本文描述当前实现。通过分析目录边界后维护的 [源码架构脚本](../../../../scripts/source-architecture.mjs) 同步清单和声明；代码变更时仍须核对职责、关键成员与关系。

## 代码清单

| 文件 | 当前职责 |
| --- | --- |
| [tool-policy.ts](tool-policy.ts) | 内部 Loop 的统一工具授权策略，同时处理业务文件与正式知识写入。 |
| [types.ts](types.ts) | 对话权限模式和单次人工确认契约。 |

## 架构类图

### tool-policy.ts

```mermaid
classDiagram
class N_src_backend_core_policy_tool_policy_ts["tool-policy.ts"] {
  <<module>>
  +authorizeRunTool()
}
```

```mermaid
classDiagram
class N_src_backend_core_policy_tool_policy_ts["tool-policy.ts"] {
  <<module>>
}
class N_src_backend_core_policy_tool_policy_ts_RunToolDescriptor["RunToolDescriptor"] {
  <<interface>>
  +effects
  +native
  +contractVersion
  +scope
}
N_src_backend_core_policy_tool_policy_ts ..> N_src_backend_core_policy_tool_policy_ts_RunToolDescriptor : 声明
class N_src_backend_core_policy_tool_policy_ts_RunPolicyContext["RunPolicyContext"] {
  <<interface>>
  +workspaceId
  +permission
  +guard()
  +approve()
}
N_src_backend_core_policy_tool_policy_ts ..> N_src_backend_core_policy_tool_policy_ts_RunPolicyContext : 声明
```

直接依赖：[types.ts](types.ts)、[../tools/types.ts](../tools/types.ts)、[../tools/scope-schema.ts](../tools/scope-schema.ts)、[../governance/module-governance-tools.ts](../governance/module-governance-tools.ts)、[../workspace/module-ownership-tool-policy.ts](../workspace/module-ownership-tool-policy.ts)。

### types.ts

```mermaid
classDiagram
class N_src_backend_core_policy_types_ts["types.ts"] {
  <<module>>
}
class N_src_backend_core_policy_types_ts_ChatPermission["ChatPermission"] {
  <<type>>

}
N_src_backend_core_policy_types_ts ..> N_src_backend_core_policy_types_ts_ChatPermission : 声明
class N_src_backend_core_policy_types_ts_ChatApproval["ChatApproval"] {
  <<interface>>
  +id
  +taskId
  +name
  +input
  +createdAt
}
N_src_backend_core_policy_types_ts ..> N_src_backend_core_policy_types_ts_ChatApproval : 声明
```


### 本目录调用边界

```mermaid
classDiagram
class N_src_backend_core_policy_tool_policy_ts["tool-policy.ts"] {
  <<module>>
}
class N_src_backend_core_policy_types_ts["types.ts"] {
  <<module>>
}
N_src_backend_core_policy_tool_policy_ts ..> N_src_backend_core_policy_types_ts : 导入依赖
```


## 子目录导航

无子目录。

[返回上层](../ARCHITECTURE.md)。

每次修改本目录代码，同步维护文件头、关键契约说明及本图。未实现的治理、证据验收和自动编排能力不列入当前类图。

## 设计契约 v1 与落地范围

以下内容区分已接通能力与后续设计；以各节的实现状态为准，不将目标图当作现状图。维护源：[CONTRACT.md](CONTRACT.md)；生成类图时同步附加，勿直接修改本附录。

### 可信工具范围与逐次权限评估

四个主治理工具由 `module-governance-tools.ts` 的精确效果表分类。只有非原生、单一匹配效果、严格 `knowledge` scope 且工作区一致的可信描述可用；缺作用域、额外效果、未知治理名、伪原生或跨工作区全部拒绝。这个例外不扩展到其他 read/preview 工具，模型不能传 scope。观察/提案保存私有记录，不产生正式知识写入权限，不触发 ask 模式的知识提交批准；原正式写入门禁保持不变。

`tool-policy.ts` 只消费调度层已识别的工具描述与可信运行权限。副作用决定 read/ask/execute 行为；原生路径守卫先于 ask 审批，拒绝或缺失审批不能放行。命令被标记为 unknown 范围，不据此承诺目录沙箱或已知副作用集合。

`RunToolDescriptor.scope` 为可选的可信装配范围。repository 范围必须匹配本轮 workspaceId、实际 cbim_repository_list/get 名称、connectorId 和操作；仅允许非原生且恰好 read 的工具。缺少捕获范围、跨工作区、混合副作用或模型伪造目标均拒绝。旧工具没有新范围时保持原分类行为；策略只核形状和绑定，真实仓库授权与共享代际仍由主进程端口在网络前后复核。

JSON/CSV/PNG 验证仅允许准确的 `cbim_validation_run` 名称、非原生且单一 `read` 效果，不因验证取得命令或知识写入权。真实注册仍须由正式成员的冻结要求及平台能力决定；策略不按模型提供的路径或 Schema 授权，不将成功回执当作验证通过。

每次调用独立产生决定；策略不存储凭据、不缓存业务批准、不复制外部资源，也不把只读回执转成任务验收。

### 模块岗位负责人逐次授权

`module-ownership-tool-policy.ts` 的四项精确工具表独立于知识目录。inspect/receipt 为 read，change_preview 为 preview，change_commit 为 knowledge-write；只有非原生、单一匹配效果和当前工作区 knowledge scope 才可分类。未知同前缀、模型传入范围或混合效果不能取得例外。提交在 read 下拒绝，在 ask 下沿真实审批，在 execute 下仍须通过来源、版本和串行事务门禁；授权不代表业务验收或已经按该岗位派发。

## 受控业务写权限

`cbim_file_write_controlled` 只能按准确的内部 business-write 和本工作区 scope 分类。read 拒绝，ask 逐次批准，execute 仍需要正式成员工厂和 Runtime 的一次授权；主调度在上层始终拒绝业务写。native:false 不进入原 native guard，因此实际平台独立核完整路径和句柄，不能据工具名字推断沙箱。

### 刷新原事务与契约版本

RunToolDescriptor.contractVersion 是实际注册表的可选元数据，供 Runtime 原授权记录；不参与权限授予，缺省表示未声明，不从 input 补齐。已有 read/ask/execute、守卫与审批顺序保持。

CSV 表格条件不增加工具权限：仍为一次受控只读检查；公式文本不执行，验证器声明不授予命令能力或访问外部服务。

PNG验证仍只允许同一非原生read工具；解压器只在平台处理已安全读取的字节，没有用户命令、网络或图像程序调用权限。生成图片本身仍由执行成员使用原任务授权，不因验证能力获得额外写入或命令权。

## 冻结范围成员执行

cbim_scoped_read 固定read、cbim_scoped_node固定command，两者要求内部注册及contractVersion=1。command沿read拒绝/ask逐次批准；隔离配置不扩大原权限。
