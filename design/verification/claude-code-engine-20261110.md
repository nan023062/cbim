# Claude Code 第二引擎与 Agent 选型验证

日期：2026-11-10。范围：第二引擎及配置选择的开发验证；不是合并、线上供应商或桌面发布验收。工作区保留上一项“主 Agent 默认执行”的未提交改动，本记录只说明本需求的实现与验证。

## 已交付行为

- CBIM 独立装配 Claude Agent SDK 0.3.322，与 Pi 并列实现 AgentEngine。凭据、设置目录和原生历史归 CBIM 管理，不借用 Cindy 或其他客户端的账号。
- 用户模型供应商配置增加引擎。静态 Agent 默认配置、项目岗位及主对话提供引擎/模型两级菜单，选项来自已保存且启用的模型。旧配置缺省 Pi，不回填历史快照；配置失效要求重新选择。
- 主对话切换保留任务及公共历史，恢复目标引擎自己的原生文件；排队和继续使用冻结的引擎/模型。岗位独立冻结模型，不能被主对话临时选择覆盖。
- 两引擎共用知识/运行工具路由、权限、请求预算与事件记录。Claude 的进程内 SDK 工具连接不提供对外 MCP 服务。首轮实际原生文件产生后核实绑定，续执行仍核身份及原文件。
- Claude 流式工具会提前执行，工具授权前显式等待请求账本可靠结算。结算失败关闭 Query，不放行副作用；拒绝、停止及记录失败不伪造成功回执。
- Forge 配置增加独立 claude-runtime 资源复制，包含 SDK、peer 依赖及本平台原生二进制。仅验证复制后实际 SDK 可加载，未生成本轮安装包。

## 受影响单元及结果

按实际行为和消费者选择，累计 **26 个测试文件、198 个不同用例通过**。这是分批验证和失败修正后的累计结果，不是一次全量测试；同一用例的复跑不重复计数。

| 范围与选取理由 | 测试文件 | 最终不同用例 |
| --- | --- | --- |
| 引擎配置、旧模型兼容、原生文件与岗位默认值 | engine-configuration、llm、native-session-files、inline-module-ownership | 30 |
| 真实 Claude 进程、工具门禁、主/成员实际装配及跨引擎接续 | claude-engine、claude-tools、claude-application、engine-session | 18 |
| 共享指引/工具/传输的原 Pi 与运行消费者 | member-execution、loop-engine、runtime-continuation、runtime-fresh-main、unified-tool-policy、model-request-budget-transport、model-request-budget-usage、model-request-budget-pi、direct-main-execution-pi | 81 |
| 模型快照、岗位界面、Agent CRUD、资源导出和独立 SDK 资源 | claude-packaging、owner-model-configuration、workspace-member-core、workspace-member-view、team-model、object-crud、workspace-packages | 53 |
| 新增固定第三方加载例外及架构生成配置 | dependencies、source-architecture | 16 |

上表文件均位于 tests/，后缀为 .test.ts。

### 实际执行命令

配置与文件兼容，4 文件 / 30 项通过：

```sh
pnpm exec vitest run tests/engine-configuration.test.ts tests/native-session-files.test.ts tests/inline-module-ownership.test.ts tests/llm.test.ts
```

新增引擎与装配首轮，10 通过 / 2 失败；修正下述成员模型白名单和工具目录兼容问题后，claude-application 的主/成员用例分别定向复跑通过。engine-session 的 4 项在首轮通过：

```sh
pnpm exec vitest run tests/claude-engine.test.ts tests/claude-tools.test.ts tests/claude-application.test.ts tests/engine-session.test.ts
```

共享能力消费者，9 文件 / 81 项通过：

```sh
pnpm exec vitest run tests/member-execution.test.ts tests/loop-engine.test.ts tests/runtime-continuation.test.ts tests/runtime-fresh-main.test.ts tests/unified-tool-policy.test.ts tests/model-request-budget-transport.test.ts tests/model-request-budget-usage.test.ts tests/model-request-budget-pi.test.ts tests/direct-main-execution-pi.test.ts
```

配置、界面和资源组首轮 49 通过 / 3 失败；恢复岗位模型标签并对齐两级菜单的必选提示后，workspace-member-view 单独 13 项通过。其余同组用例不重复运行：

```sh
pnpm exec vitest run tests/claude-packaging.test.ts tests/owner-model-configuration.test.ts tests/workspace-member-core.test.ts tests/workspace-member-view.test.ts tests/team-model.test.ts tests/object-crud.test.ts tests/workspace-packages.test.ts
pnpm exec vitest run tests/workspace-member-view.test.ts
```

