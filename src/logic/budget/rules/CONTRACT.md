# 请求与作用域预算规则

本目录拥有模型请求预算的数据、状态约束、存储端口及作用域预算与用量协议。model-request-budget.ts、model-request-budget-rules.ts 和 model-request-budget-invariants.ts 定义请求账本及合法演进，model-request-budget-storage.ts 声明存储边界；scope-budget.ts、scope-budget-invariants.ts、scope-usage.ts 定义目标周期预算和公开用量。

request-budget.ts 提供 RequestBudgetPort、RequestBudgetTicket 与未知原因契约，依赖本域请求账本类型。reserve/issue 分别保存申请与发送意图，实际发送前同步 assertSend；报告、明确未发送与未知分别保留事实。规则不执行网络请求，也不拥有模型凭据或运行服务。

实际请求传输位于 [execution/engines/transport](../../execution/engines/transport/ARCHITECTURE.md)，预算编排在 [budget/runtime](../runtime/ARCHITECTURE.md)，持久化由 [dispatch/storage](../../dispatch/storage/CONTRACT.md) 承担。模型目录和配置服务分别见 [models](../../models/CONTRACT.md) 与 [models/service](../../models/service/CONTRACT.md)。迁移保留账本、结算与工具授权顺序。

### V2 逐角色预算

model-request-configuration.ts 从原执行快照投影预算模型；primary 保留旧字段及指纹，附加角色保存 slot、角色配置指纹和完整执行 bindingHash。成员预留/发送审计逐字段核对原 run.model 中的角色，不能仅复制 hash 后更换价格。

生成预算继续使用 contextWindow/maxTokens/完整价格分量；向量使用 inputTokens、dimensions、inputPrice，maxOutputTokens 必须为 0，不假造生成容量。向量只接受非缓存输入用量，未知价格仍为未知，金额为本地估算。两类请求在同一个周期账本汇总，未知、超额、重启遗留阻止后续准入。旧生成记录不补 role；旧阶段、命令指纹和终态规则保持不变。
