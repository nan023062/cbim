# CBIM 网页工具适配

WebService 实现 Core 的 WebToolsPort；通过 `backend/core/foundation/web` 公开入口组合 WebPageReader，不再实现 HTTP、正文解析、缓存、robots 或浏览器生命周期。基础类库不反向引用本服务。

`fetch` 保持原工具输入输出，每次调用捕获 WebSettings 的 browserRobotsPolicy（缺省 allow），交给基础读取器并附加 `untrusted:true`。设置更新只影响后续调用；读取器按策略分隔缓存。Application 持有应用级读取器，桌面通过平台参数注入匿名浏览器；缺少浏览器适配时保留静态错误。Brave 密钥/开关不控制浏览器策略。

`search` 独立负责 Brave 用户设置和节流，凭据只发固定 API，不跟随重定向；只返回标题、URL 和摘要，不自动抓取结果。搜索密钥与用户身份不传入页面读取器。

读取失败的具体语义与限制见 [基础网页契约](../../core/foundation/web/CONTRACT.md)。工具注册和权限仍在 Scheduler，配置与持久化仍在 Main/settings；协议没有新增浏览器控制、登录或任意脚本执行入口。
