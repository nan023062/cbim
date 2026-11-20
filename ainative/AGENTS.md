# CBIM AI 协作统一入口

本文件是本仓库各 AI 工具共用的入口提示文档。工作流正文及配套资料统一维护在 `ainative/skills/`；代码路径与命令以仓库根目录为基准，Markdown 相对链接以所在文档为基准。

## 必读规范

开始工作前，**必须读取并遵守**：

- [05《代码阅读设计及编码规范》](docs/05-代码阅读设计及编码规范.md)
- [06《架构设计原则和工程结构规范》](docs/06-架构设计原则和工程结构规范.md)

代码、注释、工程结构和架构原则只在上述文档维护。AGENTS.md、CLAUDE.md、工作流 Skills 及其配套资料仅引用规范，不复制正文或建立平行规则。已核实且未变化的上下文可复用；规范更新不自动授权修改产品代码。

## 工作流入口

按本次任务使用对应工作流；只读分析或计划讨论不自动进入实施，已有授权内不逐步重复请求批准。

| 工作流 | 用途 | 共享正文 |
| --- | --- | --- |
| cbim-development | 从 Issues 推进开发、验证和回填 | [开发流程](skills/cbim-development/SKILL.md) |
| architecture-evolution | 架构调查、方案比较和渐进治理 | [架构演进](skills/architecture-evolution/SKILL.md) |
| architecture-maintenance | 源码说明、架构资料同步与认知交接 | [架构维护](skills/architecture-maintenance/SKILL.md) |
| cbim-release | 桌面发布、制品验收和中断恢复 | [发布流程](skills/cbim-release/SKILL.md) |

先按任务选择工作流，再完整读取其共享正文；按流程需要读取配套资料。工具入口中的名称与简介用于发现，不替代工作流正文。

