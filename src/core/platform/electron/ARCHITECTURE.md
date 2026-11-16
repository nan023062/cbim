# src/core/platform/electron 架构

<a id="contract"></a>

## 设计意图

Electron 独立技术入口：匿名网页读取与系统加密；由可信 Bridge 注入，普通业务不导入 Electron。

## 主要组成

| 组成 | 定位 |
| --- | --- |
| [ElectronBrowserReader](web-reader.ts) | 基础网页能力的 Electron/Chromium 适配，采集脚本执行后的正文及跨域 iframe。 |
| [secrets](secrets.ts) | 用 Electron 系统加密能力保护 LLM 与 GitHub 反馈凭据。 |

<!-- architecture:generated:start -->

## 架构关系

```mermaid
classDiagram
class N_e77c84371fe8["BrowserReader"] {
  <<boundary>>
}
click N_e77c84371fe8 href "../../web/browser-reader.ts"
class N_1ce15254a24f["ElectronBrowserReader"]
click N_1ce15254a24f href "web-reader.ts"
class N_601c71d0c026["secrets"] {
  <<module>>
}
click N_601c71d0c026 href "secrets.ts"
N_e77c84371fe8 <|.. N_1ce15254a24f
```

外部继承／实现边界：[BrowserReader](../../web/browser-reader.ts)。

[上层设计](../ARCHITECTURE.md)

<!-- architecture:generated:end -->
