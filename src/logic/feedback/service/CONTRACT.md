# GitHub 反馈服务

index.ts 向宿主公开 GitHubFeedback/GitHubFeedbackAuth；配置路径、加密实现和应用生命周期由应用装配和 Bridge 宿主注入，服务不依赖旧 backend、Bridge、View 或模型业务。GitHubRequest 是有界请求替换端口，生产实现固定 GitHub 主机，不接受模型提供目标。github-api.ts 单独登记 HTTP 逻辑边界与测试模块，供本服务及其传输测试使用；宿主仍只通过 service/index.ts 装配业务。

Auth 拥有连接代际、设备授权会话和配置队列；公开状态不含令牌/device_code，诊断不解密、不联网。授权按 interval/slow_down/过期规则推进；断开或退出取消在途操作，旧绑定不得改投新账号或仓库。系统加密不可用时拒绝保存凭据，不回退明文。

GitHubFeedback 拥有按工作区持久化的提交账本和串行队列，先保存 sending 再执行一次 POST。丢失或不可靠回包保留未知，禁止自动重发；receipt 只匹配原账号、仓库、标记及标题/正文指纹，不查询开发进度。原数据格式、摘要字节、锁 scope 和关闭顺序保持。

原生锁组合 Core platform/node/locking，队列和事务边界仍归各业务服务。错误使用同一 Core Fault，旧异常兼容入口已移除，消费者直接使用 Core 构造器。新增反馈字段应修改纯契约；变更设备授权、凭据和回执策略分别修改 auth 或 github-feedback，不放入共享 Core。

# GitHub HTTP 适配边界

github-api 继续拥有固定地址白名单、方法、令牌、20 秒期限、2 MiB 原字节上限、JSON 解码和错误脱敏。响应体通过 utility.readBoundedBytes 收集，基础库不决定目标地址、授权或重试，不记录请求内容。

reader 取消不依赖 fetch 转发信号；中断、超限或坏 JSON 均沿原 GITHUB_NETWORK 对外出口报告未取得可靠回包，不泄漏底层 reason 或自动重发写请求。工具证据、设备授权、连接持久化与业务反馈仍由本目录原服务拥有，基础库读取完成不等同于反馈业务成功。

授权单元直接构造 Auth，使用请求/加密/锁替身及临时文件；传输单元只验证 github-api。提交契约保留真实 Auth、文件和原生锁的协作，真实 Pi 反馈用例另按 integration 登记。便携反馈入口可面向浏览器构建，服务入口仅用于宿主。

## 授权、提交与未知结果

反馈默认预置公开 Client ID `Ov23liSMDZneBd3gSyTo` 与 `nan023062/cbim`；没有内置用户令牌，用户仍须亲自完成 Device Flow。已有保存配置优先于默认值。

## GitHub 反馈直连

`GitHubFeedbackAuth` 使用公开 OAuth Client ID 和 Device Flow，固定连接 github.com / api.github.com；桌面按钮明确授予选定仓库的自动反馈提交。公开仓库请求 public_repo，私有仓库只有明确选择后才请求 repo；不内置公用 token。用户与不可变 repositoryId 经真实 GET 核验，令牌只经 `SecretCipher` 加密保存。设备码与 token 不进入模型／IPC，授权状态只返回短期 userCode。interval、slow_down、过期及 flowId 代际由后端检查；内核锁和队列防止其它窗口将旧登录换投新目标。取消、断开和关闭不自动创建 Issue。

`checkConnection` 沿同一设置队列与锁只读公开连接事实，不解密、不请求 GitHub、不查询提交历史。有效本机 flow 但未保存 connection 返回 `GITHUB_AUTH_PENDING`；这不证明网页上是否已经授权。网页授权、设置页轮询核验并保存连接、下一轮捕获反馈端口是不同步骤。设置读取错误保留 `GITHUB_SETTINGS`，不伪装成未登录；旧 scope 与当前连接不符时只报告变化，不改投新目标。实际提交仍在原端口中独立复验账号和仓库。

`GitHubFeedback` 向桌面主会话捕获固定目标端口，每次提交复验账号、仓库、工作区存活和当前连接。模型只填严格 BUG／需求字段；正文由纯函数排版，不遍历会话、工程或附件。先可靠保存 sending 意图再 POST；同工作区相同账号／仓库／规范化正文跨会话复用原 submitted，不因新调用 ID 重发。账本保留原 rootSessionId、内容指纹和 Issue 编号，不存正文或凭据；最多 1000 条，不静默丢弃旧记录。

只提供类型和一句简述也可走同一提交链。缺失主栏目的规范化在指纹前完成，省略、空白与“用户未提供”占位等价，完整旧输入正文不变；没有迁移账本、重新生成原提交或放宽未知写屏障。实际补充了新内容时仍是不同正文，不能绕过另一个待核实请求。

明确 HTTP 4xx 拒绝记 rejected；传输中断、5xx、坏 201 或回执落盘失败保持 sending。整个工作区的新提交受未知屏障约束，不同正文返回 GITHUB_PENDING_OTHER，不能用其它原回执宣称本条成功。只读核实最多读取原作者最近 500 条 Issue，严格比较原账号、不可变仓库、标记、标题／正文哈希及官方 URL；未找到、已改写或越界仍保持未知，不提供自动重发／清除。硬中断后可用新主会话核实原未知，不复活旧运行。

`github-api.ts` 固定 HTTPS 主机、拒绝重定向，单请求 20 秒、回包 2 MiB，无自动重试。成功工具只返回 submitted 和私有操作 UUID，不返回 Issue 链接或开发进度。连接授权失效需重新连接；不实现后台轮询、反馈历史页、附件上传、开发结果回访或 token 自动刷新。
