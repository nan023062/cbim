# 剩余 160 项 IPC 类型化整改与复扫

> 导航维护说明（2026-11-14）：正文保留当时的路径、结论与验证边界；可点击源码链接已更新到当前归属，仅供导航，不作为历史版本证据。未留存的阶段入口另行注明，不伪造源码或制品归档。

日期：2026-11-11。依据：[架构设计规范](../project-architecture-standard.md)、[治理流程](../architecture-governance-process.md)、[P2 验证基线](architecture-p2-20261111.md)。

## 结论

剩余 **160 项**既有 IPC 已全部迁入按操作关联的请求／响应契约，加上先前 4 项角色历史，共 **164 项**。其中 `loop.start` 是已退役的拒绝入口，保留名称及明确错误，输入和响应均为 never；不代表新增了可执行能力。原通配列表已移除，渲染侧没有任意 string 或 any 响应兜底。

**41 个不同测试文件、231 项不同用例通过，1 项固定旧版 EXE 专项用例因本机缺少固定旧版 EXE，按既有条件跳过。** 类型检查、全工程依赖和架构文档检查通过。没有执行全仓产品回归、界面操作验收、打包或安装升级；没有提交、推送、合并或发布。

## S1–S3：基线、范围与影响

- 来源：用户直接授权“继续处理剩余160项IPC类型化，改完再扫描验证一遍”。实施前查询开放 Issues #36–#39，均与本轮无直接对应，未改写这些工单或另建待办。
- 基线：HEAD `a5938170cf9675b69960dde6a9bb535eb845bdd8`；此前规范、Skill、P0/P1/P2 和源码均未提交。以开始时 **1,664 个维护文件**的字节快照和 SHA256 区分本轮修改，原报告与既有成果保留。
- `change_reason.kind`：公共契约收紧、职责分组、实际消费者迁移。`scope/layers`：Bridge、Main IPC／桌面入口、Frontend 调用方，及所影响的测试、JSON 投影和资料。
- `cognition_level`：L2；公共调用签名与错误路径变化。C3 实施，C1 定向行为与静态约束验证，C2 全工程静态复扫。维护者人工接受尚未产生。
- 稳定能力：主 Frame 和安装门禁、工作区身份、权限、原命令/CAS、持久化、未知结果核实与不自动重放。未修改数据格式、业务权限或产品内置 Skill。

## S4–S6：整改项和验收

| 整改项 | 优先级／范围 | 已实施结果与验收依据 |
| --- | --- | --- |
| 操作／请求／响应对应 | 原 A07/P2，剩余 160 项 | 九组独立契约；原 149 个应用分支改为有类型的处理器，11 个原生操作逐项解析并配对成功值；集合测试核对全部 164 项实际入口 |
| 禁止宽类型逃逸 | 同上 | IpcCaller 联合元组，返回由操作推导；编译反例覆盖每组缺参、错配、未知操作、无参请求夹带字段、错误处理器响应和泛型放宽；全部响应无顶层 any/unknown |
| 输入和错误语义 | 同上 | request.ts 只转换解析阶段的领域错误码，关闭门禁先行；业务异常原样传播；真实桌面回调验证主 Frame、安装门禁、终端、选择器、固定登录页、链接和失败信封 |
| 实际调用方 | 同上 | 动态表单先通过对应 Schema；会话发送固定原 task/run，审批使用原审批 taskId；查询的缺失值／联合回执必须判断；测试不再把启动响应整包当 inspect 请求 |
| 防止类型循环 | 同上 | workspace-view.ts 只定义数据，workspace.ts 组合调用桥；逻辑边界覆盖全部 13 个 IPC 契约文件，禁止反向导入 Main／Scheduler 实现 |
| JSON 输出核实 | 同上 | 治理命令按对应 action 核实回执；附件列表／预览、会话选择器核实公开投影，损坏 JSON 明确失败；历史不可读项单独表达 |

