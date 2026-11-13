# src/backend/core/foundation 架构

## 目录定位

领域共用错误、严格 JSON、标识及路径端口；hash/json 兼容名称重导出 utility 唯一算法。独立文件 I/O 已归 foundations/files；StoragePaths 的 protectedRoots 声明额外程序缓存，路径核验仍归平台。

本文描述当前实现。通过分析目录边界后维护的 [源码架构脚本](../../../../scripts/source-architecture.mjs) 同步清单和声明；代码变更时仍须核对职责、关键成员与关系。

## 代码清单

| 文件 | 当前职责 |
| --- | --- |
| [errors.ts](errors.ts) | 跨领域统一错误码与失败出口。 |
| [identity.ts](identity.ts) | 运行记录路径中任务和执行标识的格式检查。 |
| [json.ts](json.ts) | 严格 JSON 解析，拒绝重复字段与无效语法。 |
| [paths.ts](paths.ts) | 工作区身份与受控路径解析端口。 |
| [serialization.ts](serialization.ts) | Core 既有 hash/json 名称的兼容适配，算法实现归独立 utility 基础库。 |

## 架构类图

### errors.ts

```mermaid
classDiagram
class N_src_backend_core_foundation_errors_ts["errors.ts"] {
  <<module>>
  +fail()
}
```

```mermaid
classDiagram
class N_src_backend_core_foundation_errors_ts["errors.ts"] {
  <<module>>
}
class N_src_backend_core_foundation_errors_ts_Fault["Fault"] {
  +code
}
N_src_backend_core_foundation_errors_ts ..> N_src_backend_core_foundation_errors_ts_Fault : 声明
class N_src_backend_core_foundation_errors_ts_external_Error["Error (外部契约)"] {
  <<external>>
}
N_src_backend_core_foundation_errors_ts_external_Error <|-- N_src_backend_core_foundation_errors_ts_Fault
```


### identity.ts

```mermaid
classDiagram
class N_src_backend_core_foundation_identity_ts["identity.ts"] {
  <<module>>
  +safeId()
}
```


### json.ts

```mermaid
classDiagram
class N_src_backend_core_foundation_json_ts["json.ts"] {
  <<module>>
  +parseJson()
}
```

直接依赖：[errors.ts](errors.ts)。

### paths.ts

```mermaid
classDiagram
class N_src_backend_core_foundation_paths_ts["paths.ts"] {
  <<module>>
}
class N_src_backend_core_foundation_paths_ts_StoragePaths["StoragePaths"] {
  <<interface>>
  +userRoot
  +installRoot
  +protectedRoots
  +identity()
  +project()
  +local()
  +knowledge()
}
N_src_backend_core_foundation_paths_ts ..> N_src_backend_core_foundation_paths_ts_StoragePaths : 声明
```


### serialization.ts

```mermaid
classDiagram
class N_src_backend_core_foundation_serialization_ts["serialization.ts"] {
  <<module>>
}
```
直接依赖：[../../../foundations/utility/node.ts](../../../foundations/utility/node.ts)、[../../../foundations/utility/index.ts](../../../foundations/utility/index.ts)。

### 本目录调用边界

```mermaid
classDiagram
class N_src_backend_core_foundation_json_ts["json.ts"] {
  <<module>>
}
class N_src_backend_core_foundation_errors_ts["errors.ts"] {
  <<module>>
}
N_src_backend_core_foundation_json_ts ..> N_src_backend_core_foundation_errors_ts : 导入依赖
```


## 子目录导航

无子目录。

[返回上层](../ARCHITECTURE.md)。

每次修改本目录代码，同步维护文件头、关键契约说明及本图。未实现的治理、证据验收和自动编排能力不列入当前类图。
