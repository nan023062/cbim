# P2 架构整改与复扫记录

日期：2026-11-11。依据：[架构设计规范](../project-architecture-standard.md)、[治理流程](../architecture-governance-process.md)、[原扫描报告](architecture-audit-20261111.md)。

## 1. 结论、基线与范围（S1–S3）

原报告三项 P2（A07–A09）按各自“最小整改”及验收范围完成。**28 个测试文件、159 项不同用例通过**，类型检查和全工程架构复扫通过。A07 完成角色历史四项操作试点，另有 160 项旧操作仍待按业务组迁移；本轮不宣称整个 IPC 已完成类型化，也不宣称全工程已不存在其他架构问题。

- `source`：用户直接要求“继续处理 P2 问题，改完再扫描验证一遍”。实施前查询 `nan023062/cbim` 开放 Issues，得到 #36、#37、#38，分别涉及主 Agent 治理工具、架构树交互和终端乱码，与本轮三项整改无直接对应；未处理或回填这些工单，未创建新工单。
- `baseline`：HEAD 为 `a5938170cf9675b69960dde6a9bb535eb845bdd8`。开始时规范、Skill、原扫描、P0 和 P1 均未提交；以实际工作区 1,649 个维护文件的字节快照及摘要作为本轮基线，保留此前成果。原扫描及 P0/P1 报告保持历史快照，不改写。
- `change_reason.kind`：边界治理、依赖演进及配套说明维护。治理工作为 C3，按影响执行 C1 单元与静态约束，附 C2 全工程静态复扫。
- `layers/scope`：Bridge 契约与预加载、Main IPC 和历史装配／索引适配、Frontend 公共运行展示及其真实消费者、逻辑边界规则和受影响测试／性能探针路径。
- `impact`：收紧静态调用签名，迁移共享组件和装配入口。状态所有权、权限、业务命令、持久化格式、日志来源、工作区锁、停止与关闭顺序保持；无数据迁移和旧日志重写。
- `cognition_level`：L2，涉及公共调用签名及跨模块协作；附迁移、失败证据、取舍与回退。维护者人工 review 和接受结论尚未产生。
- `stable_boundary`：原 Electron 主 Frame 门禁、运行时身份与路径核验、未知结果不自动重放、事务和索引可靠写入、公开历史投影及控制器的迟到隔离。

## 2. 整改项与逐项验收（S4–S6）

### A07 / P2：操作、请求和响应建立关联

[ipc-call.ts](../../src/bridge/contracts/ipc-call.ts) 用联合元组保持操作和参数配对，返回值由操作推导；[agent-history-ipc.ts](../../src/bridge/contracts/agent-history-ipc.ts) 关联 `roles / sessions / runs / events`，运行时请求 Schema 复用 Core 的公开纯协议，不从具体服务推导接口。

[Main 历史处理器](../../src/backend/main/ipc/agent-history.ts) 在查找服务前严格解析输入，四个处理函数分别受响应类型约束，只取得历史查询端口。原总分派器保留其他操作及未知动作 `ACTION` 拒绝，主 Frame 与更新安装门禁不变。预加载桥继续使用原 `cbim:call` 和成功／错误信封，不增加自动重试。

真实消费者已迁移：角色读取、`useHistorySessions`、`useHistoryRuns` 和事件读取直接取得关联响应，移除自行指定响应的断言。其他页面的操作名包装收窄到真实使用的集合；原持久命令、取消与回执流程保持。

验收证据：

- 编译反例覆盖未知操作、缺失参数或身份、错误分页／游标、错误响应使用及显式放宽泛型，不能借任意字符串重载绕过已迁移请求。
- 非法身份、额外路径字段、缺失 Session 和越界分页在服务查找前拒绝；默认分页值正确传递，原查询错误继续拒绝而非空历史。
- 预加载层验证原通道、诊断和错误码透传，失败不重试；真实历史集成与前端身份／分页用例通过。
- 旧操作清单与实际 Main 原生处理及总分派分支做集合核对，防止路由漂移。类型清单不构成授权。

限制：[legacy-ipc-actions.ts](../../src/bridge/contracts/legacy-ipc-actions.ts) 保留另外 160 项既有操作，参数为 `unknown`、响应仍为 `any`；总 dispatcher 剩余 149 个 switch 分支。响应依靠声明类型及原有服务投影，本轮未增加所有 IPC 输出的运行时 Schema。新增业务组应沿同一映射渐进迁移。

### A08 / P2：共享展示与业务控制分开

六个实际共享文件从 conversation 迁到 [run-view](../../src/frontend/run-view/ARCHITECTURE.md)：WorkStatus、ToolActivity、MarkdownMessage、transcript、tool-labels、repairStreamingMarkdown。最小展示契约只含原运行、调用 ID 和工具名；共享层不再引用任务恢复 Hook 或其内部类型。

