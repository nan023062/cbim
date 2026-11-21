# src/logic/feedback 架构

<a id="contract"></a>

## 设计意图

保存工具范围使用的反馈数据契约。旧反馈提交服务已退役，本目录不发起 GitHub 请求。

## 主要组成

| 组成 | 定位 |
| --- | --- |
| [contracts](contracts.ts) | CBIM 反馈 Skill、可信 GitHub 端口和桌面登录共用的纯协议。 |
| [index](index.ts) | 反馈输入、格式化、可信目标和公开连接状态的纯业务入口。 |
| [skills](skills.ts) | 反馈流程的代码常量，由所属业务模块维护，供内置资料查询或结构校验使用。 |

<!-- architecture:generated:start -->

## 架构关系

```mermaid
classDiagram
class N_c7ad01c291ab["index"] {
  <<module>>
}
click N_c7ad01c291ab href "index.ts"
class N_5a99d71c9101["contracts"] {
  <<module>>
}
click N_5a99d71c9101 href "contracts.ts"
class N_8cdab2bb9b20["skills"] {
  <<module>>
}
click N_8cdab2bb9b20 href "skills.ts"
N_c7ad01c291ab ..> N_5a99d71c9101 : 依赖
N_c7ad01c291ab ..> N_8cdab2bb9b20 : 依赖
```

[上层设计](../ARCHITECTURE.md)

<!-- architecture:generated:end -->
