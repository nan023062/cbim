# 连接器声明

> 当前方向：连接器是可选扩展，不是本地自动开发闭环的前置条件。Cindy 插件分支仅为读取既有声明保留兼容；当前不建设 Cindy 承载或接入。资源仓库已有真实调用方，保留实现。

CBIM 的静态声明区分 Cindy 插件映射和资源仓库身份。Cindy 映射仍不表示插件已接入；`resource_repository_v1` 由本机适配器连接用户明确共享的当前资源仓库，工作区只读授权独立登记。定义不保存令牌或地址，不自行启用服务。

- [声明规范](connector-spec.md)
- [注册表 Schema](registry.schema.json)
- [资源仓库接入切片与验证安排](../task/resource-repository-connector.md)