分组数量：people 11、governance 8、dispatch 39、settings 19、loop 30、chat 7、resources 20、workspace 15、desktop 11；合计 160。原角色历史 4 项也接入统一分派。共享请求复用领域纯协议；仍保留服务本身的身份、事务、版本和权限校验。

没有为了类型化拆开共享事务或改变状态所有权。`Application.dispatch` 作为原始应用入口仍接受 unknown 参数；已知操作返回精确类型，原始动态字符串的响应为 unknown。预加载只传输，不能自选响应类型，也不重试未知结果。

## 实际验证与复扫

按实际 diff 选择：请求/处理器/桌面桥，岗位和治理、资源连接、知识来源事务及丢回复恢复，会话队列/续接/检查点、影响核实、附件、反馈连接、模型设置及三引擎切换。服务返回可缺失值后，测试增加真实存在性和种类检查，没有用 any／非空断言绕过失败。

| 批次 | 结果 | 处理 |
| --- | --- | --- |
| 首批契约和应用单元 | 34 通过、1 失败 | 旧扫描测试仍寻找原 switch，改为核对当前实际处理器与 164 项契约 |
| 边界、事务和消费者 | 102 通过、1 跳过 | 本机缺少该固定旧版 EXE，按原条件跳过专项验收 |
| 受影响集成行为 | 79 通过、2 失败 | 同一反馈测试的两个场景把启动响应的 workspaceId 带入 inspect；修改为明确的三项请求字段，并扫描修正另外两个引擎测试中的同类调用 |
| 上述修复及边界补跑 | 48 通过 | 反馈续聊、Pi/Claude/Codex 切换，及请求／桌面／依赖边界通过 |
| 模型、预算、附件和队列 | 17 通过 | 含新增损坏附件预览拒绝用例 |

按文件和用例名去重，并排除已被新入口集合断言取代的旧断言，最终 **231 通过、1 跳过、0 待修复失败**。各次失败原始输出保留在 `test-results/ipc-typing-20261111/`，不抹去首次验证结果。

- `pnpm typecheck`：通过，含编译正反例和所有已纳入 tsconfig 的消费者。
- `node scripts/source-architecture.mjs`：按本轮真实职责同步相关类图。
- `pnpm check:architecture`：**56 个目录、631 个源码／样式文件、0 文档漂移；1,234 个代码文件、6,424 条含类型依赖、0 循环、0 物理／逻辑违规**。13 个逻辑边界覆盖 37 文件；既有已审核外部动态加载 7 处保持。
- 全量源码 AST 和文件头核对：586 个脚本，无语法错误或缺失要求关键词的文件头。
- `git -c core.safecrlf=false diff --check`：通过。源码契约、实际入口、导入和类图引用同步；历史 P2 报告保留“当时剩余160项”的快照，不倒改历史为已完成。

仅以上验证范围通过；实际 Electron 窗口操作、发布制品和固定旧版 EXE 迁移不在本轮通过结论内。原生测试执行 main.ts 实际注册回调，并替换系统副作用；三引擎测试使用本机可控服务，不代表在线模型自主质量。

## S7：维护交接与退出

- Q1 稳定能力：服务的权限、事务、CAS、原回执与未知结果边界受保护；类型检查不能替代这些运行约束。
- Q2 变化位置：新增操作在对应 `ipc-*.ts` 声明请求和响应，在对应业务 handler 或桌面原生入口实现；同组变化不要求编辑巨型 switch。
- Q3 验证依据：实际入口集合、调用元组和返回类型、畸形请求前置拒绝、真实服务/事务测试、跨运行续接证据共同确定范围；不以依赖图为空推断行为未变。
- Q4 阅读入口：先读 [公开契约说明](../../src/bridge/contracts/CONTRACT.md)，再读 [总分派](../../src/bridge/server/ipc/dispatch.ts)、[受理前解析](../../src/bridge/server/ipc/request.ts)、目标业务 handler 和调用方。原生入口在 [main.ts](../../src/bridge/server/main.ts)，其门禁先于副作用。
- Q5 候选：无新增正式规则。入口集合一致、反例类型检查和受理前错误码回归已经是本轮具体实现证据，不另自动晋升为通用治理政策。

