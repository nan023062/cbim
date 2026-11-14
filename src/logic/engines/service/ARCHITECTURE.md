# src/logic/engines/service 架构

## 目录定位

EngineModelProfiles 将引擎选型映射为模型协议需求，复用模型服务唯一配置锁和延迟解密；返回引擎快照，不拥有模型存储或引擎安装状态。

本文描述当前实现。通过分析目录边界后维护的 [源码架构脚本](../../../../scripts/source-architecture.mjs) 同步清单和声明；代码变更时仍须核对职责、关键成员与关系。

## 代码清单

| 文件 | 当前职责 |
| --- | --- |
| [index.ts](index.ts) | 应用装配可用的引擎选型服务入口，与便携清单分离。 |
| [model-profiles.ts](model-profiles.ts) | 把 Agent 引擎选型映射为通用模型连接需求，并在返回快照中冻结显式引擎身份。 |

## 架构类图

### index.ts

```mermaid
classDiagram
class N_src_logic_engines_service_index_ts["index.ts"] {
  <<module>>
}
```
直接依赖：[model-profiles.ts](model-profiles.ts)。

### model-profiles.ts

```mermaid
classDiagram
class N_src_logic_engines_service_model_profiles_ts["model-profiles.ts"] {
  <<module>>
}
class N_src_logic_engines_service_model_profiles_ts_EngineModelReference["EngineModelReference"] {
  <<interface>>
  +profileId
  +modelId
  +engine
  +modelRoles
}
N_src_logic_engines_service_model_profiles_ts ..> N_src_logic_engines_service_model_profiles_ts_EngineModelReference : 声明
class N_src_logic_engines_service_model_profiles_ts_LockedEngineModelConfiguration["LockedEngineModelConfiguration"] {
  <<interface>>
  +profile
  +resolve()
}
N_src_logic_engines_service_model_profiles_ts ..> N_src_logic_engines_service_model_profiles_ts_LockedEngineModelConfiguration : 声明
class N_src_logic_engines_service_model_profiles_ts_EngineModelProfiles["EngineModelProfiles"] {
  +list()
  +resolve()
  +configuration()
  +withConfigurations()
  +withRuntimeConfiguration()
  +test()
  -models
}
N_src_logic_engines_service_model_profiles_ts ..> N_src_logic_engines_service_model_profiles_ts_EngineModelProfiles : 声明
```

直接依赖：[../../../core/errors.ts](../../../core/errors.ts)、[../../models/index.ts](../../models/index.ts)、[../../models/service/index.ts](../../models/service/index.ts)、[../index.ts](../index.ts)。

### 本目录调用边界

```mermaid
classDiagram
class N_src_logic_engines_service_index_ts["index.ts"] {
  <<module>>
}
class N_src_logic_engines_service_model_profiles_ts["model-profiles.ts"] {
  <<module>>
}
N_src_logic_engines_service_index_ts ..> N_src_logic_engines_service_model_profiles_ts : 导入依赖
```


## 子目录导航

无子目录。

[返回上层](../ARCHITECTURE.md)。

每次修改本目录代码，同步维护文件头、关键契约说明及本图。未实现的治理、证据验收和自动编排能力不列入当前类图。
