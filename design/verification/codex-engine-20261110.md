# Codex 第三引擎开发验证（2026-11-10）

## 范围与实现

在未提交的主 Agent 默认执行、Claude Code 第二引擎成果上接入 Codex，保留前两项改动。本轮没有提交、推送、构建整包或发布。

核对本机 Cindy 的 Codex RPC、thread/turn、动态工具与关闭内置执行的装配方式，并参考官方 App Server 文档。固定 `@openai/codex@0.167.0`，从该二进制生成协议资料核对字段，不使用其他客户端的账号或进程。临时参考文件仅保存在忽略的 test-results 目录。

- Codex App Server 双向 JSONL：真实线程回执、流式正文、停止/关闭、原生恢复和工具调用；关闭内置执行及额外入口，调用统一走 CBIM 权限和证据。
- 用户配置增加 codex，协议必须是 OpenAI Responses；供应商表单、静态 Agent、岗位、主对话和排队共用配置契约。旧配置不回写默认字段。
- Codex 首次生成的线程 ID 与任务 ID 分开；成员 ready 同事务绑定实际 ID，后续不可改绑；原生文件完整核实后用于恢复和检查点。
- Responses 代理冻结模型、输出上限与实际工具目录；复用请求账本和严格 SSE 用量解析，可靠结算前不执行工具；按本轮请求汇总用量，恢复历史不重复累计。
- 独立资源复制保留 Codex 平台包的 npm 别名；Forge 分别装配 Pi、Claude、Codex 的受管运行资源。

## 受影响单元与选择依据

只选择实际新增的 Codex 协议/工具/生命周期/资源，以及受模型枚举、原生身份回执和共享装配影响的消费者。没有运行无参数 test、全仓回归或完整桌面测试。

| 单元 | 验证原因 |
| --- | --- |
| codex-engine、codex-tools、codex-lifecycle | 真实二进制、文本、授权与拒绝、实际 read/write/bash、停止、预算结算、工程配置隔离、用量与原生恢复 |
| codex-application、claude-application | Application 装配、Pi → Codex → Claude → Codex → Pi、独立岗位模型、首轮原生绑定与请求账本 |
| codex-packaging、claude-packaging | 通用复制器改用安装别名，必须核平台包与既有 Claude 依赖仍能独立加载 |
| engine-configuration、engine-session、native-session-files | 供应商/岗位快照、菜单、排队、目标引擎 ID、Codex JSONL/文件名身份 |
| runtime-continuation、runtime-fresh-main、member-execution、member-checkpoint-domain | ready 增加原生 ID 回执后，主续接、新链及成员领取/检查点固定输入保持原规则 |
| auto-collaboration | 自动回注继续使用原主引擎；独立知识治理及正式计划/派发的收尾边界 |
| dependencies | 新增一个经核实的第三方动态加载例外，验证检测器仍拒绝未审核加载和类型循环 |

## 实际命令和结果

1. 初期 `pnpm exec vitest run tests/codex-engine.test.ts tests/codex-tools.test.ts`：2 文件、8 项通过。
2. `pnpm exec vitest run tests/codex-application.test.ts tests/codex-lifecycle.test.ts tests/codex-packaging.test.ts tests/claude-packaging.test.ts`：8 通过、1 失败；失败是新资源测试使用了错误的清单字段，独立二进制已成功启动。改为 directory 后在下一批通过。
3. 主回归：

```text
pnpm exec vitest run tests/codex-engine.test.ts tests/codex-tools.test.ts tests/codex-lifecycle.test.ts tests/codex-application.test.ts tests/codex-packaging.test.ts tests/engine-configuration.test.ts tests/engine-session.test.ts tests/native-session-files.test.ts tests/runtime-continuation.test.ts tests/runtime-fresh-main.test.ts tests/member-execution.test.ts tests/member-checkpoint-domain.test.ts tests/auto-collaboration.test.ts tests/claude-application.test.ts
```

14 文件、116 项：114 通过、2 失败。一个新队列测试漏填必需 provider；另一个旧测试仍把独立知识提交视为必须建立团队计划，与上一需求已实现的主 Agent 直接工作规则不符。补全夹具并拆分知识治理/正式规划断言，额外覆盖 Codex 自动回注保留引擎。

4. `pnpm exec vitest run tests/engine-configuration.test.ts tests/auto-collaboration.test.ts`：2 文件、46 项通过；只复跑修改的文件，没有重跑已通过的其他单元。
5. `pnpm exec vitest run tests/dependencies.test.ts`：1 文件、12 项通过。
6. `pnpm typecheck`：通过。
7. `node scripts/source-architecture.mjs`：55 目录、600 个代码/样式文件，更新 15 份文档。`pnpm check:architecture`：0 文档差异；1185 文件、6101 条包含类型的依赖、0 循环；7 处已审核的第三方动态加载。
8. `git -c core.safecrlf=false diff --check`：通过；72 份改动文档的 2623 个本地链接核实有效。
9. 最后复核补充真实检查点字节断言，`pnpm exec vitest run tests/codex-engine.test.ts` 暴露 thread/resume 自身追加配置记录的差异。将完整证明复核放到恢复动作之前，恢复后核对实际身份/格式；`pnpm exec vitest run tests/codex-engine.test.ts tests/codex-application.test.ts`：2 文件、4 项通过。随后重生成受影响类图并通过类型/架构检查。

合并以上受影响单元，最终 **16 个不同测试文件、130 个不同用例通过**，不把重复执行累计成新增用例。

## 实现时发现并修正

- Pi SDK 是 ESM，不能从未导出的包入口 require.resolve；现在定位固定版本的实际 dist/index.js，只复用独立文件/命令工具。
- Codex 即使关闭额外功能仍附带 request_user_input；实际请求不发布该工具，交互只走 CBIM 注册能力，服务端未知请求拒绝。
- Windows 恢复返回扩展路径前缀；在保存和比较前统一为平台路径，再检查真实文件归属。
- Codex 分配真实线程 ID，不能沿用逻辑任务/通道 ID；主切换和成员首次绑定分别处理。
- 停止会使在途传输报错；保留用户取消意图，等待进程/工具排空，不由停止导致的传输错误反向覆盖为成功或自动重试。
- thread/resume 会追加 thread_settings_applied；恢复前再次核对完整检查点，恢复后核对实际身份/格式，避免把原生合法追加当作外部篡改。真实测试检查前缀保持一致且追加来自配置记录。
- 原生线程累计用量包含历史；改用本轮实际请求统计，恢复后仍只计新一轮。

## 维护与未验证边界

新增 codex 目录的源码头、接口说明、CONTRACT 和类图；同步 brain、llm、tasks、team、tools、scheduler-engine/execution、main/platform、bridge/contracts、frontend/settings/conversation 的相关注释与架构说明，以及路线图和使用文档。

真实原生进程使用本机确定性 SSE 响应，未使用用户密钥或在线模型；未运行完整桌面菜单交互、全仓测试、完整打包、安装升级或发布。独立资源复制测试不代替发布制品验收。Codex 当前支持排队而非运行内插入；专用远端压缩端点未接入。模型 completed 不代表业务验收通过。
