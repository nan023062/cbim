# src/logic/runtime/settings 架构

<a id="contract"></a>

## 设计意图

Logic 层的应用并发设置持久化：在工作区打开前恢复准入策略，配置可靠写盘后才影响新运行。协作方为 Application、GlobalRunAdmission 和可注入文件存储；不管理模型、网页、预算或知识配置。

## 主要组成

| 组成 | 定位 |
| --- | --- |
| [AdmissionSettings](admission-settings.ts) | 持久化应用级并发上限，并在工作区装配前恢复准入策略。 |

<!-- architecture:generated:start -->

## 架构关系

```mermaid
classDiagram
class N_a09e278fa821["AdmissionSettings"]
click N_a09e278fa821 href "admission-settings.ts"
```

[上层设计](../ARCHITECTURE.md)

<!-- architecture:generated:end -->
