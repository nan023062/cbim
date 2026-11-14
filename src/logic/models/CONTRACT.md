# 模型目录与选型

`index.ts` 是不加载 Node、Electron 或服务的纯公共入口。目录解析、配置 Schema、供应商预设和通用协议接口选择归本模块；配置持久化、联网与凭据解析归 [service](service/CONTRACT.md)。请求预算端口归 [budget/rules](../budget/rules/CONTRACT.md)，主 Agent 设置归 [team/settings](../team/settings/CONTRACT.md)，两者不由模型目录持有。

## 不变量

- 引擎身份、静态目录和引擎兼容策略归 [engines](../engines/CONTRACT.md)，本模块及 service 不导入引擎模块。旧 definition.engine 只保留冻结的三值读取范围，不决定实际执行，也不随新引擎扩展。AgentModelSelection 归 team/rules/agent-runtime。
- selectProviderConnection 接收 supportedApis 与可选 fallbackApi，优先使用兼容的主接口，其次显式接口，最后精确匹配官方 HTTPS 预设。显式型号限制不可通过预设绕过；autoDetect=false 禁止自动补充。不转换型号、协议或失败后重试。
- 目录解析保留供应商真实容量；未知能力不填造默认容量。公开配置不包含密文或明文凭据；ResolvedLlm 是仅供可信执行侧使用的类型，桥接出口不重导出它。
- 运行快照只冻结选中的 api/baseUrl，不携带候选接口；通用 ResolvedLlm 不携带 engine；执行快照由引擎层组合 ResolvedEngineModel，历史字段缺省及 Pi 快照字节保持原语义。

## 公共入口与消费边界

Logic 的规则、引擎、编排与 Bridge 消费模型规则时使用 index.ts。配置服务通过 service/index.ts 向已登记的 Logic 服务、应用装配及 Bridge 服务端公开；规则入口不得反向加载服务，调用方不得跨边界直达实现。

`bridge/contracts/models.ts` 暂时保留既有纯规则的具名重导出，前端通过该契约使用模型定义及供应商预设；引擎预览与 Agent 选型分别从 engines.ts、agent-settings.ts 消费；没有开放其他 Bridge 文件任意导入 Logic 模型实现，也没有把业务规则归入 Core。这是保留现有同步草稿预览的迁移兼容边界，不代表 Bridge DTO 解耦已经完成。若后续移除该重导出，必须一起替换预览与公开数据消费者，才能删除该精确许可。

修改供应商地址从 provider-presets.ts 入手，修改接口优先级从 provider-connections.ts 入手，修改能力解析从 catalog.ts 入手。规则与服务分开测试，前后端共同选型及历史快照用契约测试保留。
