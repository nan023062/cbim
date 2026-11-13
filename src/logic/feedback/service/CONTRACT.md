# GitHub 反馈服务

index.ts 向宿主公开 GitHubFeedback/GitHubFeedbackAuth；配置路径、加密实现和应用生命周期由 Main 注入，服务不依赖旧 backend、Bridge、View 或模型业务。GitHubRequest 是有界请求替换端口，生产实现固定 GitHub 主机，不接受模型提供目标。github-api.ts 单独登记 HTTP 逻辑边界与测试模块，供本服务及其传输测试使用；宿主仍只通过 service/index.ts 装配业务。

Auth 拥有连接代际、设备授权会话和配置队列；公开状态不含令牌/device_code，诊断不解密、不联网。授权按 interval/slow_down/过期规则推进；断开或退出取消在途操作，旧绑定不得改投新账号或仓库。系统加密不可用时拒绝保存凭据，不回退明文。

GitHubFeedback 拥有按工作区持久化的提交账本和串行队列，先保存 sending 再执行一次 POST。丢失或不可靠回包保留未知，禁止自动重发；receipt 只匹配原账号、仓库、标记及标题/正文指纹，不查询开发进度。原数据格式、摘要字节、锁 scope 和关闭顺序保持。

原生锁组合 Core platform/node/locking，队列和事务边界仍归各业务服务。错误使用同一 Core Fault，旧异常兼容入口仍指向同一构造器。新增反馈字段应修改纯契约；变更设备授权、凭据和回执策略分别修改 auth 或 github-feedback，不放入共享 Core。

# GitHub HTTP 适配边界

github-api 继续拥有固定地址白名单、方法、令牌、20 秒期限、2 MiB 原字节上限、JSON 解码和错误脱敏。响应体通过 utility.readBoundedBytes 收集，基础库不决定目标地址、授权或重试，不记录请求内容。

reader 取消不依赖 fetch 转发信号；中断、超限或坏 JSON 均沿原 GITHUB_NETWORK 对外出口报告未取得可靠回包，不泄漏底层 reason 或自动重发写请求。工具证据、设备授权、连接持久化与业务反馈仍由本目录原服务拥有，基础库读取完成不等同于反馈业务成功。

授权单元直接构造 Auth，使用请求/加密/锁替身及临时文件；传输单元只验证 github-api。提交契约保留真实 Auth、文件和原生锁的协作，真实 Pi 反馈用例另按 integration 登记。便携反馈入口可面向浏览器构建，服务入口仅用于宿主。
