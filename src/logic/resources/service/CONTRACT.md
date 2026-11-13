# 资源仓库服务

index.ts 是宿主入口。LocalRepository 保留 8 MiB、符号链接拒绝、仓库身份与 revision CAS、原子写盘和原生锁。RemoteRepository 保留固定 v1 协议、8 秒时限、取消、大小限制及未知写结果不重试。ResourceRepositories 持有选择配置、串行队列和共享代际，退役时取消原只读闭包。

ResourceRepositoryPaths 只要求 userRoot、installRoot、protectedRoots，宿主的 Paths 结构兼容；服务不能因此访问工程身份、知识路径或其他应用方法。受保护目录及 .cbim 的拒绝规则、账号占位和共享令牌不变。文件格式、摘要和 HTTP 字节不变。

知识包发布导入归 [resources/packages](../packages/CONTRACT.md)，工作区授权连接归 [connectors/service](../../connectors/service/CONTRACT.md)，本目录只持有仓库及共享生命周期。单元验证本地 CAS，既有真实 HTTP/应用/授权集成继续保留，不使用替身删除协作覆盖。

## 仓库响应与共享

RemoteRepository 组合 utility.readBoundedBytes，按 `MAX_BYTES + 65536` 限制原字节，显式取消挂起 reader 并释放锁/监听；保留 #70 已修复的 Node 22 信号转发缺口。取消或超时不交付半截 JSON。8 秒期限、CANCELLED/TIMEOUT/SIZE/CONNECTION/PROTOCOL 分类、令牌、仓库身份和不重试语义仍由 request 决定；基础流不接触 URL 或凭据。

链接器、人才市场和业务模板共用 `ResourceRepositories` 的当前仓库。未登录使用本机目录；已连接服务器仓库沿用现有账号会话抽象。界面尚未实现的账户服务不会被本模块冒充为云上传。仓库快照绑定 `repositoryId` 与 `revision`，资源整体 JSON 最多 8 MiB、单项正文最多 2 MiB。
