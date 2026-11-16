# src/logic/materials/service 架构

<a id="contract"></a>

## 设计意图

聊天输入、附件与引用材料的本机采集/持久化；保存的快照不自动证明当前来源有效。

## 主要组成

| 组成 | 定位 |
| --- | --- |
| [ChatInputs](chat-inputs.ts) | 将用户明确添加的文件、文件夹、链接、网页与链接器定义保存为本机对话输入快照。 |
| [ChatMaterialImports](chat-material-imports.ts) | 应用内显式资料导入的取消、工作区归属及真实资源仓库读取入口。 |

<!-- architecture:generated:start -->

## 架构关系

```mermaid
classDiagram
class N_3b22cba58f6d["ChatInputs"]
click N_3b22cba58f6d href "chat-inputs.ts"
class N_f0cd793bd653["ChatMaterialImports"]
click N_f0cd793bd653 href "chat-material-imports.ts"
N_f0cd793bd653 ..> N_3b22cba58f6d : 依赖
```

[上层设计](../ARCHITECTURE.md)

<!-- architecture:generated:end -->
