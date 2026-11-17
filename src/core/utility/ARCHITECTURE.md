# src/core/utility 架构

<a id="contract"></a>

## 设计意图

按异步协调、字节、JSON、字符串和图组织独立算法与数据结构，供不同业务复用机制而不共享业务状态。

静态工具类处理单次输入，`SerialQueue`、`PendingRequests`、`InFlightOperations` 和 `LineFramer` 各自保存一个实例的队列、关联或缓冲。错误类只报告技术事实。等待 Promise 快照、请求超时和业务取消不是同一保证；进程退出、重试及权限策略仍由消费者控制。

## 主要组成

| 组成 | 定位 |
| --- | --- |
| [SerialQueue](async.ts) | 按实例串行执行已提交操作，失败不阻断后续排队；业务取消由调用方决定。 |
| [PendingRequests](async.ts) | 按实例关联请求 ID、回执与超时计时器，由协议适配器处理超时结果。 |
| [InFlightOperations](async.ts) | 跟踪已开始的 Promise，并等待当前在途快照，不承担业务取消。 |
| [ByteLimitError](bytes.ts) | 表达字节流超限这一技术事实，具体错误文案由消费者决定。 |
| [ByteUtils](bytes.ts) | 无状态的有界字节流读取；单次调用管理 reader、缓冲与取消监听。 |
| [GraphUtils](graphs.ts) | 提供有向图结构算法，不解释任务或业务边的含义。 |
| [StrictJsonError](json.ts) | 区分 JSON 语法错误与重复键事实，保留给消费者映射的错误身份。 |
| [JsonUtils](json.ts) | 集中维护 JSON 格式化、严格解析与键排序的纯算法。 |
| [LineFramer](strings.ts) | 按单个输入流缓存文本并按 LF 分帧，保留未结束的尾部。 |
| [StringUtils](strings.ts) | 集中维护精确字符串处理算法，不持有业务状态。 |

<!-- architecture:generated:start -->

## 架构关系

### 关系组 1：ByteLimitError

```mermaid
classDiagram
class N_7eb8ee989493["ByteLimitError"]
click N_7eb8ee989493 href "bytes.ts"
class N_cd7b7ac94179["RangeError"] {
  <<boundary>>
}
class N_357c70bf833c["ByteUtils"]
click N_357c70bf833c href "bytes.ts"
class N_de81ddb11377["SerialQueue"]
click N_de81ddb11377 href "async.ts"
class N_faeda33bc800["PendingRequests"]
click N_faeda33bc800 href "async.ts"
class N_6b13caf426dd["InFlightOperations"]
click N_6b13caf426dd href "async.ts"
N_cd7b7ac94179 <|-- N_7eb8ee989493
N_357c70bf833c ..> N_7eb8ee989493 : 依赖
```

### 关系组 2：StrictJsonError

```mermaid
classDiagram
class N_5fb3965db8bf["StrictJsonError"]
click N_5fb3965db8bf href "json.ts"
class N_9c152fa63631["SyntaxError"] {
  <<boundary>>
}
class N_b2aaa0361196["JsonUtils"]
click N_b2aaa0361196 href "json.ts"
class N_2be749d7f0c5["GraphUtils"]
click N_2be749d7f0c5 href "graphs.ts"
class N_7dda93104810["LineFramer"]
click N_7dda93104810 href "strings.ts"
class N_6ae337cafce6["StringUtils"]
click N_6ae337cafce6 href "strings.ts"
N_9c152fa63631 <|-- N_5fb3965db8bf
N_b2aaa0361196 ..> N_5fb3965db8bf : 依赖
```

外部继承／实现边界：`RangeError`、`SyntaxError`。

[上层设计](../ARCHITECTURE.md)

<!-- architecture:generated:end -->
