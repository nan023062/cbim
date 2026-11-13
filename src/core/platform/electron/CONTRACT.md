# Electron 网页适配

web-reader.ts 是独立宿主入口；只在桌面 ready 后由旧 Main 装配，普通 Node 和业务纯入口不加载它。实现 Core BrowserReader，使用 Core Node web 的公开代理和地址校验。

保持匿名内存会话、隐藏隔离窗口、逐资源授权、取消释放、跨域 iframe 采集与一次读取限额。没有登录、任意脚本或点击入口；最多两个并行槽位，错误不被改写为页面私有。具体限额与资源清理规则见 [网页读取契约](../node/web/CONTRACT.md)。

真实 Electron 验证由 tests/web-browser-electron-fixture.ts 和 scripts/web-browser-smoke.mjs 承担，单元通过不等同于真实网站验收。
