# 原有界面实施续作：架构、任务与管理

## 最新桌面验收状态（2026-11-15）

已尝试启动当前源码和生产资源的隔离 Electron 实例；加载事件与欢迎页 DOM 存在，但桌面截图空白、页面控件不可读取，前台激活返回 `foreground_unavailable`。本轮逐页交互验收未完成，不能由下文历史专项通过推定全部实施完成。见 [实际桌面结果与截图](ux-desktop-20261115.md)。

## 继续开发验证（2026-11-15）

按用户要求跳过桌面 PowerShell 对照，继续验证当前工作树。通过 gh 查询当前开放 Issues，仍只有无关 #65；按本次直接授权继续，不回填无关工单。

- `pnpm check:architecture` 通过：128 目录、756 代码/样式文件，文档无差异；1523 文件、7419 依赖、0 循环/违规。文件数与前次不同是临时编辑脚本已清理，不代表生产模块减少。
- `pnpm exec vitest run tests/resource-application.test.ts tests/office-scene.test.ts tests/inline-conversation.test.ts tests/knowledge-file-tree.test.ts tests/governance-feedback-view.test.ts tests/governance-origin-view.test.ts tests/module-governance-review.test.ts`：7 文件 32 用例通过。选择依据是前序资源模态、办公室状态、对话呈现、知识树和治理改动曾受执行权限阻断；不重复已通过的无变化套件。含既有治理服务验证，不能统称全部是纯 View 单元。结合前节共 20 文件 130 个唯一专项用例通过，仍非全仓回归。
- 真实 SettingsView 组件 + 内存 IPC：10 项行为断言通过。初始无脏稿、编辑模型标记、分组保留输入、取消模型不清除并发草稿、全部还原清除标记；网页保存失败保留选择/不自动重读/提示保留输入，取消重新读取不请求，确认重新读取恢复原配置并清除该表单标记。
- 真实 App 外壳 + 内存 IPC：6 项行为断言通过。拒绝项目导航保留模型输入且只确认一次；有草稿时 beforeunload 事件被阻止；取消工作区设置导航不打开覆盖层；确认离开后切到原项目；卸载清除 beforeunload 标记。beforeunload 使用可取消合成事件，验证处理器，不代表原生系统关闭弹窗验收。
- 浏览器操作仅在隔离夹具 origin 中进行，没有连接真实模型、账号或项目。App 测试替身声明项目路径失效，不启动工作区或真实任务。测试数据与脚本位于忽略的 `test-results/ux-implementation/`，不是生产功能或正式测试套件。
- `pnpm exec vite build --config vite.renderer.config.ts --outDir test-results/ux-renderer-build` 通过，876 模块；JS 1571.82 kB（gzip 462.51 kB）、CSS 148.01 kB。存在 >500 kB chunk 提示，未通过提高阈值隐藏，不在本次验证中顺带改造加载边界。
- 本次没有新的产品代码变更，不重复类型检查或已通过的测试归属检查。前端构建不等于 Electron 打包、安装或完整桌面验收；岗位/责任真实事务、全页面端到端、读屏与系统关闭仍保留原验证缺口。

## 执行权限恢复后的补验（2026-11-15）

- 当前权限变为 unrestricted 后，同一命令通道 Node spawnSync 启动 node.exe、esbuild.exe 均退出 0，分别返回 v24.13.0、0.25.12；没有重装依赖或修改安全软件。与此前相同探针的 EPERM 对比，支持执行沙箱限制是原因，但未证明具体底层实现。
- 桌面 PowerShell 输入仍返回 foreground_unavailable，未发送命令；不能声称已完成普通终端与沙箱的独立对照。
- 原 9 份专项加 budget-settings-view/chat-chrome 共 11 文件首次执行：90 通过、1 失败。核对后确认 chat-chrome 仍断言被统一图标替换的 work-spinner；保留等待授权/失败/停止语义检查，改为检查实际 work-live-dot 与 role=status。
- 精确补跑 chat-chrome、diagnostics-view、software-updates-view：3 文件 10 用例通过。合并未变化的已通过结果，本次 13 文件共 98 个唯一用例最终通过。没有重跑无影响套件。
- pnpm check:test-modules 通过：500 文件，unit=149、contract=155、integration=196。git diff --check 通过。
- 上述是专项单元及归属验证，不是全量回归或逐页桌面验收。前文阻断记录保留为当时事实。

日期：2026-11-15。用户直接授权“实施完成所有界面”。本记录描述实际增量，不将原型或隔离夹具当作生产验收。前序改动见 [管理与工具实施](ux-implementation-20261115.md) 和 [公共界面实施](ux-interface-20261115.md)。

## 实际实现

