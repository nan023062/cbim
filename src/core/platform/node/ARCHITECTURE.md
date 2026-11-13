# src/core/platform/node 架构

## 目录定位

Node 专属摘要及文件能力分别从 digest.ts 与 files/index.ts 公开；不决定业务字段、路径权限或事务。浏览器与便携入口禁止加载本目录。

本文描述当前实现。通过分析目录边界后维护的 [源码架构脚本](../../../../scripts/source-architecture.mjs) 同步清单和声明；代码变更时仍须核对职责、关键成员与关系。

## 代码清单

| 文件 | 当前职责 |
| --- | --- |
| [digest.ts](digest.ts) | 共享 Core 的 Node 专属摘要入口，提供 SHA-256 摘要。 |

## 架构类图

```mermaid
classDiagram
class N_src_core_platform_node_files["files/"] {
  <<directory>>
}
class N_src_core_platform_node_digest_ts["digest.ts"] {
  <<module>>
}
```

各图中的同名节点表示同一目录边界；跨组及完整直接依赖如下（无边不代表继承）：

本层无目录间直接导入关系。

### digest.ts 公开入口

```mermaid
classDiagram
class N_src_core_platform_node_digest_ts["digest.ts"] {
  <<module>>
  +sha256()
}
```


## 子目录导航

- [files/](files/ARCHITECTURE.md)：Node 单文件 I/O 基础方案：存在探测、JSON 读取、内容 fsync 后原子替换；路径权限、并发顺序和业务事务属于调用方。

[返回上层](../ARCHITECTURE.md)。

每次修改本目录代码，同步维护文件头、关键契约说明及本图。未实现的治理、证据验收和自动编排能力不列入当前类图。

## 设计契约 v1 与落地范围

以下内容区分已接通能力与后续设计；以各节的实现状态为准，不将目标图当作现状图。维护源：[CONTRACT.md](CONTRACT.md)；生成类图时同步附加，勿直接修改本附录。

# Node 摘要与文件

单文件 I/O 通过 [files/index.ts](files/index.ts) 使用，契约见 [files](files/CONTRACT.md)。模型服务与旧存储适配直接组合此入口，不能穿透 text-files.ts；没有旧路径转发。文件原子替换不承担业务事务或跨进程锁。

摘要公开入口为 digest.ts 的 sha256：字符串按 UTF-8、字节视图按可见范围计算 SHA-256，返回小写十六进制。仅依赖 node:crypto，无文件或网络副作用。

原 backend/core/foundation/serialization.ts 的 hash 名称仍单向重导出此实现，历史知识版本和指纹字节保持。Node 摘要不经 core/utility 导出，View/前端/桥接客户端不得导入。现阶段引擎、调度器、更新器也不因新增 Core 而扩大原依赖许可。

独立单元仍在 tests/unit/foundations/utility/digest.test.ts，模块归属为 core/platform/node。字段选择、序列化顺序、授权或验签决定不属于摘要算法。