[GitHub Issues](https://github.com/nan023062/cbim/issues) 是开发清单与实时进度的唯一来源；每个 Issue 独立开发、验证和提交，并在已有授权内回填。旧方案、历史记录和个人草稿不自动成为当前任务。执行细节沿工作流维护，验证事实记录在 Git 提交及关联 Issue／PR。

## 文档分层

`ainative/docs/` 独立维护概念设计、标准规范与准则，不引用或依赖 `design/` 文件。`design/` 只保存产品目标、核心取舍、未落地设计和原型；开发与发布操作沿现有项目 Skill 和工具入口维护；验证事实记录在 Git 提交及关联 Issue／PR，发布正文由构建显式输入，不另设工程资料目录。已完成的旧切片和历史验证报告按其入口记录的固定 Git 版本追溯，不持续堆积本地副本。运行资产归 `assets/`，可引用 `ainative/docs/`；项目实施细节不得反向成为通用规范的前置依据。当前实现说明仍随 `src/` 维护。

`assets/` 只保留实际读取、引用或打包消费的资源，包括品牌图像与生成摘要。内置 Skill、运行规范和 Schema 作为代码常量归入各自业务模块，由代码显式导入并随业务编译发布，不再从 assets 文件加载。资源身份按真实消费者判断，不按扩展名判断；面向维护者的 README、操作说明和开发记录不放在 assets 中，必要入口在根 README、已有项目 Skill 或对应源码说明维护。

## 工程阅读与操作入口

- 当前实现从 [src 整体架构](../src/ARCHITECTURE.md) 下钻；产品目标与未落地方案从 [design 导航](https://github.com/nan023062/cbim/blob/7dcff4142e09fdac1a670438bd3081d6c0341f23/design/README.md) 阅读。
- 分层与导入许可核对 [依赖检查器](../scripts/check-dependencies.mjs) 和 [边界登记](../scripts/architecture-boundaries.mjs)；类型引用和动态装配均需纳入实际影响分析。
- 构建入口调整先核实固定输出名、用户数据和恢复兼容要求；发布与真实升级验收沿 cbim-release 执行。

## 日常验证范围

以下只定义工程命令与执行安排；设计和编码判断仍引用 05、06。

- **登记与选择：** 测试归属登记在 `tests/modules.json`。增删、移动测试或调整导入、夹具时同步登记并运行 `pnpm check:test-modules`；未知模块、空选择、未登记测试不得退回全仓执行。工程级测试登记为 `project` 的 `integration`，不缓存。
- **增量执行：** 先用 `pnpm test:incremental --list` 或 `--json` 查看选择原因，再运行受影响模块；`pnpm test:module --module <模块>` 默认只运行单元并复用有效回执，`--force` 强制执行，契约／集成另显式选择 `--kind contract` 或 `--kind integration`。
- **回执有效性：** 记录位于忽略的 `test-results/module-tests/`，不提交 Git，也不作为 CI 证据。实现、契约、测试、夹具、环境或配置变化使相关回执失效；失败、中断、零用例、全跳过或执行期间输入变化不能记录成功。
- **契约与动态输入：** 独立契约用 `contract: {files, revision}` 登记，行为变化同步正文或版本；未声明独立契约时按实现闭包保守传播。动态文件在 `inputs` 登记，不可固定的外部状态使用 `cache: false`；真实契约验证追踪实现，集成不缓存。
- **执行范围：** 根据实际 diff、调用方和契约选择受影响单元及消费者，执行前说明依据。通过后收尾；只有新改动、失败或新增影响证据才补跑。避免无参数的 `pnpm test` 或 `pnpm exec vitest run`，不为保险自动升级为全仓测试。
- **静态检查：** 按下表选择；`pnpm check:architecture` 已含依赖检查，不重复执行。检测器或分层规则改变时才加跑其对应单元。
- **集成与发布：** 全量回归由既有 [PR 验证](../.github/workflows/validate.yml) 按 [CI 分流](../scripts/ci-scope.mjs) 执行；桌面、打包、安装升级验收沿发布流程完成。保留生产构建对测试加载、chunk 依赖和制品暂存的检查。用户明确要求专项验收时按其范围执行。
- **记录结果：** 提交及已获授权的 Issue／PR 写明选择理由、实际命令、结果和未运行范围；开发验证、人工 review、合并及发布状态分别记录，不以旧报告代替本次证据。
- **纯文档与 Skill 修改：** 只核对事实、格式、引用和多入口一致性，不运行产品测试、类型检查或构建。

| 实际变化 | 工程命令 |
| --- | --- |
| 需要重排源码 | `pnpm format:source`；只读检查用 `pnpm check:source-format`，原因可用 `--json` 查看 |
| 方法声明或命名变化 | `pnpm check:method-names`；协议固定名称按检查器的精确登记处理 |
| 类型或公共接口需要编译验证 | `pnpm typecheck` |
| 导入、路径或模块边界变化 | `pnpm check:dependencies` |
| 架构关系或模型变化 | `pnpm check:architecture`；需要更新生成区域时使用 `node scripts/source-architecture.mjs` |

## 单一来源与工具接入

- 概念和规范只在 `ainative/docs/` 维护；统一协作与验证安排只在本文件维护。
- 工作流正文和配套资料只在 `ainative/skills/<名称>/` 维护；修改已有流程无需同步复制到工具目录。
- 根目录 [AGENTS.md](../AGENTS.md) 与 [CLAUDE.md](../CLAUDE.md) 只负责引导工具读取本文件。
- `.agents/skills/`、`.claude/skills/`、`.codex/skills/` 只保留工具发现所需的名称、简介及指向共享正文的入口。新增、重命名或调整发现简介时核对这些入口；不在其中维护流程或配套资料副本。
- 新工具按其原生入口格式引用本文件和共享 Skills；校验引用路径与读取结果后接入，不能将仅有链接视为已经加载正文。

这些工作流只服务本仓库开发，不自动改写产品内置业务 Skill。
