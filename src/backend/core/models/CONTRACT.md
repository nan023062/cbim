# llm 维护契约

## 逐请求预算（R06）

`RequestBudgetPort` 仅由可信工厂提供，模型只能生成原协议正文。ticket 的 reserve / issue 分别可靠保存申请与发送意图；实际发送前同步 assertSend，报告、明确未发送和未知各有独立事实，不提供模型可调用写入入口。

## 引擎配置与共享请求传输

engine.ts 定义始终存在的 Pi / Claude Code / Codex、显示名与 Agent 选型。engineSupportsApi 仅判断原生引擎支持的协议：Pi 支持三种协议，Claude Code 支持 Anthropic Messages，Codex 支持 OpenAI Responses。旧 definition.engine 只兼容解析，不再决定或限制运行。

provider-connections.ts 的 connectionForEngine 是界面、岗位和运行共用的供应商接口解析：主接口兼容时保持原地址；否则先选择显式 alternateConnections，再根据精确官方 HTTPS 地址选择 provider-presets.ts 中的预设。autoDetect 缺省开启但不回写旧文件；false 关闭自动补充。显式接口的 modelIds 缺省共用目录，指定时只允许列出的原始型号，不绕过限制回退预设。每种协议只能配置一个地址。预设单独保存供应商地址、型号限制与官方来源，新增供应商只改这份数据及对应验证，不改引擎实现；域名、地区、端口和套餐路径不模糊匹配。

同一供应商只保存一份加密凭据；不进行协议翻译、模型 ID 替换或运行失败后自动切换。公开目录读取和界面筛选不联网，配置兼容不表示凭据、额度、工具或流式已经验证。运行快照只冻结选中的 api/baseUrl，候选接口、预设来源和 autoDetect 不进入 ResolvedLlm.profile 或岗位哈希；历史缺省 engine 及原 Pi 配置字节保持不变。新岗位采纳与运行使用相同投影，后续配置修改不热替换已捕获快照。

request-budget-transport.ts 与 request-budget-usage.ts 从 pi/ 移至本目录。Pi 仍需启动握手；Claude SDK 使用随机令牌的 Anthropic 路由。Codex 在冻结模型/输出上限代理后复用同一 /request 入口。所有入口固定同一供应商与模型，实际请求均先 reserve/issue，终态用量可靠保存后才交付；不接受任意转发地址。

Claude/Codex 原生流式调用可早于响应结束；request-budget-transport 的 assertSettled 等待当前实际请求全部结算，供工具授权前调用。停止或结算失败时拒绝，不能把“终态尚未转发”当作工具尚未启动的证明。
