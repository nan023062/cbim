# 纯网页契约与正文转换

index.ts 公开输入校验、BrowserReader/BrowserPage 端口、HTML 正文提取与 Unicode 段落截断。只依赖 zod、parse5 和语言能力，不加载 Node、网络或 Electron；不包含工具身份、Brave 搜索设置或凭据。

Node 读取器通过本入口使用契约和算法，Electron 实现 BrowserReader。正文保持原标题、链接和截断规则，不把 iframe 外壳或单个 404 推断为页面私有。契约由调用者组合，缓存、robots 和资源生命周期归平台读取器。

正文算法单元在 tests/web-content.test.ts；完整抓取行为见 [Node 契约](../platform/node/web/CONTRACT.md)。
