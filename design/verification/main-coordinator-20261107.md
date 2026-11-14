# 主实例、知识管理与调度周期验证

> 历史快照：正文中的目录、完成状态与验证数字保留记录日期的事实，不是当前实现清单。四层迁移后的现状请看 [源码契约](../../src/CONTRACT.md) 和 [Logic 边界](../../src/logic/BOUNDARIES.md)。

日期：2026-11-07。对应路线图阶段五前移项，复用阶段一知识授权与回执；本报告不表示全部调度能力或业务验收已完成。

## 本步实现

- 主 Agent 是具备工程、架构和结构化思维的团队与技术管理者。运行指引要求核实现状、目标与约束，维护模块职责和责任，组织执行者、模块、目标与证据要求，审阅候选并安排后续任务；重大人工决定不能由模型虚构。
- 主 Agent 通过受控内部服务直接管理 `.cbim/`。read 只查/预览，ask 写入等待审批，execute 仍检查权限、版本、Schema 与事务。主 Agent 不获得业务 write/edit/bash，角色门禁同时拒绝未列出的业务写入或命令调用。知识管理不要求先委派业务执行者。
- 每个主 session 与图根共用持久主实例；不同主 session 独立。对话通道和结果收件通道分别保存，原生 Pi 续接核验已记录身份与受管文件，拒绝串接其他会话或缺失原生身份的历史。
- `DispatchScope` 覆盖一个用户任务，跨主模型调用、执行成员和结果回注。每次派发在周期内创建独立执行实例；周期结算后释放执行者，保留主实例、任务图、结果、证据和用量。停止与启动失败等待在途工作结算，不将模型回合结束误当成周期关闭。
- 没有合适自定义角色时，主 Agent 可使用应用内置静态角色 `cbim:executor`，继承 Team 根 Skill 并采用目标模块自己的 Workflow。默认角色不写入项目定义，真实模块和维护关系仍须有效。只有主 Agent 注册派发工具。
- 已关闭周期与释放实例拒绝迟到回调复活；重启把未关闭周期结算为 interrupted，不重放任务。全局监管保留历史消费，释放实例不再计入当前活动压力。

## 检查结果

| 检查 | 结果 |
| --- | --- |
| `pnpm typecheck` | 通过 |
| `pnpm check:architecture` | 46 个目录类图同步；285 个维护文件、968 条含类型依赖，0 循环 |
| `pnpm exec vitest run tests/dependencies.test.ts tests/layer-boundaries.test.ts` | 2 文件、13 项通过 |
| `pnpm test -- --reporter=default --reporter=json --outputFile=test-results/main-coordinator-unit.json` | 82 文件、345 项通过，124.87 秒 |
| `pnpm make` | Windows x64 构建 `20261107-012333` 成功 |
| `pnpm test:main-instance` | 默认执行者打包桌面链路通过 |
| `pnpm test:collaboration` | 自定义成员打包桌面链路通过 |

主要行为证据：

- `tests/unified-tool-policy.test.ts`：真实 Pi 分别验证主 Agent 的 read/ask/execute；read 文件不变，ask 批准前版本不变、批准后真实提交，execute 真实提交；保存知识写入回执，主工具清单没有业务写入与命令，知识治理不伪造业务任务节点。执行成员继续有独立授权验证。
- `tests/main-session-instance-pi.test.ts`：两个主会话身份隔离、续聊及重开复用；默认执行者独立实例、证据回注、用量去重；跨会话原生文件和缺少原生身份的恢复在请求模型前拒绝。
- `tests/dispatch-scope.test.ts`：周期互斥与幂等、逐任务实例、原子关闭、拒绝半次释放/复活/历史重写、重启中断结算。
- `tests/auto-collaboration.test.ts`、`tests/execution-collaboration.test.ts`：周期未可靠关闭时队列不抢跑；停止、异步启动和结果回注的竞争；回注已可靠登记但收件确认失败时不重复运行。
- `tests/application-collaboration-pi.test.ts`：真实工具派发、独立成员审批、用户队列、停止后迟到批准拒绝、重开无模型重放。
- `tests/conversation-identity.test.ts`、`tests/default-executor.test.ts`：主绑定不被知识结构错误阻断，但正式派发不放宽校验；默认角色从真实知识装配，不伪造项目文件。

