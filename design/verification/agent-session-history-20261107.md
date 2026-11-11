# 静态 Agent 的 Session 履历验证

日期：2026-11-07。构建：`20261107-015449`（Windows x64）。本步实现静态角色的长期执行履历和团队节点入口，不等同于主动成员聊天或异常任务恢复。

## 交付结果

- 团队架构选择主 Agent、默认执行 Agent 或自定义 Agent，点击“执行历史”，按 Session、运行轮次查看。删除定义后从“历史角色”继续查询。
- 归档使用真实 `workspaceId/agentId/agentSessionId/taskId/runId`，保留执行实例、所属主会话和历史配置版本；不合并模型上下文，不用当前角色配置覆盖旧记录。
- 执行实例释放、角色删除、重开工作区及应用重启均保留履历。已落盘的派发启动意图即使未创建运行日志也有状态记录。
- 本机 `agent-history/` 保存派生索引，正文保留既有主/成员日志。已有扫描回补索引，列表不回读正文；详情按需加载、增量刷新，界面没有周期全量轮询。
- 公开事件统一过滤原生路径、冻结提示、工具参数/返回正文和私有推理。主用户输入、系统回注和正式成员任务输入分别显示；候选仍标为尚未验收。

操作与四个只读 IPC 见履历说明（历史文档：`docs/agent-session-history.md`，已清理）。

## 自动验证

| 检查 | 实际结果 |
| --- | --- |
| `pnpm typecheck` | 通过 |
| `pnpm check:architecture` | 类图同步；298 个维护文件、1033 条含类型依赖，0 循环 |
| 依赖与层级定向测试 | 2 文件、13 项通过 |
| 全量 `pnpm test` | 86 文件、362 项通过 |
| `pnpm make` | EXE 目录和 ZIP 生成成功 |
| `pnpm test:agent-history` | 自定义执行 Agent 的完整桌面历史流程通过 |
| `pnpm exec tsx scripts/collaboration-ui-smoke.mts --default-executor --history` | 内置默认执行 Agent 的完整桌面历史流程通过 |

重点用例来自 `agent-history-store.test.ts`、`agent-history.test.ts`、`agent-history-view.test.ts`、`public-run-events.test.ts`，并回归实时成员事件和团队模型。覆盖相同角色的多主会话与不同实例、释放与删除后保留、全应用重开、旧日志不改写、启动前失败、损坏/写失败可见、身份与游标隔离、同时间 ID 分页、重复事件冲突、LRU 加载竞态及只读不触发模型/审批/确认。

全量首次发现旧监管测试硬编码第一条告警；新功能增加 `agent-history` 诊断后，改为同时核验该诊断与精确原来源 `run:bad-task/bad-run`，保留统计不完整断言。修正后全量通过，没有通过关闭诊断规避测试。

## 打包程序验证

两种执行者场景均使用实际 Electron、Application、持久化存储、Pi 子进程和真实文件读取。模型响应由隔离的本机 SSE 服务提供，未使用用户密钥或真实项目。

验证顺序：主会话派发 → 成员实时执行与候选回传 → 周期释放成员实例 → 团队节点进入历史 → 检查主输入/系统回注/成员公开记录 → 自定义角色删除后从历史角色查看 → 完整关闭并重启应用 → 再次读取归档。

每个场景始终保持主请求 3 次、成员请求 5 次；进入历史、删除角色后查询、重启后查看均未产生新增模型调用。知识版本在只读浏览前后不变，历史页面没有执行、审批或停止操作。两个场景的 `pageErrors` 和 `transportErrors` 均为空。

原始结果保存在本机 `test-results/`：

- `agent-session-history-unit.json`
- `collaboration-history-ui-smoke.json`
- `main-instance-history-ui-smoke.json`
- 两组 `*-main-history.png`、`*-member-history.png`、`*-restored-history.png`；自定义场景另有 `collaboration-history-deleted-role-history.png`。

## 构建位置

- 程序：`build/20261107-015449/CBIM Assistant-win32-x64/CBIM.exe`，保留同目录资源。
- 分发包：`build/20261107-015449/make/zip/win32/x64/CBIM-Assistant-20261107-015449-win32-x64-0.1.0.zip`。
- 最新构建指针：`build/latest-build.json`。

本次没有另做仓库外便携启动或跨物理电脑验证。

## 同步维护与限制

同步 `core/team`、`scheduler-engine/runtime`、`scheduler-engine/execution`、`main`、`main/persistence/tasks`、`main/ipc`、`bridge/contracts`、`frontend/team` 的注释、关键接口及相应父层/目录类图；保持后端 Core、调度、main 和前端/Bridge 的单向依赖边界。概念说明、README、roadmap 和开发记录已同步。

没有静态 Agent 身份的旧日志保留原文件并提示诊断，不猜测归属；明确角色但没有动态绑定时使用标记为 legacy 的检索分组。角色删除后原路径重新创建暂不产生单独代际 ID，旧名称与配置版本仍保持。尚无历史删除/保留期限、主动成员聊天、异常任务恢复或跨设备历史同步。公开模型/用户文本不做自动秘密检测；界面中的工具摘要不是完整原始输出。测试不证明在线模型自主分工质量或业务正式验收。
