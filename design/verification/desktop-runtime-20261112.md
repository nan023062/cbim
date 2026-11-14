# C/R/E 桌面更新重构验证（2026-11-12）

> 导航维护说明（2026-11-14）：正文保留当时的路径、结论与验证边界；可点击源码链接已更新到当前归属，仅供导航，不作为历史版本证据。未留存的阶段入口另行注明，不伪造源码或制品归档。

## 结论与范围

已在 `95458460` 的侧栏更新入口之后接通固定冷壳、资源包切换和独立引擎包。相关单元、真实 App 浏览器交互、隔离 Electron 的 R1 → R2 路径、类型和依赖/架构检查通过。没有发布新冷包或 R/E 通道，没有替换用户安装，也没有执行完整 CI、正式 NSIS 安装或公开升级验收。

需求来自用户直接授权；开放 Issues 查询为空，未创建或回填工单。UI 与更新架构独立提交。本记录中的时间和体积只对应本地隔离样本，不作为正式安装版性能承诺。

## 受影响单元

按真实调用链分批使用 `pnpm exec vitest run`，显式指定以下文件；没有运行无参数全仓测试。表内是最终通过的文件范围，重复执行不累加为新用例。

| 选择依据 | 最终通过的文件（均在 `tests/`） |
| --- | --- |
| 清单信任、路径、下载、解压、缓存、激活日志及 C/R 通道 | `runtime-manifest.test.ts`、`runtime-download.test.ts`、`runtime-store.test.ts`、`runtime-journal.test.ts`、`runtime-updates.test.ts` |
| 冷输入指纹、不可变 ZIP、生产签名边界 | `runtime-packaging.test.ts`、`desktop-signing.test.mjs` |
| E 私有装配、真实 SDK/EXE、会话固定及 Codex 的 Pi 工具依赖 | `engine-runtime-binding.test.ts`、`engine-runtime-loader.test.ts`、`claude-packaging.test.ts`、`codex-packaging.test.ts`、`claude-engine.test.ts`、`codex-engine.test.ts`、`codex-tools.test.ts`、`pi-loop.test.ts` |
| 保留唯一显式安装授权、业务排空、后台恢复及 UI 资格 | `desktop-updates.test.ts`、`desktop-update-lifecycle.test.ts`、`update-button-state.test.ts` |
| 新缓存根不能成为业务工程、资源仓库或受控写入目标 | `path-contract.test.ts`、`resource-repository.test.ts`、`controlled-file-service.test.ts`、`artifact-transition-runtime.test.ts` |
| 冷壳计算式装载仍计入真实依赖图，不隐藏循环或缺失入口 | `dependencies.test.ts` |

重点覆盖：篡改签名、过期元数据与离线已安装版本、C/平台/指纹不符、ZIP 路径穿越与链接、大小写别名、文件集合/长度/摘要不符、取消及临时目录清理、普通退出不激活、加载前失败隔离、数据访问后拒绝自动降级、显式重试保留访问事实、清缓存或丢失日志不能重置为 R1、不同 E 拒绝旧原生会话恢复。

最后补测的准确命令为：

```text
pnpm exec vitest run tests/engine-runtime-loader.test.ts tests/claude-packaging.test.ts tests/codex-packaging.test.ts tests/runtime-packaging.test.ts
```

结果：4 文件、5 项通过。实际固定版本 Pi 工具读文件、Claude 独立 SDK、Codex 独立原生程序均可从明确 E 根装载；不兼容的声明版本拒绝。新增 JS worker 的装配配置不单独改变冷指纹，固定 bootstrap 或原生输入变化仍改变指纹。

中间修正：Windows 只读句柄 `fsync` 的 `EPERM` 改为重新以 `r+` 打开后 flush；类型夹具修正字面量/可空返回；依赖检测用例对齐真实 `generated-dynamic/require` 分类。修正后只重跑对应文件/失败选择器，最终均通过。未把夹具错误当作产品行为证据。

## 真实界面与隔离切换

`node scripts/desktop-updates-ui-smoke.mjs`：11 组真实 App 浏览器检查通过，0 页面错误。覆盖原主题入口保留、更新项迁移、悬停/键盘 tooltip、引擎准备可见但无安装权限、传输完成不等于 ready、满环呼吸/减少动态效果、窄屏、草稿与焦点保留、显式一次安装、失败后重新点击以及 C/R 提醒身份。该脚本使用隔离 IPC fixture，不执行真实安装器。

