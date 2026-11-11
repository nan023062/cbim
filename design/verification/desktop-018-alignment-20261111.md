# 0.1.7 基线对齐与 0.1.8 候选验收

日期：2026-11-11（Asia/Shanghai）。状态：源码对齐与本地制品专项通过；全量回归运行中，真实安装升级尚未执行。

## 输入与变更范围

- 已发布 0.1.7：`desktop-v0.1.7`，实际提交 `f18c2fe9b2a189c1dc31f63d60de83a7b6d6833f`；安装包 SHA-256 `bad2f872f3c9dd5bbc3f4979feebd906656c5af340bc89592c29d53757d0ff86`。
- 原开发基线：`a5938170cf9675b69960dde6a9bb535eb845bdd8`，含本次规范、P0/P1/P2、完整 IPC 类型化与旧桌面脚本修复。原 1,690 个维护文件的哈希和 ZIP 已保存在 `test-results/desktop-018-20261111/`。
- 原工作区完整快照：`ae7798404d8b9c059da586ac6211b8db56807c55`；以此为第一父提交合并正式 0.1.7，保留两条历史，不以改版本号代替发布基线合并。
- 隔离候选分支：`acceptance/desktop-018-20261111`；候选目录 `test-results/desktop-018-20261111/candidate`。没有覆盖开发者安装的 0.1.7。
- 冻结构建提交：`23faa8bf73235793482cb615e4ef95de2a84c867`，父提交分别为上述整改快照与正式 0.1.7；已确认 `desktop-v0.1.7` 是其祖先。
- 用户直接维护请求，无对应新 Issue；不改写无关工单进度。发行模式沿用已授权的未签名本地验收，不代表已授权公开发布。

## 合并决策与维护入口

| 范围 | 最终选择及理由 |
| --- | --- |
| 0.1.7 用户功能 | 保留自动化、统一主 Agent 配置、隐式模块负责人、知识文件树和治理入口；新功能不能被旧整改分支覆盖 |
| 知识读取 | 保留整改的 `knowledge/read-models.ts` 公共入口与只读 `KnowledgeQueries`；自动化改为使用公共入口，刷新独立持有写端口 |
| 预算事务 | 保留 `RequestBudgetStore.readBudget/transactBudget`，在原唯一 DispatchStore 事务内投影；不暴露任务/岗位等写权限 |
| 引擎能力 | 保留 `EngineContext.capabilities` 与显式能力装配，统一工具目录和原生能力收窄；三引擎共享规则 |
| 执行展示 | 采用 0.1.7 更完整的 `execution-view`；原 `run-view` 退出，业务核实控制由 `tasks/ToolActivity` 组合 |
| IPC | 统一 172 项请求/响应映射，包含自动化 6 项、主 Agent 设置 2 项；泛型调用也拒绝额外顶层字段 |
| 自动化身份核验 | 先解析完整请求，再只把工作区/实例交给严格身份 Schema；定义与修订交原调度器，避免保存请求被错误拒绝 |
| 持久格式与升级 | 不另建数据目录或更改应用身份；0.1.7 的主配置/自动化经真实旧版 IPC 建立，升级后逐项比较 |

源码注释、相关 `CONTRACT.md` 与 28 份受影响目录类图已同步。三种宿主 Skill 保持同内容。完整冲突决策保留在证据目录的 `conflict-decisions.json` 与 `mechanism-decisions.json`，实际最终实现以 diff 为准。

## 已执行检查

- 定向回归：21 个文件 121 项。首次 4 项失败，修复自动化身份投影并适配两项旧测试后，受影响 3 个文件 34 项通过；合并去重为 121 项通过，不把复测重复计数。
- 类型检查：`pnpm typecheck` 通过。
- 架构检查：58 个目录、652 个源码/样式文件；1,268 个维护代码文件、6,550 条含类型依赖；资料漂移、循环、物理分层及逻辑违规均为 0。
- 主 Agent 配置 UI：真实 React + Application/IPC、隔离浏览器上下文的 9 项检查通过；包含多会话同步、引擎兼容过滤、草稿保留和重载持久。此项不冒充打包 EXE 或安装验收。
- 全量回归正在执行：`pnpm exec vitest run tests --reporter=default --reporter=json --outputFile=../regression-018-1.json`。最终结果另行回填，旧 0.1.5 测试不计为本候选通过。

