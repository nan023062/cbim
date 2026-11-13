# 资源仓库服务

index.ts 是宿主入口。LocalRepository 保留 8 MiB、符号链接拒绝、仓库身份与 revision CAS、原子写盘和原生锁。RemoteRepository 保留固定 v1 协议、8 秒时限、取消、大小限制及未知写结果不重试。ResourceRepositories 持有选择配置、串行队列和共享代际，退役时取消原只读闭包。

ResourceRepositoryPaths 只要求 userRoot、installRoot、protectedRoots，宿主的 Paths 结构兼容；服务不能因此访问工程身份、知识路径或其他应用方法。受保护目录及 .cbim 的拒绝规则、账号占位和共享令牌不变。文件格式、摘要和 HTTP 字节不变。

本片先迁移边界已闭合的仓库服务，知识发布导入和工作区授权连接仍在旧 Main；后续与知识契约一起迁移。单元验证本地 CAS，既有真实 HTTP/应用/授权集成继续保留，不使用替身删除协作覆盖。