| 操作面 | 本次行为 |
| --- | --- |
| 团队架构 | 创建/导入显式入口；职责边界、可用方法、工作原则分区；键盘切换；保存 Skill 后定位方法面板 |
| 业务架构 | 创建/模板/责任记录显式入口；模块责任、知识正文、目录与流程分区；切换保持知识编辑组件挂载 |
| 项目岗位 | 当前页名称/职责搜索、状态筛选及清除；切换岗位、取消、返回保护未保存输入；明确输入→预览→保存 |
| 模块责任 | 准备、预览、确认的操作层级；切换模块和返回保护草稿；受理后清除标记；不转移旧任务 |
| 任务图 | 办公室、任务图、任务列表三种查看方式；列表保留真实派发/依赖关系、状态及历史过滤；定位尊重减少动效 |
| 任务话题 | 已读取标题、参与成员和排队正文搜索；显示当前/历史/排队数量；保留无结果和清除入口 |
| 人工决定 | 核实成果→选择意见→记录决定分区；意见按钮统一图标；原提交/查询和未知结果持续可见 |
| 异常恢复 | 分开填写观察和新核实目标；主要提交操作统一；原请求查询和已受理事实不变 |
| 运行管理 | 目标与任务、成员实例、运行与用量、项目与队列分类；共享筛选可清除；全局指标不受列表筛选影响 |
| 模型配置 | 取消前核对配置草稿、临时凭据和未添加型号；确认放弃后清空密钥；保存操作区粘性显示 |
| 公共组件 | ViewTabs 统一 tab/panel 标识、选中状态、方向键及 Home/End；业务页面持有选择与草稿 |

所有变化属于 View。没有新增模型调用、权限、邀请、跨人交接或后端写入入口。岗位和责任仍使用原预览、版本核验、命令记录及回执。原有 34 个操作面有累计视觉改动与设计归属，但不能把这个覆盖数称为全部设计交互完成或逐页桌面验收通过。

## 原有操作面的代码归属

| 设计面 | 实际入口 |
| --- | --- |
| 项目与导航 | shell/App、WorkspaceList、ExtensionArea |
| 主对话、话题、成员对话 | conversation/Conversation、ConversationTopics、MemberConversation |
| 办公室、任务图、任务详情 | tasks/OfficeScene、DispatchGraph、SessionTaskView、MemberTaskDetail |
| 人工决定、恢复 | tasks/HumanDecisionPanel、ExecutionRecoveryForm、各继续/重新规划表单 |
| 文件预览、证据 | knowledge/KnowledgeFilePreview、tasks 的报告/清单/验证/受控文件面板 |
| 运行管理 | runtime/RuntimeOverview |
| 自动化列表、编辑、历史 | automation/AutomationView、AutomationEditor |
| 知识、编辑、业务架构、责任、治理 | knowledge、workspace、governance 原业务组件 |
| 团队、岗位、履历 | team/TeamView、WorkspaceMembers、WorkspaceMemberForm、AgentSessionHistory |
| 资源、连接、应用 | resources/ResourceRepositoryView、RepositoryConnections、WorkspaceResourceTransfer |
| 设置、模型、额度、网页与反馈连接 | settings/SettingsView 及分组表单 |
| 诊断、终端、浏览器、更新 | diagnostics/WorkspaceDiagnostics、shell/ExtensionArea、updates/SoftwareUpdates |

以上为代码定位表，不是另建实时任务清单。真实人员协作、集中待办、全局搜索等 7 项扩展/聚合提案仍不是已有产品功能。跨全局导航的所有表单草稿保护、全部异常状态的真实服务联调也不能由本次局部表单保护推定完成。

## 维护与验证

- 同步 components、team、workspace、runtime、tasks、settings、conversation 的文件头、CONTRACT 与 ARCHITECTURE；新增 ViewTabs，保持依赖单向。
- `pnpm typecheck`：最终产品变更通过。
- `node scripts/source-architecture.mjs`：128 目录、756 代码/样式文件，更新 7 份架构文档。
- `pnpm check:architecture`：0 文档差异；1530 文件、7419 条依赖，0 循环、0 违规。
- 新增 `tests/task-graph-layout.test.ts` 用例，验证列表原关系、历史过滤、不改写原快照；沿用该文件已有唯一模块登记。
- 第一组专项：`pnpm exec vitest run tests/task-graph-layout.test.ts tests/session-task-view.test.ts tests/runtime-view.test.ts tests/workspace-member-view.test.ts tests/module-ownership-view.test.ts`。按任务呈现、运行分类和岗位/责任变化选择。
- 第二组专项：`pnpm exec vitest run tests/conversation-topics.test.ts tests/human-decision-view.test.ts tests/execution-recovery-view.test.ts tests/team-model.test.ts`。按随后加入的话题搜索、决定/恢复层级和团队分区选择。
- 两组均在 esbuild 启动阶段失败 `spawn EPERM`，用例执行数为零。不能写作单元通过。
- 浏览器加载真实 TeamView / BusinessArchitecture，使用隔离内存数据。核对 Agent 选择、详情 tab/panel 配对、ArrowRight 焦点和可见面板切换；查看业务架构截图。没有实际修改项目。
- 320/390px × 浅/深主题 × 团队/业务架构 × 三个详情分区，共 24 组实际 iframe 视口检查，全部面板可见、无根横向溢出。不是 24 张人工截图或桌面应用验收。
- 测试夹具在本机 `test-results/ux-implementation/`；无子进程转译器仅供检查，不修改产品构建或替代标准测试。
- `git diff --check` 指出 governance/updates CONTRACT 的末尾多余空行，已清理。随后本机命令执行被拒绝，提示需在运行电脑确认且未确认，未能补跑最终 diff 检查。临时修改脚本已通过文件编辑工具删除。

## 当前交付边界

本次已写入上述产品代码；未提交、合并、构建安装或发布。完整 App、真实事务、每页桌面键盘/读屏、200% 缩放及全状态联调仍未验收。执行权限恢复后需补跑上述受影响单元和最终 diff 检查，再进行用户指定的逐页桌面验收。此前测试提权曾被自动审批以无法准备动作拒绝，当前又出现本机确认门禁；不修改权限配置绕过。
