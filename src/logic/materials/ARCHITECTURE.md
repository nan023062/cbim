# src/logic/materials 架构

## 目录定位

聊天资料的身份、预览契约与采集保存服务；来源证明由业务持有，桥接仅传输受限数据。

本文描述当前实现。通过分析目录边界后维护的 [源码架构脚本](../../../scripts/source-architecture.mjs) 同步清单和声明；代码变更时仍须核对职责、关键成员与关系。

## 文件清单

| 文件 | 形式 | 当前职责 |
| --- | --- | --- |
| [ARCHITECTURE.md](ARCHITECTURE.md) | 说明文档 | 本目录的文件清单、真实声明、依赖与子封装导航。 |
| [contracts.ts](contracts.ts) | 源码模块 | 资料快照的附件身份和预览数据契约。 |

## 架构类图

成员标记：`+` 公开、`-` 私有、`#` 受保护、`$` 静态；构造函数单独列出。文档和资源仅在文件清单中导航，不作为代码节点。

```mermaid
classDiagram
class N_src_logic_materials_service["service/"] {
  <<directory>>
}
class N_src_logic_materials_contracts_ts["contracts.ts"] {
  <<module>>
}
N_src_logic_materials_service ..> N_src_logic_materials_contracts_ts : 导入依赖
```

各图中的同名节点表示同一目录边界；跨组及完整直接依赖如下（无边不代表继承）：

- `service` → `contracts.ts`：导入。

## 子目录导航

- [service/](service/ARCHITECTURE.md)：聊天输入、附件与引用材料的本机采集/持久化；保存的快照不自动证明当前来源有效。

[返回上层](../ARCHITECTURE.md)。

每次修改本目录代码，同步维护文件头、关键契约说明及本图。未实现的治理、证据验收和自动编排能力不列入当前类图。