## 0.1.8 制品与桌面专项

构建命令 `pnpm make:desktop --unsigned`，完成后用 `pnpm verify:desktop build/desktop-release/0.1.8/unsigned-20261111-233326-f1f7ed70 --unsigned` 重核通过。

- 候选目录：`test-results/desktop-018-20261111/candidate/build/desktop-release/0.1.8/unsigned-20261111-233326-f1f7ed70/`。
- 安装包：`CBIM-Setup-0.1.8-x64.exe`，391,317,752 字节；SHA-256 `170d53bd03122efb5684dade60217c6290497e082c222ed84335f2fc92154883`。
- 同目录有 blockmap、latest.yml、SHA256SUMS.txt 和本地 build-receipt.json；回执记录 47 项 Windows payload 及 3 项资源摘要。
- 安装器与打包 EXE 的 Windows ProductVersion 均为 `0.1.8`，实际 Authenticode 状态均为 `NotSigned`。
- 所有打包专项显式将 `CBIM_TEST_EXE` 指向同一 `build/unsigned-20261111-233326-f1f7ed70/CBIM Assistant-win32-x64/CBIM Desktop.exe`；使用独立测试数据与本地确定性模型服务。

| 专项 | 实际结果 |
| --- | --- |
| `runtime-smoke.mjs` | 通过；真实 IPC、知识预览/提交、岗位派发与独立图、停止/重开不重放、工作区移除隔离；3 次本地模型请求 |
| `automation-ui-smoke.mts` | 通过；三引擎、实际表单保存不执行、一次 Pi 运行与原会话、知识文件树预览及坏 JSON 拒绝 |
| `architecture-ui-smoke.mts` | 通过；四类资源、预览取消、团队继承、跨工作区导入、两张运行图不变及绑定隔离；6 次本地模型请求 |
| `agent-settings-ui-smoke.mts` | 9 项通过；真实 UI + Application，不是打包安装替代品 |
| `issue20-input-performance-smoke.mjs after` | 通过；100 轮/400 条 Markdown，逐键不重投影旧消息、草稿持久、失败保留、流式及输入并行。IPC 为明确的合成夹具，不宣称真实模型或用户设备性能 |

旧架构脚本针对已退役树节点/按钮和默认负责人文案，改为当前知识路径、明确选择新模块、当前自动解析语义；首次两次失败日志完整保留，第三次通过。输入性能夹具补齐当前主 Agent 配置协议与展示路径，失败后原范围复测通过。构建后的变化仅在这两份验收脚本和开发资料，不改变冻结产品、内置资源或构建输入。

上述原始日志在证据根目录；桌面 JSON 与截图在候选的 `test-results/`。此前 [0.1.5 本地报告](full-acceptance-20261111.md) 仅作历史记录，不用于本次升级结论。

## 安装验收边界

脚本支持实际 0.1.7→0.1.8，并保留全新安装、同路径 NSIS 升级、版本与未签名状态核验。数据断言包括完整模型目录、工作区身份、原已完成会话、localStorage、标记文件、知识文件及版本、业务文件、主 Agent 选型及修订、手动自动化定义与零重放。

本机已有用户 0.1.7，没有可用隔离 Windows；指定其他安装目录不能隔离 NSIS 注册表卸载行为。用户此前选择只做本地验收。实际隔离安装须另有可用环境或授权使用现有 GitHub Windows 验收入口；没有执行前不得写“安装升级与数据保留通过”。公开更新发现/下载/重启属于 `mode=online`，与候选安装升级分开记录。
