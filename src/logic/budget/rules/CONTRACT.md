# 迁移期请求预算端口

本目录仅保留 request-budget.ts 的 RequestBudgetPort、RequestBudgetTicket 与未知原因契约；依赖旧 budget 的请求账本类型。reserve/issue 分别保存申请与发送意图，实际发送前同步 assertSend；报告、明确未发送与未知分别保留事实。

模型目录、配置 Schema、供应商连接与引擎选型已迁入 [Logic 模型](../../models/CONTRACT.md)。配置服务在 [Logic 模型服务](../../models/service/CONTRACT.md)，不保留旧模型规则转发。

实际请求传输仍位于 backend/engines/transport，预算服务仍在 scheduler-engine/budget；本批没有迁移预算所有权或改变账本、结算与工具授权顺序。