补充本机模型配置导出隔离，1 通过 / 9 项由选择器跳过；覆盖 Team/Agent 导出移除 runtime，原本机对象保持不变：

```sh
pnpm exec vitest run tests/workspace-packages.test.ts -t '本机引擎'
```

新增检测器例外和配置/独立资源加载验证，4 文件 / 21 项通过；其中配置与资源用例和前面重合，不重复计数：

```sh
pnpm exec vitest run tests/dependencies.test.ts tests/source-architecture.test.ts tests/engine-configuration.test.ts tests/claude-packaging.test.ts
```

真实停止和原生工具补充：stop 选择器选中 1 项通过、3 项跳过（其中 claude-packaging 未被该选择器选中，实际覆盖来自上面的独立组）；授权 Write、Bash、hook failure 选择器选中 3 项通过 / 4 项跳过：

```sh
pnpm exec vitest run tests/claude-engine.test.ts -t 'stop' tests/claude-packaging.test.ts
pnpm exec vitest run tests/claude-tools.test.ts -t 'approved|hook failure'
```

请求结算屏障先以真实进程复现失败，再修复。增加成功/失败两种延迟结算用例，最终对受影响的引擎与工具文件复跑，2 文件 / 12 项全部通过：

```sh
pnpm exec vitest run tests/claude-tools.test.ts -t 'request settlement'
pnpm exec vitest run tests/claude-tools.test.ts tests/claude-engine.test.ts
```

静态检查与架构同步：

```sh
pnpm typecheck
node scripts/source-architecture.mjs
pnpm check:architecture
git -c core.safecrlf=false diff --check
```

类型检查通过。最终架构检查：54 目录、593 个代码/样式文件，0 份文档差异；依赖检查包含类型引用，1172 文件、6054 条依赖、0 循环、6 处经审核外部动态加载。diff 格式检查通过。

## 本轮发现并修正的问题

1. 运行模型的新 engine 字段被成员持久化白名单拒绝；加入明确枚举与 API 一致性校验，在传入原模型专属 Schema 前分离该字段，旧缺省哈希不变。
2. Anthropic 拒绝顶层联合工具 Schema，实际目录缺少治理回执/模块负责人查询工具。适配器发布对象字段与共同必填项，领域入口继续按原联合 Schema 严格校验；不以放宽业务校验解决目录问题。
3. 岗位表单测试暴露标签和旧单级占位提示不一致；保留“岗位模型”标签，并验证先选引擎再选模型的实际表单。
4. 资源测试的任意动态 import 不符合依赖边界；改为调用产品的固定 SDK 加载器验证复制资源，没有扩大通用动态加载许可。
5. 结算延迟时，真实 Claude 在 SSE 终态前已经进入 Write 授权。现在 PreToolUse 等待 assertSettled，失败关闭 Query；成功延迟用例确认不会死锁，失败用例确认未授权、未写文件、请求仅一次、账本保留 unknown。首次失败还暴露 Windows 测试目录短暂占用，清理增加有界 EBUSY 重试；未以重试掩盖产品断言失败。

## 注释、架构与认知交接

源码文件头、关键契约及受影响目录类图同步到 brain（含新增 claude、共享 llm、Pi）、knowledge、tasks、team、tools、main 装配与模型持久化/原生文件平台、scheduler-engine/execution、bridge/contracts 和前端配置/岗位/工作区/会话目录。

稳定的任务、业务权限、知识与证据服务继续由原有层持有；SDK 消息、原生工具名称、环境和文件格式变化限制在 claude 适配目录。共用指引与工具目录从 Pi 抽出，后续业务工具变化不必分别改两个引擎。跨引擎历史选择独立处理，Runtime 继续拥有公共运行事实。

使用入口、设计取舍和下次修改位置见[双引擎说明](../../docs/claude-code-engine.md)。本记录不代表维护者已经完成代码 review。

## 明确保留的验证边界

- Claude 当前只接用户配置的 Anthropic Messages API；Pi 专属上下文/压缩阈值不覆盖 Claude 原生策略。Claude 支持排队，未实现可靠的运行内插入。
- 真实进程测试使用本机可控供应商响应，没有使用真实用户账号或调用线上模型。真实工具执行、授权/拒绝和历史持久化通过，不代表业务输出质量已验收。
- 未运行全仓测试、完整桌面 UI、在线模型、Forge 完整构建、安装/升级或发布验收；完整回归留给现有面向 master 的 PR CI，发布按独立流程执行。
- UI 自动化脚本已加入引擎选择步骤，但本轮未执行；历史脚本中退役默认执行者相关场景仍需随桌面集成任务核对。
- 当前改动留在工作区，未创建提交、PR 或发布；上一需求改动保留。
