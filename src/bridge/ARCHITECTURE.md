# src/bridge 架构

## 目录定位

前后端通信边界：contracts 声明公开数据，preload 提供 Electron 安全桥。契约可重导出 Core 公开类型和纯函数，不暴露后端服务、凭据和存储实现。

本文描述当前实现。通过分析目录边界后维护的 [源码架构脚本](../../scripts/source-architecture.mjs) 同步清单和声明；代码变更时仍须核对职责、关键成员与关系。

## 代码清单

本层无直接代码文件。

## 架构类图

```mermaid
classDiagram
class N_src_bridge_contracts["contracts/"] {
  <<directory>>
}
class N_src_bridge_preload["preload/"] {
  <<directory>>
}
```

各图中的同名节点表示同一目录边界；跨组及完整直接依赖如下（无边不代表继承）：

本层无目录间直接导入关系。

## 子目录导航

- [contracts/](contracts/ARCHITECTURE.md)：可序列化的 IPC 数据与公开展示契约。图/目标增量使用独立游标；只读核实和正式重规划分别声明来源、配置、预览与回执。历史问题单独呈现，可续聊头由后端核实，不从剩余可读记录猜测。
- [preload/](preload/ARCHITECTURE.md)：固定 Electron IPC 桥；不向页面暴露 Node、凭据或任意磁盘 API。

[返回上层](../ARCHITECTURE.md)。

每次修改本目录代码，同步维护文件头、关键契约说明及本图。未实现的治理、证据验收和自动编排能力不列入当前类图。
