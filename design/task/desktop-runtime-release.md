# C/R/E 更新构建与发布

2026-11-12：实现运行说明。源码已接通；没有在本次开发中发布新冷包、公开 R/E、安装用户客户端或完成正式 CI/升级验收。本地证据与限制见[专项验证记录](../verification/desktop-runtime-20261112.md)。

## 制品与身份

| 制品 | 内容与触发条件 | 入口 |
| --- | --- | --- |
| C | 固定 bootstrap、Electron/Node/Chromium、koffi、安装配置和资源验签公钥；这些输入变化时提高三段 code 版本 | `pnpm make:desktop [--unsigned]` |
| R | 编译后的 main/preload/worker/renderer、纯 JS 闭包及 design/docs/legal；同 C 的整数 resource 版本递增 | `pnpm make:resources <基线候选目录> <R> <日志文件> [新E候选目录]` |
| E | 已安装、预编译的 Pi/Claude/Codex 生产依赖闭包和平台程序；用户端只解压使用 | `pnpm make:engines` |

普通 R 构建复用锁定 Forge 的 Vite 配置生成器，只编译脚本，不打 Electron 或 NSIS，也不复制/重新编译引擎。冷构建同时生成离线 R1 和独立 E 候选，但安装器不携带 E。已有 E 默认复用基线签名描述；E 更新显式提供新候选，再用递增 R 固定新组合。纯 E 变更可复用内容相同的 R 缓存，不必提高 C。

客户端只支持 Windows x64。E 随当前 R 固定，适配器还限制已验证版本；不是自动追踪上游 latest。主窗口不等待 E；首次使用在侧栏更新图标 tooltip 显示包版本、下载/校验进度或错误。E 准备成功不授予 C/R 安装资格。退出/安装排空前取消未完成 E 下载，避免工厂关闭等待下载超时。

## 冷基础与签名

`CBIM_RUNTIME_SIGNING_KEY` 指向发布者保管的 Ed25519 私钥文件。只把对应公钥写入 C，不把私钥放进仓库、ZIP、日志、界面或测试报告。生产流程不临时生成身份；缺配置直接拒绝打包。

资源包签名和 Windows Authenticode 独立。即使 Windows 安装包显式采用 `--unsigned`，R 清单仍必须签名。资源签名不能使 Windows 显示受信任发布者，也不保证消除 SmartScreen。公钥轮换走新 C，旧 C 不信任新的私钥。

R 构建重新计算固定 bootstrap 产物、实际 Electron 版本、koffi 文件表、安装/构建配置和应用身份的指纹，必须与冷包基线一致；主进程业务 JS 和独立 E 不参与该指纹。改变冷输入会报 `COLD_BASE_CHANGED`，不能手改基线或提升 R 绕过。

冷构建输出的 `runtime/` 包含 `runtime-cold.json`、签名 `latest.json`、完整 R ZIP 和三个 E ZIP；`bundled-resources/` 与 `runtime-initial.json` 放入安装器，app.asar 只保留固定启动器与冷元数据。R-only 输出保留相同公钥/指纹和自己的签名清单。

## 验证与投放顺序

以下命令只是工具入口，不代替公开发布授权、准确提交的完整 CI、代码审阅、隔离安装或真实升级验收。

1. 冻结干净源码、版本/日志、签名身份和唯一候选目录。先验证冷/热边界；改变 native/安装身份就走 C。
2. 新 C 构建沿用已有签名模式与四附件流程，同时得到 runtime 候选。R-only 以此前冻结的 runtime 候选为基线；E-only 先制作 E 候选，再制作引用它的 R 清单。
3. 执行 `pnpm verify:runtime <候选目录>`。本地 ZIP 或原固定公共源的 E 都使用客户端同一长度、摘要、解压和完整文件集合校验器；临时验证目录不包含用户数据。
4. 在隔离 Windows 上用固定 C 验收 R1→R2/跨 R、普通退出取消、真实候选激活、原数据/草稿、工作区恢复与任务不重放。新 E 还必须验证真实适配器/原生历史和权限；本机 stub 或版本号检查不代替兼容验收。
5. 经既有发布门槛与授权后，`pnpm publish:runtime <候选目录>` 向 `nan023062/cbim` 投放。脚本核对登录为 `nan023062`、源码提交、签名和全体制品；先追加按 SHA-256 命名的 R/E ZIP 并公开回读，最后更新可变 `latest.json`。同 C 的发布必须串行；本地锁不构成跨机器分布式锁，远端二次核对也不是原子 CAS。
6. 新 C 公开安装器前核实初始 E 已在固定源可读。`publish:desktop` 增加该检查，原签名、草稿安装、PR/CI、公开升级和官网流程继续适用。旧客户端先完成一次 NSIS 冷更，之后才能消费 R。

资源通道标签为 `runtime-c<C>`，引擎附件共用 `runtime-engines`，两者均为 prerelease、`latest=false`；旧 desktop-v 客户端不会把资源包当安装器。ZIP 不覆盖，清单可以从 R1 直接升级 Rn，不依赖逐个补丁链。发布不覆盖旧 desktop-v 安装附件。

`publish:runtime` 是外部写入工具，当前没有内置完整 CI/审阅/真实热更验收门禁；只能在上述证据完成且已获发布授权后运行。上传失败先核对远端事实，不删除已验证附件重发；只有完整回读后才能报告通道成功。

## 启动、恢复与边界

下载缓存：`%APPDATA%/CBIM-runtime/<安装及用户身份>/<C>/`，含 staging/packages/manifests。激活日志：原 `userRoot/desktop-runtime/<身份>/<C>/`。两者分开，清理代码缓存不会把已升级用户当成首次启动。

每次 R 准备在后台下载、展开、校验新目录，普通退出不应用。只有 ready 的显式点击会排空业务、写激活票据、短重启；重启阶段不运行安装器。新 R 窗口加载及 React 的目录请求成功后确认，工作区另行恢复。

未放行候选访问原数据时，坏包可隔离并回退。已访问数据或状态未知时，独立恢复窗口只允许退出/重试同一候选，不能自动旧代码读新数据。显式重试保留曾访问数据的事实；日志损坏、见证存在但记录缺失、确认资源缺失也不能默认 R1。日志 flush/改名/回读已覆盖进程中断的保守判定，未承诺所有断电、磁盘控制器或恶意本机账号模型。

原生会话旁路记录固定 E 及 Pi 辅助工具摘要；不同 E 恢复旧会话会在 SDK/EXE 启动前拒绝，提示保留历史并新建对话。首版不自动选择旧 E、不迁移跨 E 历史。旧整包迁移只接受原来三个已验证版本。

当前选择完整小型 R ZIP、完整按需 E ZIP。未实现文件/块差分、页面独立 reload、主进程 HMR、旧版本缓存自动回收、跨 C 共用 E 缓存或跨 E 会话迁移。首次引擎下载仍需网络；R/E 缓存与失败恢复不能替代用户数据备份。旧 NSIS 已有差分，因此新方案的主要收益是免安装与窗口优先，不能保证每次下载字节更少。

维护入口：[bootstrap 契约](../../src/backend/bootstrap/CONTRACT.md)、[更新契约](../../src/backend/updater/CONTRACT.md)、[引擎契约](../../src/backend/engines/CONTRACT.md)、[方案与取舍](desktop-hot-update-design.md)。
