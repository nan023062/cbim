# Cindy 插件声明规范

CBIM 连接器只是 Cindy 插件的声明与引用，不实现 MCP 客户端、连接建立、认证、连接池、断开或回收。插件实现、工具接口、账号和连接生命周期全部复用宿主。

唯一真源是调用方提供的连接器注册表，遵循 [注册表 Schema](registry.schema.json)。不再为每项建立 connector.json 或 usage.md。

注册表包含 connectors 数组；条目为 id、name、summary、plugin。id 是稳定逻辑引用标识，沿用 .cbim/connectors/<name> 形式但不表示目录存在；plugin 包含 Cindy 的 ghost_id 和 namespace，公开根命名空间使用 JSON null，企业命名空间保留实际字符串，不能以字符串 null 代替。

只登记已发现、身份明确的 Cindy 插件，运行时仍须核实已启用、当前工作区可用及账号条件。插件安装或可发现不证明全部操作已获授权。注册表不复制工具 Schema、凭证、MCP 地址或维护第二份插件手册。

Agent 和 Module 的 connectors 列表通过 id 引用声明。插件是团队共享资源，引用不表示独占关系或授予写权限。未映射到真实插件的旧配置保留迁移记录，不伪造插件 id。

插件信息及必要操作说明由宿主按需发现；连接器层不反向加载 Task、Skill、能力或业务规范。
