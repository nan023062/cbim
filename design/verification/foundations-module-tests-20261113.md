# 独立基础能力与模块测试治理（2026-11-13）

## 来源、范围和依据

用户直接要求全局评估可复用解决方案、实施优化并同步 AI 开发流程，所有单元测试按模块解耦。基线 `48bd18cd`；开放工单查询为 #65、#68，没有对应新工单，本次不虚构编号或回填其他工单。原 `src/frontend/tasks` 的任务历史改动及 `tests/task-history-view.test.ts` 是既有并行工作，不纳入本轮提交。

范围为 C3 / L3：检查全仓静态依赖与测试可达性，阅读架构/契约和文件 I/O、队列、配置、存储、执行日志、网页路径的实际实现；不是对全部源码逐行审计，也不宣称所有历史断言已逐条语义审阅。现有网页基础能力已经完成，本次不重复浏览器重构。

## 候选判断与实际取舍

| 能力 | 决策与证据 | 变化应发生在哪里 |
| --- | --- | --- |
| 原子文件、JSON 读取、存在探测 | 实际抽取为 `foundations/files`；23 个源码消费者迁移公共入口，清除旧 Core 出口 | 基础库负责单文件机制；路径授权、业务 Schema、版本、锁、事务由消费者负责 |
| 失败后继续的串行队列 | 实际抽取为 `foundations/concurrency`；三个设置服务、两个模型服务使用同一机制 | 实例持有队列；业务保存和回调仍在本类，不新增策略开关 |
| 网页静态/浏览器读取 | 复用既有 `foundations/web`，本次拆开基础读取、服务、工具适配测试 | 浏览器与 HTTP 机制在基础库；工具协议、配置和信任标记在消费者 |
| JSON / 哈希 / 序列化 | 暂不合并；使用广，但规范化字节、危险键、大小限制及领域错误码并不等价 | 先核实每种格式的兼容要求；不能以名称相同替换历史指纹 |
| 日志 / 文件事务 / 恢复 | 保留业务模块；RunJournal 的失败屏障与本次队列“失败后继续”相反 | 事务提交、重放、未知结果和证据责任仍归原存储服务 |
| 网络请求与重试 | 不把公开网页、带密钥的模型连接、仓库凭据塞入同一通用请求器 | 通信机制可复用，目标授权、重发与隐私策略必须分别拥有 |
| 原生文件 / 进程隔离 | 保留平台边界；句柄身份、权限及崩溃恢复具有独立生命周期 | 未证明端口可独立前不移入基础库，更不复制较弱实现 |
| UI 请求生命周期 | 继续由各状态模型拥有，不能把未知提交回执和普通只读刷新混成一个 Hook | 真实重复语义出现后按身份与取消契约提炼 |

抽取保护的是已经一致的机制，而非宣布它永远稳定。新增同类设置组合文件/队列即可，不修改其核心实现；新失败语义应另立明确契约，不能向 `SerialQueue` 塞“日志模式”等业务分支。

## 边界与迁移

依赖为消费者 → foundations。基础库不依赖 Core、Main、Scheduler、Bridge 或 Frontend，包含类型引用；能力内部经公开入口供外部消费。Core 原 `foundation/files.ts` 已删除，全部仓库源码/测试静态引用迁移；这是内部源码入口，无外部产品协议或持久化格式迁移。

`atomic` 仍是同目录独占临时文件、UTF-8 写入、内容同步和重命名；修复写入/同步/关闭阶段失败未进入清理的问题。它不提供目录 fsync、跨进程锁、多文件事务或目录授权。`SerialQueue.run` 向本次调用者返回原结果/异常，后续任务继续；`drain` 等待调用时队尾，不吞掉调用者的错误、不禁止新任务。各消费者的 revision、解密时机、模型回调锁范围及持久化字节语义保留。

迁移失败的回退单位是基础库及其真实消费者、对应依赖规则和测试一起回退；不能只恢复旧导入或同时留两套实际实现。代码自查保留真实业务错误处理，没有把失败屏障日志改成可恢复队列。

## 测试及开发流程

新增单文件基础库 3 项、串行队列 2 项回归。纯 `required` 断言从完整 Application 夹具剥离，13 个引用文件改用纯辅助入口；网页设置直接拥有临时目录。实际拆分六组混合职责：网页基础/服务/工具、设置/IPC、读模型/注册表/层级规则、会话/布局、队列/界面活动、审阅工具/展示。原测试体与断言保留；候选数据构造器每次复制身份，错误回包测试不污染其他用例。

正式目录登记 448 文件、71 个模块：114 unit、147 contract、187 integration。仅据真实用途把完整应用/平台测试作为集成保留，不能将这些数量说成 448 套单元已完全解耦。检测器强制唯一归属、无漏登记、单元不间接加载 Application、禁止跨测试套件依赖、限制单元直接/辅助运行时被测模块；类型边仍用于应用可达性和循环检查。

