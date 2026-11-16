# 2026-11-16：方法大驼峰迁移验证

基线为 `bc72dea4`，用户直接授权全仓自动校验并修正方法命名，无关联开放 Issue。本记录描述本地完成的验证，不代表完整 CI、桌面、升级或发布通过。

## 改动与兼容边界

- 扫描 782 个源码脚本、1,996 处方法声明；1,947 处改为 PascalCase。347 个源码文件涉及声明或消费者变化，475 个既有测试文件和 66 个脚本同步引用；另新增命名检查器及其 6 项单元测试。
- 49 处固定名称按文件、所属声明及方法逐项登记：9 处 React、Node、Electron、浏览器存储约定，40 处已发布 EngineAdapter protocol=1 及实际实现/选项端口。保留包工厂、生命周期、上下文、工具端口、retain 和逐次预算协议，不修改发布包版本或原恢复身份。
- 普通函数变量、字段、访问器遵循其原命名规则；函数值实现方法契约时与该契约同名。没有批量修改字段、箭头排版、IPC 操作名或持久化字段。
- TypeScript 语言服务按符号迁移，同时核对类型键、字符串索引、可选方法、属性别名及动态测试替身。两次过宽类型分析达到内存上限，均在写入前退出；随后限定到具体调用和失败模块。未把未完成的扫描报告为通过。
- 归一化允许的大小写命名、属性别名及行尾后，347 个源码文件的 AST 结构与基线一致。这用于排除额外结构改动，不替代运行语义验证。
- 同步源码接口注释、47 份阅读/契约文档及 90 份目录类图。类图的职责和依赖不虚构变化。

## 结果

- `pnpm check:method-names`：1,996 声明，0 违规，49 固定协议例外；无失效或重复命中例外。
- `pnpm typecheck`：通过。
- `pnpm check:architecture`：135 目录、837 代码/样式文件，0 文档漂移；1,677 依赖文件、7,940 条依赖，0 环、0 违规。
- `pnpm check:test-modules`：542 套件登记通过（175 unit / 166 contract / 201 integration）。
- `node build/check-format-document.cjs`：8 项规则、4 个 TS 示例、3 个引用及围栏通过；`git -c core.safecrlf=false diff --check` 通过。
- 实际选择 125 套件（93 unit / 29 contract / 3 integration），分轮按文件及用例位置去重后 **979/979 通过**。选择依据是本次实际更名的责任模块、工具库真实消费者、固定引擎包协议和装配/取消/调度边界；未运行全仓 542 套件。

## 定向测试与修正

首次工具库验证 94 通过、2 失败，修正 any 访问的私有方法后精确复验。其余受影响单元首轮 506 通过、38 失败；修正测试替身、可选回调和覆写属性后复验。边界验证继续发现未类型化的深层端口、私有方法投影和回调替身，逐项修复并只复验失败套件；最后仅复验 `replan-start-race.test.ts -t '已受理后引擎失败'` 的 1 项，其余 4 项沿用前一轮通过结果。没有降低断言、延长超时、删除集成覆盖或改写业务错误语义。

下面列出执行时传给 Vitest 的明确文件集合。批量选择由 Node 启动同一 `node_modules/vitest/vitest.mjs` 入口，未使用无参数全仓运行。中间与最终 JSON 回执位于本地忽略的 build，分别为 method-migration-utility-tests、adapter-tests、unit-tests、unit-recheck、boundary-tests、contract-tests、dynamic-recheck、dynamic-final、last-case 和 final-tests。

### 工具库单元与真实消费者契约

```powershell
node node_modules/vitest/vitest.mjs run tests/utility-body-consumers.test.ts tests/utility-json-contract.test.ts tests/utility-json-order-contract.test.ts tests/utility-redaction-contract.test.ts tests/utility-rpc-framing-contract.test.ts tests/utility-serialization-contract.test.ts tests/unit/foundations/utility/bounded-bytes.test.ts tests/unit/foundations/utility/graphs.test.ts tests/unit/foundations/utility/in-flight.test.ts tests/unit/foundations/utility/json-order.test.ts tests/unit/foundations/utility/json-text.test.ts tests/unit/foundations/utility/line-framer.test.ts tests/unit/foundations/utility/pending-requests.test.ts tests/unit/foundations/utility/redaction.test.ts tests/unit/foundations/utility/serial-queue.test.ts tests/unit/foundations/utility/strict-json.test.ts tests/unit/frontend/foundations/utility/async.test.ts tests/unit/frontend/foundations/utility/events.test.ts tests/unit/frontend/foundations/utility/graphs.test.ts tests/unit/frontend/foundations/utility/json.test.ts tests/unit/frontend/foundations/utility/storage.test.ts --reporter=default --reporter=json --outputFile=build/method-migration-utility-tests.json
```

### 检查器、脱敏复验与独立引擎包加载

