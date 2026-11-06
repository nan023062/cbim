# src/bridge/preload 架构

## 目录定位

固定 Electron IPC 桥；不向页面暴露 Node、凭据或任意磁盘 API。

本文描述当前实现。通过分析目录边界后维护的 [源码架构脚本](../../../scripts/source-architecture.mjs) 同步清单和声明；代码变更时仍须核对职责、关键成员与关系。

## 代码清单

| 文件 | 当前职责 |
| --- | --- |
| [preload.ts](preload.ts) | 前后端通信边界的 Electron 安全桥，仅向 window.cbim 暴露固定 call 与系统 File 导入，通过 cbim:call IPC 请求本机后端。 |

## 架构类图

### preload.ts

```mermaid
classDiagram
class N_src_bridge_preload_preload_ts["preload.ts"] {
  <<module>>
  +importFiles()
}
```


## 子目录导航

无子目录。

[返回上层](../ARCHITECTURE.md)。

每次修改本目录代码，同步维护文件头、关键契约说明及本图。未实现的治理、证据验收和自动编排能力不列入当前类图。