[RunToolDetails](../../src/frontend/conversation/RunToolDetails.tsx) 在外层核实真实主来源并组合原命令核实、影响观察与可选恢复上下文。主对话、任务根、成员正文分别显式传入展示插槽，恢复、选择、刷新和停止仍由原控制者持有。Markdown 的复制／展开保持本地状态，用户点击链接仍走固定 Bridge；不将其宣称为完全无交互的纯函数。

验收证据：

- 共享状态和工具轨道在未装配业务面板时可独立渲染，保留失败、用时和真实结果，不改写输入。
- 插槽只收到当前展示的原调用；单调用筛选、行尾状态及缺少可信主身份时不创建不应出现的核实入口。
- 原命令核实、影响观察、公开事件、Markdown、主会话／成员正文及反馈回执用例通过。原命令入口断言保留，只将测试装配改为显式插槽。
- 依赖检查验证 run-view 的直接依赖与整个可达前端依赖中均无 tasks、conversation 或 team 控制模块。原页面可继续组合业务视图，未把目录双向引用一概判为错误。
- 全局引用复查修正性能脚本的两处 Vite 探针路径，并核实插入锚点仍存在；未运行桌面性能验收。

### A09 / P2：历史索引存储与服务装配分开

[文件历史索引](../../src/backend/main/persistence/tasks/agent-history.ts) 只导出 FileAgentHistoryStore，不依赖具体 Workspace 或实例化调度服务。[Main 装配入口](../../src/backend/main/agent-history.ts) 仅接收工作区身份、project 目录定位和存活断言，组合历史服务、索引和 canonical 日志读取。

验收证据：

- 最小工作区能力替身即可装配；列表只读索引，详情核存活并读取原日志，关闭后拒绝查询。
- 日志身份不符、存活断言失败、运行目录经过符号链接／Windows junction 均拒绝，不用索引伪造正文。
- 原历史服务／索引测试覆盖分页、增量、冲突、坏记录、索引写失败与关闭排空；工作区启动测试保留持锁恢复和失败关闭约束。
- 对基线进行 AST 对照，FileAgentHistoryStore 类、工厂读取函数体及 Application 除导入外的实现一致；Main 原生 IPC 文件字节一致。safeId、逐层链接核验、realpath 包含检查、运行身份和关闭顺序均保留。

## 3. 验证依据、命令与结果

选择依据：A07 覆盖关联类型、边界解析、预加载和真实历史消费者；A08 覆盖所有迁移测试入口及核实／恢复展示，纯操作名收窄由类型检查和既有控制器用例约束；A09 覆盖最小装配、canonical 拒绝和原持锁恢复。修改了逻辑规则，增加对应检测器反例；没有因公共模块变动自动升级到全仓产品回归。

| 批次 | 实际结果 |
| --- | --- |
| 新边界及检测器：5 文件、31 项 | 全通过 |
| 真实消费者：23 文件、128 项 | 首轮 127 通过、1 失败；旧内联测试尚未显式装配原命令面板 |
| 内联测试定向补跑：1 文件、8 项 | 全通过，保留原入口断言，不放宽产品逻辑 |
| 不同用例最后结果 | **28 文件、159 项通过，无剩余失败或跳过**；补跑不重复计数 |
| `pnpm typecheck` | 最终通过；初次暴露的操作名包装、消费者导入和测试替身签名均已修正 |
| `pnpm check:architecture` | 最终通过，包含依赖检查；未再单独执行相同依赖命令 |
| `node --check scripts/issue20-input-performance-smoke.mjs` | 通过，探针目标及插入锚点存在 |

实际定向命令：

```powershell
pnpm exec vitest run tests/agent-history-ipc.test.ts tests/ipc-preload.test.ts tests/run-view.test.ts tests/agent-history-assembly.test.ts tests/dependencies.test.ts
pnpm exec vitest run tests/agent-history.test.ts tests/agent-history-store.test.ts tests/agent-history-view.test.ts tests/workspace-history-startup.test.ts tests/chat-chrome.test.ts tests/chat-inputs.test.ts tests/command-verification-view.test.ts tests/conversation-progress.test.ts tests/conversation.test.ts tests/github-feedback-lifecycle-pi.test.ts tests/github-feedback-pi.test.ts tests/github-feedback-tools.test.ts tests/human-continuation-view.test.ts tests/inline-conversation.test.ts tests/markdown.test.ts tests/member-continuation.test.ts tests/member-event-state.test.ts tests/pi-length.test.ts tests/queue-insert.test.ts tests/repository-tools-view.test.ts tests/effect-observation-view.test.ts tests/inline-module-ownership.test.ts tests/continuation-source-view.test.ts
pnpm exec vitest run tests/inline-conversation.test.ts
pnpm typecheck
node scripts/source-architecture.mjs
pnpm check:architecture
node --check scripts/issue20-input-performance-smoke.mjs
git -c core.safecrlf=false diff --check
```