`pnpm exec tsx scripts/runtime-update-smoke.ts`：编译实际 bootstrap/main/preload/renderer，使用内存生成的测试 Ed25519 身份和独立目录，以 fixture 网络及安装身份启动真实 Electron 窗口。10 项检查通过，0 页面错误：

1. 已签名 R1 正常启动，显示窗口前没有引擎下载。
2. 后台展开并校验 R2，当前版本仍为 R1。
3. 普通退出并重开仍为 R1，不写激活授权。
4. 点击侧栏就绪图标，完成业务排空后请求重启。
5. 新进程真实加载 R2 的 main/preload/renderer，确认日志推进，原用户目录及数据标记保持。

本次样本 R ZIP 为 **4,002,757 字节（约 3.82 MiB）**，三次窗口就绪记录为 2186 / 2152 / 2150 ms。该样本为隔离配置和固定本地下载响应，没有真实 NSIS、公开网络更新服务或模型执行；不能据此声称用户真实升级只需约两秒，也不能据此替代完整工作区/会话升级验收。

本地证据保留在忽略目录 `test-results/`：`runtime-update-smoke.json`、`desktop-updates-ui-report.json`、`runtime-ready.png`、`runtime-r2.png` 及图标明暗/窄屏截图。未把测试私钥写入仓库、报告或发布包。

## 静态检查与维护交付

- `pnpm typecheck` 通过。
- 新增 CLI 未全部被原 tsconfig 收录，另执行 `pnpm exec tsc --noEmit --target ES2022 --module ESNext --moduleResolution Bundler --strict --esModuleInterop --skipLibCheck --types node scripts/make-resources.ts scripts/make-engines.ts scripts/publish-runtime.ts scripts/verify-runtime.ts scripts/verify-cold-payload.ts scripts/runtime-update-smoke.ts`。首次发现隔离验证脚本缺少浏览器全局类型和环境字典类型；补齐真实契约类型引用、过滤未定义环境值后通过。没有运行发布命令进行验证。
- `node scripts/source-architecture.mjs` 同步实际结构；随后 `pnpm check:architecture` 通过：87 个目录、681 个源码/样式文件，1340 个受检文件、6799 条依赖，0 循环、0 边界违规。后者包含依赖检查；最后新增脚本类型依赖后按实际变化复查，未无理由重复执行。
- 同步 bootstrap、updater、engines、main 及 assembly/file-operations/platform/resources、core/execution/foundation、scheduler-engine/assembly、bridge/contracts、frontend/updates 的文件头、关键端口说明、契约和受影响类图/父层导航。
- 架构维护与发布入口的 `.agents`、`.claude`、`.codex` 三份内容同步。新 bootstrap → main 计算式依赖显式进入审计，不以动态加载规避层级或循环检查。

阅读顺序：[方案及新旧流程](../task/desktop-hot-update-design.md) → [bootstrap 契约](../../src/bridge/server/bootstrap/CONTRACT.md) → [更新契约](../../src/logic/updates/service/CONTRACT.md) → [引擎契约](../../src/logic/execution/engines/CONTRACT.md) → [候选构建与发布](../task/desktop-runtime-release.md)。调整业务 JS 改 R；调整兼容引擎及会话边界改 E 装配；固定入口、原生基础或信任根变化改 C。

## 首次投放及未验收部分

旧安装必须先进行一次新的冷更迁移，才具备 R/E 消费能力。生产构建要求配置发布者持有的 Ed25519 私钥，公钥固定在冷包；这与 Windows Authenticode 是不同身份。此次没有生成生产密钥或提高公开版本号。

正式投放仍需冻结准确提交、完整 CI/审阅、唯一冷候选、真实安装/旧版升级、真实 R/E 兼容及公开附件回读；新冷包发布前必须保证初始 E 已可下载。`publish:runtime` 目前仅为手动外部写入工具，没有内置全套 CI/人工审核门禁；同 C 发布必须跨机器协调串行，不能将本机锁视为分布式原子发布。

首版采用完整 R/E ZIP，不实现文件或块差分、主进程 HMR、纯页面独立 reload、缓存自动回收、跨 C 共享 E 或跨 E 会话迁移。E 首次使用需要网络；旧会话 E 不兼容时保留历史并要求新建会话。已访问原数据的候选失败只重试同一候选，不承诺自动降级修复数据。旧 NSIS 已有差分，因此本轮收益主要是免安装、预展开和窗口优先，不能承诺每次传输字节都更小。