旧 `legacy-ipc-actions.ts` 已从当前源码退出；服务、页面、测试和规则不再引用。历史报告中的旧文件路径仅为当时证据。回退需要将本轮契约、处理器和调用方一起恢复到字节基线，不能使用仓库 reset 破坏此前未提交的 P0/P1/P2；没有数据迁移需要逆转。完整本轮差异在 `test-results/ipc-typing-20261111/changes.patch`，修改清单和基线分别为 `changes.json`、`baseline.json`／`baseline.zip`。

当前范围全部实施；不宣称日志内部 JSON、所有领域对象已递归消除 any，或所有 IPC 响应都新增运行时 Schema。既有领域公开类型和服务验证仍负责这些内容；本轮消除的是逐操作调用链的通配契约。人工 review、合并和发布状态独立。

## 实际定向命令

以下均带明确文件选择器，没有执行无参数全仓测试。完整输出与 JSON 见同名批次证据。

```powershell
pnpm exec vitest run tests/agent-history-ipc.test.ts tests/chat-inputs.test.ts tests/ipc-preload.test.ts tests/module-governance-application.test.ts tests/module-ownership-service.test.ts tests/queue-insert.test.ts tests/repository-connection-application.test.ts tests/retired-entry.test.ts tests/workspace-member-service.test.ts --reporter=json --outputFile=test-results/ipc-typing-20261111/contracts-first.json
```

```powershell
pnpm exec vitest run tests/agent-history-ipc.test.ts tests/conversation.test.ts tests/dependencies.test.ts tests/github-feedback-tools.test.ts tests/inline-module-ownership.test.ts tests/ipc-desktop.test.ts tests/ipc-requests.test.ts tests/knowledge-source-lifecycle-application.test.ts tests/knowledge-source-lifecycle-fault.test.ts tests/module-governance-feedback-service.test.ts tests/module-governance-service.test.ts tests/repository-connection-service.test.ts tests/resource-repository.test.ts tests/team-workflow.test.ts --reporter=json --outputFile=test-results/ipc-typing-20261111/verification-second.json
```

```powershell
pnpm exec vitest run tests/admission-settings.test.ts tests/budget-settings-view.test.ts tests/business-replan-pi.test.ts tests/chat-material-imports.test.ts tests/checkpoint-handoff-service.test.ts tests/controlled-file-service.test.ts tests/effect-observation-pi.test.ts tests/github-feedback-lifecycle-pi.test.ts tests/github-feedback-pi.test.ts tests/inspection-cycle-pi.test.ts tests/isolated-executions.test.ts tests/runtime-navigation.test.ts tests/scope-continuation-pi.test.ts tests/waiting-attachments-pi.test.ts tests/waiting-mixed-sources-pi.test.ts tests/llm-profiles.test.ts --reporter=json --outputFile=test-results/ipc-typing-20261111/verification-behavior.json
```

```powershell
pnpm exec vitest run tests/agent-history-ipc.test.ts tests/claude-application.test.ts tests/codex-application.test.ts tests/dependencies.test.ts tests/github-feedback-lifecycle-pi.test.ts tests/ipc-desktop.test.ts tests/ipc-requests.test.ts --reporter=json --outputFile=test-results/ipc-typing-20261111/verification-final.json
```

```powershell
pnpm exec vitest run tests/budget-settings.test.ts tests/chat-inputs.test.ts tests/llm.test.ts tests/queue-insert.test.ts --reporter=json --outputFile=test-results/ipc-typing-20261111/verification-settings.json
```

行为批次中的 `tests/llm-profiles.test.ts` 没有匹配文件；模型验证实际由最后一批 `tests/llm.test.ts` 完成，不把未匹配项计为通过。