## 构建与桌面证据

程序：`build/20261107-012333/CBIM Assistant-win32-x64/CBIM.exe`，运行时保留同目录资源。

分发包：`build/20261107-012333/make/zip/win32/x64/CBIM-Assistant-20261107-012333-win32-x64-0.1.0.zip`。

两个场景均运行实际打包 Electron 和 Pi，使用隔离工作区、本机可控 SSE，不使用真实用户项目或供应商密钥。各场景为 3 次主模型请求、5 次成员请求，页面错误与传输错误均为 0。

桌面发送用户消息后由模型实际调用派发工具，测试未通过 IPC 手动启动成员或回注。默认执行者场景删除所有自定义 Agent 后验证可派发。两条流程均核对：

1. 主实例与图根一致，执行实例与主实例不同；主工具保留知识治理，执行成员没有派发工具。
2. 成员未结束时显示署名流式卡片、任务节点和实时详情；读取到隔离工作区中的真实文件，并形成工具回执和交付候选。
3. 候选回到原主会话，系统数据没有冒充用户气泡，草稿保留，结果信封可靠确认。
4. 周期关闭后执行实例 released，主实例保留，刷新不增加模型请求，结果仍为尚未业务验收。

本地报告：`test-results/main-coordinator-unit.json`、`test-results/main-instance-ui-smoke.json`、`test-results/collaboration-ui-smoke.json`。截图分别以 `main-instance-`、`collaboration-` 为前缀，包含 `live-chat.png`、`live-graph.png`、`result-graph.png`、`returned-chat.png`；已查看默认执行者实时任务图。测试产物是否纳入 Git 不改变通过事实。

## 注释、架构和进度同步

源码文件头及重要接口同步覆盖 brain 身份/Pi 恢复、tasks 周期不变量、team 执行实例生命周期、scheduler-engine 指引/默认角色/授权/协调、main 装配/日志/监管、bridge 公开类型及 frontend 任务详情。对应目录 `ARCHITECTURE.md` 与 `CONTRACT.md` 按实际源码同步，保持 `main → scheduler-engine → core`、前端经 bridge 的单向边界。

README、产品定位、成员执行、整体架构、Loop、全局监管、派发契约、实际装配的业务运行正文及 Skill 同步主调度与知识治理职责。路线图与开发记录按本报告更新；历史报告保留当时事实，不作为当前能力说明。未提交或推送本步改动。

## 保留限制

- 可控模型验证真实运行链路和权限，不证明在线 LLM 的自主分工、架构判断或真实业务交付质量。
- 自动协调只推进当前进程登记的用户任务周期；历史核实后的显式恢复、重试/改派、执行者求助/等待尚未接通。执行者递归派发不属于当前角色设计。
- 兼容既有不带 scope 的可信显式 IPC；该旧路径仍可复用成员实例，新自动协作路径使用周期内逐任务实例。
- 默认执行角色不代替真实 Module 和已确认维护关系。主 Agent 可以在授权范围内维护知识，不能虚构真人确认。
- 当前每周期最多 500 个任务，每主模型轮最多 100 次派发；这是原子结算与输入边界，不是公平调度或费用预算。
- 已有路径检查和权限门禁不是操作系统沙箱；冻结模块范围与指引不等同于完整文件系统隔离。
- 候选依然尚未验收；人工接受/拒绝/补证与产物指纹尚待实现。全局公平调度、token/费用配额也未实现。
- 本步未重新验证静态资源桌面流程、仓库外便携、跨物理电脑、账号服务器、签名与安装更新。
