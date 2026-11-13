# 模型目录与选型

`index.ts` 是不加载 Node、Electron 或服务的纯公共入口。目录解析、配置 Schema、引擎标识、供应商预设和接口选择归本模块；配置持久化、联网与凭据解析归 [service](service/CONTRACT.md)。请求预算归 logic/budget/rules/request-budget.ts，主 Agent 设置仍归旧 main/models，未随目录整体迁入。

## 不变量

- 三引擎独立于供应商。旧 definition.engine 只用于读取兼容，不决定实际执行引擎。
- connectionForEngine 优先使用兼容的主接口，其次显式接口，最后精确匹配官方 HTTPS 预设。显式型号限制不可通过预设绕过；autoDetect=false 禁止自动补充。不转换型号、协议或失败后重试。
- 目录解析保留供应商真实容量；未知能力不填造默认容量。公开配置不包含密文或明文凭据；ResolvedLlm 是仅供可信执行侧使用的类型，桥接出口不重导出它。
- 运行快照只冻结选中的 api/baseUrl，不携带候选接口；历史字段缺省及 Pi 快照字节保持原语义。

## 迁移期消费与退出

旧 backend 的规则、引擎、调度与宿主只能通过 index.ts 使用模型规则。只有 backend/main 与 Bridge server 可通过 service/index.ts 使用服务，禁止跨边界直达实现。

`bridge/contracts/models.ts` 暂时保留既有纯规则的具名重导出，前端仍通过该契约使用相同选型规则；没有开放其他 Bridge 文件直接导入 Logic，也没有把业务规则归入 Core。这是保留现有同步草稿预览的迁移兼容边界，不代表 Bridge DTO 解耦已经完成。后续桥接迁移必须一起替换预览与公开数据消费者，才能删除该精确许可。

修改供应商地址从 provider-presets.ts 入手，修改接口优先级从 provider-connections.ts 入手，修改能力解析从 catalog.ts 入手。规则与服务分开测试，前后端共同选型及历史快照用契约测试保留。
