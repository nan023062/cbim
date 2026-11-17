# src/logic/runtime/settings 架构

<a id="contract"></a>

## 设计意图

持久保存应用并发策略，在工作区装配前恢复并向准入协调器应用配置。

`AdmissionSettings` 负责配置版本和可靠写入，保存完成后才更新新运行采用的策略。Application 管理其生命周期，执行名额由 admission 维护；这里不拥有模型、预算或工作区业务状态。

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
