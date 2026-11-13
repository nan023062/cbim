# 请求与作用域预算规则

本目录拥有模型请求预算的数据、状态约束、存储端口及作用域预算与用量协议。model-request-budget.ts、model-request-budget-rules.ts 和 model-request-budget-invariants.ts 定义请求账本及合法演进，model-request-budget-storage.ts 声明存储边界；scope-budget.ts、scope-budget-invariants.ts、scope-usage.ts 定义目标周期预算和公开用量。

request-budget.ts 提供 RequestBudgetPort、RequestBudgetTicket 与未知原因契约，依赖本域请求账本类型。reserve/issue 分别保存申请与发送意图，实际发送前同步 assertSend；报告、明确未发送与未知分别保留事实。规则不执行网络请求，也不拥有模型凭据或运行服务。

实际请求传输位于 [execution/engines/transport](../../execution/engines/transport/ARCHITECTURE.md)，预算编排在 [budget/runtime](../runtime/ARCHITECTURE.md)，持久化由 [dispatch/storage](../../dispatch/storage/CONTRACT.md) 承担。模型目录和配置服务分别见 [models](../../models/CONTRACT.md) 与 [models/service](../../models/service/CONTRACT.md)。迁移保留账本、结算与工具授权顺序。
