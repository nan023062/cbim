# src/backend/core/brain/llm 架构

## 目录定位

公开模型参数、能力元数据及运行快照端口。实际配置文件和加密凭据由 main/persistence/settings 持有。

本文描述当前实现。通过分析目录边界后维护的 [源码架构脚本](../../../../../scripts/source-architecture.mjs) 同步清单和声明；代码变更时仍须核对职责、关键成员与关系。

## 代码清单

| 文件 | 当前职责 |
| --- | --- |
| [catalog.ts](catalog.ts) | 解析供应商模型目录的能力资料，供新增模型和显式同步容量使用。 |
| [config.ts](config.ts) | 定义自定义供应商及其模型目录的持久化与界面契约。 |
| [ports.ts](ports.ts) | 模型运行快照与凭据加解密端口。 |
| [request-budget.ts](request-budget.ts) | 定义 Pi 传输与工作区请求账本之间的可信窄端口。 |

## 架构类图

### catalog.ts

```mermaid
classDiagram
class N_src_backend_core_brain_llm_catalog_ts["catalog.ts"] {
  <<module>>
  +parseModelCatalog()
}
```

```mermaid
classDiagram
class N_src_backend_core_brain_llm_catalog_ts["catalog.ts"] {
  <<module>>
}
class N_src_backend_core_brain_llm_catalog_ts_DiscoveredModel["DiscoveredModel"] {
  <<interface>>
  +id
  +name
  +contextWindow
  +maxOutputTokens
  +reasoning
  +vision
}
N_src_backend_core_brain_llm_catalog_ts ..> N_src_backend_core_brain_llm_catalog_ts_DiscoveredModel : 声明
```


### config.ts

```mermaid
classDiagram
class N_src_backend_core_brain_llm_config_ts["config.ts"] {
  <<module>>
}
class N_src_backend_core_brain_llm_config_ts_LlmModel["LlmModel"] {
  <<type>>

}
N_src_backend_core_brain_llm_config_ts ..> N_src_backend_core_brain_llm_config_ts_LlmModel : 声明
class N_src_backend_core_brain_llm_config_ts_LlmDefinition["LlmDefinition"] {
  <<type>>

}
N_src_backend_core_brain_llm_config_ts ..> N_src_backend_core_brain_llm_config_ts_LlmDefinition : 声明
class N_src_backend_core_brain_llm_config_ts_LlmProfile["LlmProfile"] {
  <<interface>>
  +id
  +hasKey
}
N_src_backend_core_brain_llm_config_ts ..> N_src_backend_core_brain_llm_config_ts_LlmProfile : 声明
N_src_backend_core_brain_llm_config_ts_LlmDefinition <|-- N_src_backend_core_brain_llm_config_ts_LlmProfile
class N_src_backend_core_brain_llm_config_ts_LlmSettings["LlmSettings"] {
  <<interface>>
  +profiles
  +selectedId
  +secureStorage
}
N_src_backend_core_brain_llm_config_ts ..> N_src_backend_core_brain_llm_config_ts_LlmSettings : 声明
```


### ports.ts

```mermaid
classDiagram
class N_src_backend_core_brain_llm_ports_ts["ports.ts"] {
  <<module>>
}
class N_src_backend_core_brain_llm_ports_ts_SecretCipher["SecretCipher"] {
  <<interface>>
  +available()
  +encrypt()
  +decrypt()
}
N_src_backend_core_brain_llm_ports_ts ..> N_src_backend_core_brain_llm_ports_ts_SecretCipher : 声明
class N_src_backend_core_brain_llm_ports_ts_ResolvedLlm["ResolvedLlm"] {
  <<interface>>
  +profile
  +apiKey
}
N_src_backend_core_brain_llm_ports_ts ..> N_src_backend_core_brain_llm_ports_ts_ResolvedLlm : 声明
```

直接依赖：[config.ts](config.ts)。

### request-budget.ts

```mermaid
classDiagram
class N_src_backend_core_brain_llm_request_budget_ts["request-budget.ts"] {
  <<module>>
}
class N_src_backend_core_brain_llm_request_budget_ts_RequestUnknownReason["RequestUnknownReason"] {
  <<type>>

}
N_src_backend_core_brain_llm_request_budget_ts ..> N_src_backend_core_brain_llm_request_budget_ts_RequestUnknownReason : 声明
class N_src_backend_core_brain_llm_request_budget_ts_RequestBudgetTicket["RequestBudgetTicket"] {
  <<interface>>
  +requestId
  +issue()
  +assertSend()
  +report()
  +unknown()
  +notSent()
}
N_src_backend_core_brain_llm_request_budget_ts ..> N_src_backend_core_brain_llm_request_budget_ts_RequestBudgetTicket : 声明
class N_src_backend_core_brain_llm_request_budget_ts_RequestBudgetPort["RequestBudgetPort"] {
  <<interface>>
  +model
  +reserve()
}
N_src_backend_core_brain_llm_request_budget_ts ..> N_src_backend_core_brain_llm_request_budget_ts_RequestBudgetPort : 声明
```

直接依赖：[../../tasks/model-request-budget.ts](../../tasks/model-request-budget.ts)。

### 本目录调用边界

```mermaid
classDiagram
class N_src_backend_core_brain_llm_ports_ts["ports.ts"] {
  <<module>>
}
class N_src_backend_core_brain_llm_config_ts["config.ts"] {
  <<module>>
}
N_src_backend_core_brain_llm_ports_ts ..> N_src_backend_core_brain_llm_config_ts : 导入依赖
```


## 子目录导航

无子目录。

[返回上层](../ARCHITECTURE.md)。

每次修改本目录代码，同步维护文件头、关键契约说明及本图。未实现的治理、证据验收和自动编排能力不列入当前类图。

## 设计契约 v1 与落地范围

以下内容区分已接通能力与后续设计；以各节的实现状态为准，不将目标图当作现状图。维护源：[CONTRACT.md](CONTRACT.md)；生成类图时同步附加，勿直接修改本附录。

# llm 维护契约

## 逐请求预算（R06）

`RequestBudgetPort` 仅由可信工厂提供，模型只能生成原协议正文。ticket 的 reserve / issue 分别可靠保存申请与发送意图；实际发送前同步 assertSend，报告、明确未发送和未知各有独立事实，不提供模型可调用写入入口。