`pnpm test:module --module <模块>` 默认仅执行该模块单元；空选择失败，契约/集成显式选择。PR 加入 `check:test-modules`，原完整四片回归保留。AGENTS、两份架构规范、开发入口及三个宿主的三个开发/架构 Skill 同步。规则作用于本仓库当前 AI 开发工作流，不改变产品内置业务 Skill 或自行新建自动化。

静态规则不能证明断言的单一业务责任、动态状态完全隔离或 mock 与真实端口一致；这些必须继续通过 review 与受影响行为测试核实。没有为通过检查删掉真实协作断言，也不把目录归属当成全仓语义解耦证明。

## 验证记录

选取依据：基础机制覆盖成功/失败/队列顺序；设置与模型消费者覆盖并发保存和选型；历史/工作区/资源覆盖文件入口迁移；拆分后的每组测试保持原断言；分层与归属检查器覆盖新依赖规则。只运行下列受影响范围，没有无参数全仓回归。

1. `pnpm exec vitest run tests/unit/foundations/files.test.ts tests/unit/foundations/concurrency.test.ts tests/web-settings.test.ts tests/web-settings-ipc.test.ts tests/budget-settings.test.ts tests/admission-settings.test.ts tests/main-agent-settings.test.ts tests/llm-profiles.test.ts tests/core-domains.test.ts tests/core-layer-contracts.test.ts tests/connector-registry.test.ts tests/conversation.test.ts tests/conversation-tabs.test.ts tests/web-service.test.ts tests/web-foundations.test.ts tests/web-tools.test.ts tests/rules.test.ts tests/dependencies.test.ts tests/layer-boundaries.test.ts`：实际选中 18 文件 / 92 用例，90 通过，层级测试 2 项失败。命令里的 `llm-profiles.test.ts` 不存在，未将其算作已运行；实际模型测试见下一项。失败是旧 Core 层镜像未允许 foundations 和新目录类图尚未生成，修复后在第 4 项复验。
2. `pnpm exec vitest run tests/llm.test.ts tests/owner-model-configuration.test.ts tests/agent-history-store.test.ts tests/workspace.test.ts tests/path-contract.test.ts tests/resource-repository.test.ts tests/resource-packages.test.ts tests/knowledge-source-store.test.ts`：实际选中前 6 文件 / 56 用例全部通过；后两个名称不存在，未计入验证证据。
3. `pnpm test:module --module tooling/test-modules`：最终 1 文件 / 10 项通过，验证真实局部执行入口。初轮检查器用例发现同一行多条 import 时 named type 被错判，改为同时匹配行号和 spec 后通过；审阅追加空导入、混合导入、同源同一行运行时/动态导入五例并通过，没有放宽断言。
4. `pnpm exec vitest run tests/dependencies.test.ts tests/layer-boundaries.test.ts tests/message-queue.test.ts tests/brain-status.test.ts tests/candidate-review.test.ts tests/candidate-review-tools.test.ts tests/team-workflow.test.ts tests/resource-repository.test.ts --reporter=dot`：8 文件 / 48 项通过。含新增文件/队列私有入口、反向类型依赖回归，以及纯辅助引用变更的消费者。
5. 候选夹具身份改成逐次复制后，`pnpm exec vitest run tests/candidate-review.test.ts tests/candidate-review-tools.test.ts --reporter=dot`：2 文件 / 4 项通过。与前项重合，不重复累计。
6. `pnpm typecheck` 通过；初轮新增文件测试的 mock 类型声明错误已修正。`pnpm check:architecture` 通过：91 目录 / 705 源码及样式、1406 扫描文件 / 7034 依赖、0 环及违规。`pnpm check:test-modules` 通过：448 登记文件，114 / 147 / 187。静态扫描包括保留的并行工作，不将其计入本次代码提交。

全量四片、真实桌面/安装、打包、浏览器实站重测均未运行。网页产品行为本次没有变化，已有 Saltline 证据不冒充本次新验收。未推送、创建 PR、合并或发布；代码尚待维护者 review。

## 维护者阅读入口与四问

先看 `src/foundations/{files,concurrency}/CONTRACT.md` → 实现与单元 → Main/settings、Main/models 消费者 → `scripts/architecture-boundaries.mjs`，再看 `tests/README.md` → 模块目录 → 检查器及回归。完整改动以两份本地提交的 diff 为准。

- Q1：保护原子替换、实例串行及业务失败可见性，保留配置/模型/事务的所有权。
- Q2：通用文件/队列机制留在 foundations；业务策略仍在原模块，测试夹具与运行入口分别归属。
- Q3：源码变化集中于机制替换、公开入口及测试拆分，因此运行上述基础机制、实际消费者和检查器；没有凭静态图把全仓列入必跑范围。
- Q4：新的文件机制从 files 公共契约改；并发机制从 concurrency 改；业务保存规则从各设置/模型服务改；测试归属从 modules.json 与独立辅助入口改。
- Q5：模块单元解耦是用户本轮明确要求，已同步现行开发规则；没有额外未经授权的周期治理或自动发布规则。
