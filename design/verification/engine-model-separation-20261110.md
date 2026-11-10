# 引擎、模型与 Agent 配置归属修复

- 来源：用户直接反馈，未关联新 GitHub Issue。0.1.5 菜单只显示 Pi；进一步明确三个执行引擎内置、供应商统一模型目录；对话栏设置主 Agent，与 Agent 界面等效。
- 基线：origin/master d8fd91f47e14a9694e398b43606e13afbc1e875f。独立修复工作树；不纳入本机 develop 的 a5938170 文档/资源整理，原工作不移动或重置。

## 维护者需要更新的认知

1. 供应商没有执行引擎归属。engineSupportsApi 在 Core 提供真实协议兼容规则，Bridge 导出给三个菜单与表单，Main 解析模型时再次校验。旧供应商 engine 仅兼容读取，新设置表单不再生成。
2. 主 Agent 配置归工作区 cbim:main。MainAgentSettings 保存同一个版本化选型，对话栏和 MainAgentEditor 共用 useMainAgentSettings；本机会话偏好仅保留权限/协作模式。内置主 Agent 不对应可编辑知识文件，自定义 Agent 继续在原知识事务中保存同一 AgentModelSelection 契约。保存本身不启动模型。
3. 岗位引用独立携带 engine。旧字段缺省时从已采纳 snapshot.engine 读取，未声明 Pi 不补字段，不改变历史哈希。配置当前差异、采纳、派发和领取沿同一独立选型；同一模型多引擎按完整配置指纹匹配。
4. 稳定机制保持：模型加密、设置短锁、知识事务、岗位审计、工具授权、请求预算和原生恢复均复用原服务；新增引擎协议规则应在 llm/engine.ts 维护，不能回到供应商表单加引擎分类。

入口：[模型纯规则](../../src/backend/core/brain/llm/engine.ts)、[设置存储契约](../../src/backend/main/persistence/settings/CONTRACT.md)、[主 Agent UI 契约](../../src/frontend/team/CONTRACT.md)、[运行装配契约](../../src/backend/scheduler-engine/execution/CONTRACT.md)。本次精读相关选型、持久化、岗位与运行链，不宣称全仓逐行审计。

## 开发验证

- 12 个受影响测试文件 92 项通过：engine-configuration、main-agent-settings、llm、workspace-member-core/service/application/view、owner-execution-core/service/application、inline-module-ownership、chat-chrome。
- 新增岗位回归 2 项通过：同一模型只切引擎；0.1.5 只有 snapshot.engine 的旧记录移除供应商 engine 后保持原字节与配置差异。旧版构造最初只模拟一次解析，导致预览与提交不一致而失败；修正为完整旧版构造阶段后恢复真实解析，复测通过，未放宽产品校验。
- 新增岗位核验 1 项通过：两个岗位同供应商同模型不同引擎，以完整配置指纹匹配各自快照。
- claude-application 与 codex-application 的 4 项真实原生进程用例通过：同一 Anthropic 配置 Pi↔Claude，三引擎往返公开上下文/原生文件/预算结算及 Claude/Codex 岗位真实执行。累计 99 项不同用例通过，使用本机确定性响应，不证明在线供应商质量。
- pnpm typecheck、pnpm check:architecture 通过：55 目录、604 代码/样式文件；1192 个维护文件、6132 条含类型依赖、0 循环。源码注释、受影响 CONTRACT 和 16 份架构文档同步。
- pnpm exec tsx scripts/agent-settings-ui-smoke.mts 通过 9 项真实 Edge + React + Application 路由交互：旧配置三引擎、无兼容模型禁发、同模型复用、多主对话共享、两入口双向同步、草稿保留、供应商无引擎选项、重载保留、空目录仍可选择引擎。页面错误 0，模型调用 0。证据 test-results/agent-settings-ui-1794297222441/report.json。
- 日常未全仓测试；完整四片 CI、同一发行 EXE、安装/升级及官网收尾另见本次发布记录。测试通过不代表人工代码 review 已完成。


实际开发命令（只选受影响单元）：

- pnpm exec vitest run tests/engine-configuration.test.ts tests/main-agent-settings.test.ts tests/llm.test.ts tests/workspace-member-core.test.ts tests/workspace-member-service.test.ts tests/workspace-member-application.test.ts tests/workspace-member-view.test.ts tests/owner-execution-core.test.ts tests/owner-execution-service.test.ts tests/owner-execution-application.test.ts tests/inline-module-ownership.test.ts tests/chat-chrome.test.ts
- pnpm exec vitest run tests/workspace-member-service.test.ts -t '同一供应商|0.1.5'（随后仅重测修正的 0.1.5 构造用例）
- pnpm exec vitest run tests/owner-execution-service.test.ts -t '共用供应商'
- pnpm exec vitest run tests/claude-application.test.ts tests/codex-application.test.ts
- pnpm exec vitest run tests/desktop-acceptance-inputs.test.mjs：新增 0.1.5 真实旧版路径后 23 项通过。
- pnpm exec tsx scripts/agent-settings-ui-smoke.mts：9 场景通过，页面错误 0。
- pnpm typecheck；pnpm check:architecture；pnpm check:brand；pnpm build:website 通过。此处是开发冻结前的验证，官网当时显示已公开的 0.1.5；后续 0.1.6 制品、安装升级、官网与合并结果见[发布验收](desktop-release-0.1.6-20261110.md)。
