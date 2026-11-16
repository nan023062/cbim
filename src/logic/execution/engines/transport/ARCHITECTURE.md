# src/logic/execution/engines/transport 架构

<a id="contract"></a>

## 设计意图

引擎 HTTP 请求预算与计量适配。通过 Logic budget/rules 的 RequestBudgetPort 预占、结算或记录未知结果；网络实现与稳定模型端口分离，保留各引擎错误和取消语义。

## 主要组成

| 组成 | 定位 |
| --- | --- |
| [ModelJsonRequests](model-json-requests.ts) | 自定义领域 Loop 的非流式生成/向量请求，复用逐请求预算与冻结模型快照。 |
| [RequestBudgetUsageStream](request-budget-usage.ts) | 严格读取三种受支持 SSE 协议的请求用量，并暂存终态帧供可靠结算后交付。 |

<!-- architecture:generated:start -->

## 架构关系

```mermaid
classDiagram
class N_19251e13ffda["ModelJsonRequests"]
click N_19251e13ffda href "model-json-requests.ts"
class N_30d479b5fbc2["RequestBudgetUsageStream"]
click N_30d479b5fbc2 href "request-budget-usage.ts"
```

[上层设计](../ARCHITECTURE.md)

<!-- architecture:generated:end -->
