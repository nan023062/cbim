# src/logic/governance/rules 架构

<a id="contract"></a>

## 设计意图

定义模块知识治理的事实、反馈与实施条件。纯规则核对来源和决定，工具协议只提供有限的观察与提案能力，不直接写入正式知识。

## 主要组成

| 组成 | 定位 |
| --- | --- |
| [module-governance](module-governance.ts) | 单个 Module 正式知识治理的严格输入、不可变提案、本机决定及实施回执协议。 |
| [module-governance-rules](module-governance-rules.ts) | 模块知识治理的纯事实投影、提案依据、决定追加和知识写入门禁。 |
| [module-governance-feedback](module-governance-feedback.ts) | 核实新提案对原本机反馈的精确回应引用，并派生当前/已替代状态与逐项评价范围。 |
| [module-governance-tools](module-governance-tools.ts) | 主 Agent 治理工具的严格输入、真实来源端口和有界业务输出；不承载桌面批准或正式知识实施。 |

<!-- architecture:generated:start -->

## 架构关系

```mermaid
classDiagram
class N_f9aeb652fd94["module-governance"] {
  <<module>>
}
click N_f9aeb652fd94 href "module-governance.ts"
class N_965ffbd829bd["module-governance-rules"] {
  <<module>>
}
click N_965ffbd829bd href "module-governance-rules.ts"
class N_63344702b555["module-governance-feedback"] {
  <<module>>
}
click N_63344702b555 href "module-governance-feedback.ts"
class N_09c421be79f2["module-governance-tools"] {
  <<module>>
}
click N_09c421be79f2 href "module-governance-tools.ts"
N_965ffbd829bd ..> N_f9aeb652fd94 : 依赖
N_63344702b555 ..> N_f9aeb652fd94 : 依赖
N_63344702b555 ..> N_965ffbd829bd : 依赖
N_09c421be79f2 ..> N_f9aeb652fd94 : 依赖
N_09c421be79f2 ..> N_965ffbd829bd : 依赖
```

[上层设计](../ARCHITECTURE.md)

<!-- architecture:generated:end -->
