# Web 服务与配置

WebService 实现纯业务 WebToolsPort，默认创建 Core WebPageReader；可注入同契约读取端口，既有四个构造参数及默认装配保持。页面缓存和浏览器资源由读取器拥有，搜索节流由本服务拥有。

fetch 每次捕获 browserRobotsPolicy（默认 allow），向读取器传递原取消信号，校验输入并添加 untrusted:true。设置更新只影响下一次调用，基础读取器按策略隔离缓存。缺少浏览器时保留原静态错误；不将渲染超时或正文为空改写成登录失败。

search 只向固定 Brave API 发送搜索密钥，不跟随重定向、不自动读取结果正文；过滤非公开 URL 并限制标题/摘要。搜索关闭或密钥错误不控制浏览器正文策略。

WebSettings 拥有实例队列、revision 与配置状态。加密和写盘成功后才发布新状态，冲突或写入失败不覆盖旧配置。旧文件默认 allow，旧客户端省略策略不重置已有策略。SecretCipher 来自 Core，宿主负责实现和路径。

独立服务单元用读取端口替身验证策略捕获和标记；设置单元使用临时目录；真实页面/浏览器兜底与业务服务的协作仍由 web-browser-fallback 契约覆盖，不用替身替代它。
