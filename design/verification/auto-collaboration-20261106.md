# 主会话自动协作最小闭环验证

日期：2026-11-06。对应路线图阶段五前移项；本报告仅说明此步证据，不宣布阶段五或业务验收全部完成。

## 实现范围

主聊天运行注册 `cbim_dispatch_task` 和 `cbim_dispatch_inspect`。派发工具可靠入队后返回，由调度器等主轮安全完成并释放占用，再启动成员；成员仍使用独立 Pi 会话、冻结的执行知识和独立运行审批。

成员可靠结算后，以 `member-results` 来源续接原主会话。批次/任务/消息标识随运行日志保存，Pi 使用 custom 任务数据而非用户输入，前端显示系统回传提示。可靠启动后确认结果信封；确认失败不重复运行。用户消息保留在可编辑队列，结果续跑后再按序处理。

停止立即建立续跑屏障并请求成员停止。协作结算异常保留真实租约，暂停队列并记录运行诊断；清除忙碌状态不能让旧队列抢跑。停止或重启不重放未知副作用。

## 源码与行为检查

| 检查 | 结果 |
| --- | --- |
| `pnpm typecheck` | 通过 |
| `pnpm check:architecture` | 46 个目录类图同步；275 个维护文件、902 条含类型引用依赖，0 循环 |
| 依赖与层级专用测试 | 2 文件、13 项通过 |
| `pnpm test -- --reporter=default --reporter=json --outputFile=test-results/auto-collaboration-unit.json` | 76 文件、304 项通过，106.80 秒 |
| `pnpm make` | 成功生成 Windows x64 构建 `20261106-234421` |

重点测试：

- `tests/application-collaboration-pi.test.ts`：真实 Application 和 Pi 子进程，使用本机可控模型服务验证只读、逐次批准和停止三条流程。成员读到真实文件、形成证据候选并回到原主会话；主轮 allowAll 不传给成员；用户消息及新配置排队；停止后迟到批准拒绝、文件未写入、重开不调用模型。
- `tests/member-continuation-pi.test.ts`：原生历史是 user → custom → user，源数据不伪造成新用户授权。
- `tests/execution-collaboration.test.ts`：续跑来源持久化去重、异参冲突、用户队列及停止/故障与异步工厂之间的竞态。
- `tests/auto-collaboration.test.ts`：租约释放后启动、blocked 如实回传、关闭中断推进、结算失败保留占用、停止失败可观察、结果已回注但 ack 失败不重放。
- `tests/dispatch-tools.test.ts`：真实工具 Schema、可信调用 ID、拒绝伪造身份和授权；派发回执不计作业务证据由任务进度测试覆盖。

## 构建与桌面验证

程序：`build/20261106-234421/CBIM Assistant-win32-x64/CBIM.exe`。保留同目录资源后运行。

分发包：`build/20261106-234421/make/zip/win32/x64/CBIM-Assistant-20261106-234421-win32-x64-0.1.0.zip`。

本步新增 `pnpm test:collaboration`，脚本 `scripts/collaboration-ui-smoke.mts` 已对上述构建运行通过。实际打包 Electron 与 Pi 使用隔离工作区、本机 SSE，共 3 次主模型请求和 5 次成员请求；页面错误与传输错误均为 0。

从桌面发送唯一用户消息，模型真实调用派发工具，测试没有通过 IPC 手动启动成员或回注。保持成员模型流未结束时，已看到实时成员卡片和图节点详情；结束后任务节点显示“交付待审阅”、候选“尚未验收”，主会话自动续跑。系统回传未新增用户气泡，草稿保留，结果信封已确认；刷新历史不增加模型请求。

本地证据：`test-results/collaboration-ui-smoke.json`、`test-results/auto-collaboration-unit.json`。截图：`test-results/collaboration-live-chat.png`、`collaboration-live-graph.png`、`collaboration-result-graph.png`、`collaboration-returned-chat.png`。这些运行产物保存在测试目录，不以是否纳入 Git 作为通过依据。

## 同步维护

已同步大脑来源契约、Pi 适配、调度工具、执行协调、应用生命周期、运行日志和对话投影的文件头/关键接口注释。涉及的 brain、brain/pi、tasks、scheduler-engine/execution、scheduler-engine/tools、main、main/persistence/tasks、frontend/conversation 等目录类图及上层依赖已按实际源码重新生成；CONTRACT 明确当前能力与后续契约。

路线图、开发记录及 README、成员执行、全局监管、Loop 和总体架构说明同步更新。验证脚本不调用实际供应商密钥或用户项目。

## 限制

- 可控模型验证执行链路和边界，不证明在线模型能自主正确分工或完成实际业务验收。
- 自动批次只覆盖当前进程主轮工具登记的任务。历史任务/信封/来源可恢复核实，但不自动恢复协调执行。
- 保存主轮所选 profileId/model/permission；成员启动时解析配置并冻结实际运行参数，不宣称配置编辑后仍使用旧参数，也不复制 allowAll。
- 主 Agent 统一实例及正式自执行节点、成员递归派发/消息/等待、异常通道修复/重试/改派、公平调度、预算、正式验收仍未实现。
- 没有在本步重新验证跨物理电脑、账号服务器、签名安装更新或新的在线供应商模型质量。
