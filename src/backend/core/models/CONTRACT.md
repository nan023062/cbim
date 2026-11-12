# llm 维护契约

## 逐请求预算（R06）

`RequestBudgetPort` 仅由可信工厂提供，模型只能生成原协议正文。ticket 的 reserve / issue 分别可靠保存申请与发送意图；实际发送前同步 assertSend，报告、明确未发送和未知各有独立事实，不提供模型可调用写入入口。

## 引擎配置与共享请求传输

engine.ts 定义始终存在的 Pi / Claude Code / Codex、显示名与 Agent 选型。供应商仅维护接口和模型目录；旧 definition.engine 只兼容解析，不再决定或限制运行。engineSupportsApi 是前后端共用的纯兼容规则：Pi 支持三种协议，Claude Code 支持 Anthropic Messages，Codex 支持 OpenAI Responses；不按模型名称猜测、不模拟跨协议转换，也不使用外部客户端账号。同一模型可被所有兼容引擎选中。运行显式传入的 engine 进入 ResolvedLlm.profile 与岗位快照哈希；历史缺省字段不补写。

request-budget-transport.ts 与 request-budget-usage.ts 从 pi/ 移至本目录。Pi 仍需启动握手；Claude SDK 使用随机令牌的 Anthropic 路由。Codex 在冻结模型/输出上限代理后复用同一 /request 入口。所有入口固定同一供应商与模型，实际请求均先 reserve/issue，终态用量可靠保存后才交付；不接受任意转发地址。

Claude/Codex 原生流式调用可早于响应结束；request-budget-transport 的 assertSettled 等待当前实际请求全部结算，供工具授权前调用。停止或结算失败时拒绝，不能把“终态尚未转发”当作工具尚未启动的证明。