未运行：全仓产品测试、完整桌面／性能测试、打包、安装升级或真实外部模型验收。集成用例使用本地可控响应，不以单元通过代替人工 review、合并或发布。

## 4. 全工程复扫结果与剩余边界

| 同口径指标 | P1 后基线 | 本轮结束 |
| --- | ---: | ---: |
| 维护范围内代码文件 | 1,201 | 1,213 |
| 含类型引用的依赖边 | 6,249 | 6,282 |
| 文件循环、物理／逻辑违规 | 0 | 0 |
| 未解析引用、未批准动态加载 | 0 | 0 |
| 已登记逻辑边界／覆盖文件 | 10／16 | 13／27 |
| 源码目录／代码与样式文件 | 55／605 | 56／612 |
| 类图资料漂移 | 0 | 0 |
| AST 核对的源码脚本／缺失文件头 | 560／0 | 567／0 |

全部维护代码做语法及引用定位，三项整改链路结合实际代码和行为测试核查；不声称逐文件完整语义验证。新增的三类逻辑边界分别保护历史 IPC 契约、文件历史索引和共享运行展示，反例包含类型引用反向耦合。7 处原已审核外部动态加载保持，不能视作内部依赖。

原 A07–A09 的最小验收闭合，P0/P1 的既有边界仍通过静态约束。剩余限制明确保留：160 项 IPC 响应尚为宽类型；全仓仍有 67 个源码文件直接命名导入 DispatchStore/DispatchState，跨域事务与其他 Runtime 准备逻辑继续由原协调者负责。它们是后续扩展的范围线索，不自动成为新工单或全量重构授权。

## 5. 迁移、维护与交接（S7）

旧 conversation 六个入口按 `active → deprecated → migrating → retired` 在本次授权切片内完成：替代目录确定后迁移真实消费者，复查源码／测试／脚本中的导入与 Vite 路径，旧入口已删除。存储文件中的旧工厂导出同样退役，Application 指向 Main 新装配。仓库内无剩余旧路径消费者，无外部公开包兼容承诺；没有增加兼容转发来隐藏旧耦合。

同步了相关文件头、接口说明、8 份 CONTRACT（含新增 run-view）及 16 份目录 ARCHITECTURE；生成器更新公共目录、业务组合和 IPC 边界，父目录导航同步。未修改两份规范、Skill 或原 P0/P1 报告。

推荐 review 顺序：Bridge 关联契约 → Main 历史处理器／装配 → run-view 与 RunToolDetails → 三处页面组合与历史 Hook → 边界规则和测试 → 本报告。完整本轮差异保存在本机 `test-results/architecture-p2-20261111/p2-review.patch`，相对于包含 P0/P1 的未提交工作区生成；`git diff` 还包含此前轮次，不能全算成本轮。

回退条件与方式：若后续发现身份、核实入口或关闭时序差异，先停止相应切片推进，保留失败证据；以本轮基线逐文件恢复契约／消费者或装配的配套改动。没有数据格式变化，不需要重写日志；不能用 reset/clean 丢弃此前未提交的 P0/P1。基线和原始执行输出保存在上述本机证据目录，受 Git 忽略，不承诺作为仓库文件长期分发。

- **Q1：保护了什么？** 公开历史投影、canonical 日志校验、持锁恢复、未知结果不重放，以及既有状态与恢复控制器。
- **Q2：变化限制在哪里？** IPC 参数演进在业务组契约／处理器；共享消息样式与投影在 run-view；业务核实装配在外层；历史服务组合在 Main，文件索引独立。
- **Q3：为何只运行这些验证？** 根据实际类型签名、文件迁移、真实调用方及锁／日志边界选择上述 28 文件，再用全工程静态扫描覆盖引用；未变执行核心和发布流程不由本轮重复验收。
- **Q4：下次从哪里改？** 历史协议从 agent-history-ipc 开始；新增展示从 run-view 的最小输入开始；核实／恢复从 RunToolDetails 和原业务控制器开始；历史存储与装配分别从各自同名文件开始。
- **Q5：规则候选？** 无新增通用候选。显式装配、窄契约及消费者清零已由现行规范覆盖，本轮只增加对应事实与检测约束。

交付状态：本地实现、定向验证和静态复扫完成，未提交、推送、合并或发布；尚未获得维护者人工 review 结论。
