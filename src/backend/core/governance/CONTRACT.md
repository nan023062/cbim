### 模块正式知识治理的纯领域边界

本目录保存工作区级 Module 知识治理的严格协议和纯保护规则，不持有存储、网络、模型、运行租约或 Electron 身份。其依赖只指向 Core 基础能力；知识存储通过结构兼容的文件/请求快照调用规则，避免知识端口与治理实现互相引用。静态保护和治理历史属于工作区，不创建主会话、执行成员或派发节点。

`module-governance.ts` 区分登记、观察、不可变提案、版本化决定和独立实施。请求固定 workspaceId、instanceId 与 commandId，不接受任意知识路径、actor、permit 或批准证明。现行 `design/business/module.schema.json` 将 overview 固定为 `module.md`；规则仍解析实际 `module.json` 并核对 id/overview，不仅凭路径存在猜测 Module。正文使用跨前后端的 UTF-8 字节长度检查，沿用单文件 2 MiB 上限。

保护记录绑定真实 definition 与 overview 的路径/哈希。用户逐个明确登记，不自动冻结全部项目。初始登记历史不改写；保护 revision 和当前 overview 哈希只能由已经核实治理关联的 committed 知识 journal 派生。首片没有修改 definition、移动、删除、解除保护或切换正文绑定的入口。

观察保存当时知识/保护版本、真实文件指纹、overview 原文和确定性知识校验；statement 是操作者解释，不作为程序验收。提案仅接收 newOverviewText，before/after 正文保存一次并派生差异；理由、替代方案、不变量和回退说明进入固定 basis。修改方案必须建立新提案；时钟不参与 basis，方案正文或理由变化会改变依据。目录只返回观察/提案摘要，明确 observationId/proposalId 后才展开对应正文，避免一次读出全部历史正文。

### 决定、实施与原请求核实

`approve/reject/defer` 按同一提案的独立 revision 连续追加，后续决定引用前一条；旧意见保留，不因批准而自动实施。驳回/暂缓须说明原因，暂缓另记录复查条件。可信 IPC 注入 `local_desktop/explicit_submit`，表示本机明确提交，不证明已认证账户或正式维护人身份。每个提案最多 128 条决定；持久账本另负责工作区总量和跨操作命令唯一性。

`ModuleGovernanceApplyIntent` 冻结原 ChangeRequest、指纹、提案、决定和保护身份，requestId 与 intentId 相同。意图不是提交成功。公开 application 区分 pending、not_applied、rolled_back、recovery_required、committed；只有 committed 带真实知识回执。not_applied 只能由原实例退役且同串行边界确认原 journal 完全不存在派生，不能把正在处理或单次查询无结果叫作未实施。跨重开查询保留原身份，不自动换实例重发。

`unaccepted` 仅表达可信服务已核实原实例退役且没有原命令、意图或 journal；缺少普通回执不构成该证明。普通查询和 Schema 校验均不启动执行、不修复知识、不补造 journal，也不签发继续业务工作的许可。

### 共用提交门禁

`moduleGovernanceBinding` 从真实文件快照和完整校验派生的可见模块 ID 核对路径、哈希与绑定。`validateModuleGovernanceProposal` 把提案严格绑定同一观察及保护版本，防止用新版本搭配旧正文；`validateModuleGovernanceDecisionAppend` 核实单提案历史连续性和唯一决定身份。

`validateModuleGovernanceWrite` 必须在原知识提交串行边界消费真实 current/projected 快照、原请求与完整 projected 可见模块集合。普通知识写没有 authorized；正文、定义变化或删除、移动、更换绑定均不能绕过保护，`.cbimignore` 也不能保持文件不变却把受保护模块从派生索引隐藏。已发生的外部改动保持 GOVERNANCE_DRIFT，不由一次普通提交或文字批准追认；未登记对象及正常无关修改保持原知识流程。

专属 authorized 只由持锁的可信存储加载真实私有意图、提案和最新决定。规则再次核对工作区、知识/保护版本、批准依据、完整原请求指纹及唯一 overview 差异；其他正文不可夹带，仅允许既有知识服务生成两个派生注册索引。批准一个 Module 不授权另一个 Module。`advanceModuleGovernanceProtection` 仅在调用方已经核实 journal 的治理关联后推导下一正文基线，普通知识回执或 pending 意图不能单独作为来源。

规则不会替代完整知识结构校验、原事务回滚/恢复或真实 journal 核实。Schema 合格、结构合格、批准、已提交和业务验收是不同事实；业务迁移、专业语义验证和账户认证不在本目录承诺范围内。

### 主 Agent 的观察和提案协议

`module-governance-tools.ts` 仅声明 `cbim_governance_get/read`、`cbim_governance_receipt/read`、`cbim_governance_observe/maintenance`、`cbim_governance_propose/preview`。端口由实际主运行闭包装配；模型请求不含工作区身份、根会话、主实例、run、actor、commandId、路径或权限。四工具均为非原生的 `knowledge` scope；保存私有观察/提案不能标为 `knowledge-write`，也不等于正式知识已经变更。没有登记保护、批准、驳回、暂缓或实施模型入口。

观察及提案的可选 `origin` 区分本机明确提交与真实主运行。旧记录缺省表示未登记来源，不补造本机或账户身份。主来源冻结 rootSessionId、agentInstanceId、agentSessionId、runId、toolCallId 和确切工具名；工作区从外层记录取得。`moduleGovernanceMainCommandId` 以固定命名空间和 workspace/root/run/toolCall/toolName 生成稳定名称型 UUID，不混入重开后的工作区实例。持久命令仍须核实完整原输入和来源指纹，相同调用身份变化不能靠新 UUID 绕过冲突。提案 basis 包含来源；本机提案可依据可信主观察建立，不要求两者同种来源。模型提案则通过 `validateModuleGovernanceMainObservation` 限定到自己主实例及逻辑通道已登记的观察，允许同通道不同运行。

模型原/新 overview 各限 16 KiB UTF-8，理由/观察/回退说明各限 1024 字符，替代方案和不变量各最多 8 条、每条 512 字符。完整正文输出携带 `state:complete`、真实字节数和完整 hash；超限正文只有 `state:oversized` 元数据，不含 text。即使字节数符合上限，JSON 转义超过 32 KiB 的单正文也明确交回桌面处理。目录最多 20 项并声明真实 total/truncated；合法长来源组合可能进一步缩短目录，但不会裁剪选定正文的一部分。既有桌面 2 MiB 能力不变。

纯投影校验原正文 hash，不执行领域调用。模型读目录或指定记录返回有界 DTO；写回执和原命令查询只返回 compact 身份、版本、来源及 hash，不复制大正文或私有实施请求。最终工具包装必须对已生成的唯一 JSON 文本再次核对 128 KiB 字节上限，输出校验失败不表示已有记录回滚。原回执可按 commandId 或原 action/toolCallId/runId 查询，省略 runId 只使用本轮真实运行；没有记录返回 unknown，不授权重建、换 ID 重试或自动实施。
