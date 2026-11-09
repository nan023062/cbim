# CBIM Desktop 0.1.2 发布与升级验收

日期：2026-11-09。版本已公开：[desktop-v0.1.2](https://github.com/nan023062/cbim/releases/tag/desktop-v0.1.2)，发布时间为 `2026-11-09T10:56:02Z`。本版按用户明确选择未签名发行；不等于可信发布者签名，也不代表所有终端已经收到或安装。

## 版本、源码与制品

- 纳入 #9、#11、#10、#12、统一品牌及 Windows LPAC 标准流兼容修复；#14 保留为独立任务。四个 Issue 的独立提交与各自测试证据保持。
- 冻结源码／标签：`5ebe82af0b7115bef07600a44697368d49833cf6`；[PR #15](https://github.com/nan023062/cbim/pull/15) 的完整检查提交为 `89dfdf017db51aa77d1ef15a5cbefa5f8b75fc33`，合并提交 `c9bb6799625dc41a1ccc5805be0f9c282d070b8b`。二者之间只增加验收／CI／诊断和记录，没有产品源码或构建输入变化。
- 安装包 `CBIM-Setup-0.1.2-x64.exe`：136079477 字节，SHA-256 `ae0b18cad81114e1dc9c8b03644bbec940a537699829ecb4bcb923d75548f675`。blockmap、latest.yml、SHA256SUMS.txt 与安装包共四附件，公开前后均核对远端摘要与大小。
- 构建回执：`build/desktop-release/0.1.2/unsigned-20261109-171427-d973710b/build-receipt.json`；发布日志同目录 `acceptance-publication.jsonl`。唯一草稿 ID `438932418` 完成验收后公开，没有重复创建、覆盖旧版本或移动旧标签；旧 Python latest 保持 `v1.0.2`。

## 实际验证

| 检查 | 实际结果 |
| --- | --- |
| 类型、架构、依赖、品牌与官网构建 | 完整 Windows CI 四片均通过，0 循环 |
| 发行模式与相关边界 | 7 文件 76/76 通过；默认签名、显式未签名、混用拒绝及制品篡改均覆盖 |
| [完整 CI](https://github.com/nan023062/cbim/actions/runs/42601920926) | 358 文件、2472 项；2470 通过，2 项原有历史 EXE 前置不足而跳过；0 失败 |
| 候选打包 EXE | 文件、禁网、超时、取消、非零退出、输出限制共六项通过，全部自有资源回收 |
| [隔离 Windows 候选验收](https://github.com/nan023062/cbim/actions/runs/42594569712) | 全新安装、真实 0.1.1 升级、未签名状态和六项数据保留通过 |
| [公开通道升级](https://github.com/nan023062/cbim/actions/runs/42605748518) | 0.1.1 自动发现 0.1.2、界面手动下载、缓存摘要一致、显式重启安装及最终版本通过；普通退出不自动安装 |
| 数据与运行保留 | 工作区、模型、原 completed task/run、本地存储和文件标记保留；唯一确定性模型请求，没有重放；页面错误 0 |
| 官网本地验收 | 品牌摘要和构建通过；320／390／1280 px、深浅色及独立离线页面共 14 场景通过，页面错误 0，下载地址和 SHA-256 匹配公开制品 |

本机证据在 `test-results/desktop-0.1.2-unsigned-release.json`、`desktop-0.1.2-isolation-packaged.json`、`desktop-0.1.2-ci-final/`、`desktop-0.1.2-candidate/` 和 `desktop-0.1.2-online/`；云端报告亦保存为对应 Actions artifact。安装与升级在没有真实用户安装的独立 runner 执行，没有卸载或覆盖开发者正在使用的客户端。

## 失败记录与原因

- 缺证书时默认构建正确返回 `SIGNING_NOT_CONFIGURED`，在产物／外部发布前停止。用户确认先未签名发行后，构建、校验、发布均要求显式 `--unsigned`；不继承残留环境选择，不自动降级，也不伪造签名回执。
- 候选验收首次因 read-only GitHub token 无法读取草稿而停止；修正草稿读取权限后，Windows PowerShell 5 与 runner PowerShell 7 的模块混用影响最后签名状态读取。测试环境改用 runner 的 pwsh，最终候选验收通过，原失败报告保留。
- 云端全仓 `42594576718` 出现终端超时与隔离执行 `RUNTIME`，独立全仓 `42597751602` 中终端原样通过，隔离仍失败。诊断 `42599879043` 确认缓存的 Electron 在测试前后均为 `nlink=2`，文件类型和 213976576 字节大小正常；本地及打包 EXE 为单链接。
- CI 按 [pnpm 10 导入方式](https://pnpm.io/10.x/settings#packageimportmethod) 使用复制导入，并预检程序及数据文件。相同缓存的后续诊断 `42600508914` 核实 `nlink=1`，原两项测试 2/2 通过，随后上述完整 CI 通过。产品保护、原断言和跳过条件未放宽；定向诊断使用独立 job 名，不冒充完整合并检查。
- 首次全仓的失败重跑曾停留在服务端尚未排队状态，取消／强制取消返回 409；没有把未知请求当作完成，后续新提交检查替代了旧请求。
- 复制导入后的全仓 `42600457181` 只有终端测试未通过，十秒时仍在运行；该用例验证输出／退出／隔离，没有产品启动时限要求。等待改为有界三十秒，保留十秒现场和最终状态，不重试命令。最终完整 CI 中本项实际耗时 2300 ms，真实退出码 0、预期输出和会话隔离均通过；此前超时的 Windows 内部原因没有独立定位，不将它写成产品缺陷修复。
- 首次公开草稿及补齐标签后的公开请求均返回 404，逐次按 ID 核实仍为草稿、附件未变，没有重复创建 Release。GitHub CLI 凭据缺少 `workflow` scope，冻结目标与默认分支的工作流不同会触发 [GitHub 发布权限要求](https://docs.github.com/en/rest/releases/releases#update-a-release)。已核实既有 Git 授权仍属于 `nan023062` 且具备所需权限，仅在本次发布进程复用；未更改登录设置或披露凭据，最终公开后重新核对全部附件、标签和旧 latest。匿名更新清单／校验文件验证见 `test-results/desktop-0.1.2-public-channel.json`。
- 线上首轮 `42604954985` 已自动发现新版，但验收脚本误将“软件更新”标题当作 region 名称，下载前定位超时。对照实际 0.1.1 与当前组件，改为在“版本与更新”dialog 中点击原下载按钮，并补失败状态／截图；没有修改已发布客户端或制品。该失败保留在 `test-results/desktop-0.1.2-online/desktop-0.1.2-online/failure.json`，最终线上结果见上方成功回执。

## 分发与后续签名

README 和官网下载快照已同步至本版，官网实际部署在记录提交合入 master 后执行；本地页面验证见 `test-results/desktop-0.1.2-website/website-report.json`。运行中的安装版在启动约 10 秒后及每 30 分钟检查桌面通道，也可从账号菜单检查；下载和重启安装分别由用户确认，关闭／离线的终端不会即时收到提醒。

本版真实签名状态为 `NotSigned`，可能出现 Windows 未知发布者／SmartScreen 提示。后续取得可信证书后保持应用标识、用户目录和更新通道，通过更高版本迁移；真实签名及其升级尚未验收，不保证签名后立即消除所有信誉提示。产品更新运行时未修改；本次发行脚本、CI、测试和文档都在 src 之外，无需修改源码类图。