```powershell
node node_modules/vitest/vitest.mjs run tests/utility-redaction-contract.test.ts tests/method-names.test.ts tests/engine-adapter-package.test.ts --maxWorkers=2 --reporter=default --reporter=json --outputFile=build/method-migration-adapter-tests.json
```

### 其余受影响单元

```powershell
node node_modules/vitest/vitest.mjs run tests/agent-call-exchange.test.ts tests/connector-registry.test.ts tests/task-progress.test.ts tests/knowledge-queries.test.ts tests/core-domains.test.ts tests/tool-registry.test.ts tests/native-tool-paths.test.ts tests/claude-engine.test.ts tests/codex-engine.test.ts tests/codex-tools.test.ts tests/codex-write-recovery.test.ts tests/engine-inactivity-pi.test.ts tests/pi-cancellation.test.ts tests/pi-rpc.test.ts tests/pi-tool-catalog.test.ts tests/model-request-budget-usage.test.ts tests/command-evidence-store.test.ts tests/native-session-files.test.ts tests/artifact-files.test.ts tests/controlled-namespace-platform.test.ts tests/png-artifact-files.test.ts tests/scoped-execution-platform.test.ts tests/isolated-node.test.ts tests/scope-usage-service.test.ts tests/unit/logic/budget/model-role-service.test.ts tests/main-history-context.test.ts tests/message-queue.test.ts tests/questions.test.ts tests/office-history-service.test.ts tests/global-runtime.test.ts tests/candidate-review-tools.test.ts tests/office-history-tools.test.ts tests/coordination-schema.test.ts tests/web-tools.test.ts tests/desktop-updates.test.ts tests/nsis-differential-download.test.ts tests/nsis-updater.test.ts tests/unit/logic/updates/engine-artifacts.test.ts tests/topic-interruption-view.test.ts tests/channel-draft.test.ts tests/governance-feedback-view.test.ts tests/governance-pending.test.ts tests/knowledge-file-tree.test.ts tests/repository-connection-state.test.ts tests/budget-settings-view.test.ts tests/runtime-navigation.test.ts tests/artifact-report-view.test.ts tests/command-verification-view.test.ts tests/continuation-source-view.test.ts tests/controlled-file-view.test.ts tests/effect-observation-view.test.ts tests/execution-recovery-repeat.test.ts tests/execution-report-view.test.ts tests/office-scene.test.ts tests/output-manifest-view.test.ts tests/scope-continuation-view.test.ts tests/scope-replan-view.test.ts tests/scope-usage-view.test.ts tests/workspace-member-view.test.ts tests/module-ownership-view.test.ts tests/llm.test.ts tests/owner-model-configuration.test.ts tests/unit/logic/models/model-operations.test.ts tests/unit/logic/models/embedding-test.test.ts tests/web-service.test.ts tests/web-settings.test.ts tests/web-foundations.test.ts tests/web-page-reader.test.ts tests/github-feedback-auth.test.ts tests/resource-store.test.ts tests/terminal.test.ts tests/budget-settings.test.ts tests/unit/logic/engines/packages.test.ts tests/unit/logic/execution/memory-engine.test.ts tests/module-source-browser.test.ts tests/agent-call-scheduler.test.ts --maxWorkers=2 --reporter=default --reporter=json --outputFile=build/method-migration-unit-tests.json
```

### 调度、引擎和应用边界

```powershell
node node_modules/vitest/vitest.mjs run tests/agent-call-scheduler.test.ts tests/agent-call-assembly.test.ts tests/engine-tools.test.ts tests/engine-inactivity.test.ts tests/auto-collaboration.test.ts tests/application-runtime.test.ts tests/codex-lifecycle.test.ts --maxWorkers=2 --reporter=default --reporter=json --outputFile=build/method-migration-boundary-tests.json
```

### 动态端口的契约消费者与新增受影响 IPC 单元

```powershell
node node_modules/vitest/vitest.mjs run tests/controlled-effect-service.test.ts tests/automatic-return.test.ts tests/repository-tool-core.test.ts tests/runtime-feeds.test.ts tests/controlled-file-service.test.ts tests/isolated-executions.test.ts tests/ipc-requests.test.ts tests/loop-engine.test.ts tests/business-run-storage.test.ts tests/run-admission.test.ts tests/execution-collaboration.test.ts tests/queue-insertion-boundary.test.ts tests/recovery-start-race.test.ts tests/replan-start-race.test.ts tests/artifact-report-service.test.ts tests/effect-observation-service.test.ts tests/knowledge-effect-service.test.ts tests/persistent-effect-service.test.ts tests/github-feedback-status.test.ts tests/queue-insertion-view.test.ts --maxWorkers=2 --reporter=default --reporter=json --outputFile=build/method-migration-contract-tests.json
```

未运行全量 CI、完整桌面冒烟、产品打包、安装升级或线上模型验收；不以本地定向通过替代这些后续门禁。未跟踪的 `.idea/` 保持原状。
