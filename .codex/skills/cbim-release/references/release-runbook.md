# 发布步骤

顺序：核实范围与签名 → 冻结构建 → 草稿候选验收 → 完整 CI／合并 → 公开 → 真实线上升级 → 官网／双分支收尾。恢复已有发布时从已核实阶段继续。以下命令在仓库根执行，变量必须来自本次实际回执；不是可以从头盲目执行的一整段脚本。

## 1. 范围、环境与签名

先读取 [发布指南](../../../../design/task/desktop-release.md)、[package.json](../../../../package.json)、[签名指南](../../../../design/task/windows-signing.md) 的当前决定及实现。签名指南中旧版同版本重发部分是历史方案，不继承其授权。

核实 `git status --short --branch`、diff、`git remote -v`、本地／远程分支、已有 PR、远端标签、Release 和 Actions。使用 `gh api user`、`gh repo view nan023062/cbim --json nameWithOwner,defaultBranchRef` 确认账号／仓库；保存旧 `releases/latest` 的 ID／标签作为独立 Python 通道基线。仅检查凭据身份、权限元数据，不输出凭据本身。

明确本次纳入的 Issue／提交；保留各 Issue 单独验证与提交。版本采用大于当前稳定桌面版的三段版本，更新 `package.json`、相关锁文件版本字段（如有）、`design/releases/desktop-v<版本>.md`。说明写实际功能、限制与签名状态，不提前改官网为未公开版本。

签名决策：

- 用户已明确未签名：记录依据，继续显式未签名路径，不重复要求其购买证书。
- 用户选择签名：核实构建账号的证书库身份／私钥可用性、有效期、信任链、SignTool、时间戳和发布者名称。存在 SignTool 不代表存在证书。当前适配为证书库 + SignTool；HTTP 签名服务或 `/dlib` 不能仅靠设置任意环境变量当成已支持。
- 选择不明且缺少签名条件：完成可独立进行的准备，说明当前缺什么并只澄清这一项；不能悄悄选未签名。
- 后续签名迁移：新版本号、同应用身份与通道、真实上一未签名版升级；验证新包应用／原生模块／安装器／卸载器签名、时间戳、发布者配置及数据保留。原未签名安装的 publisher 配置不会被远程补写；更换发布者名称另行核实兼容性，不关闭身份校验。

## 2. 本次检查与冻结

核实当前 Node／pnpm／锁文件要求和 [validate.yml](../../../../.github/workflows/validate.yml)。先运行类型、架构／依赖、品牌、官网构建及受影响测试；已有相同输入的证据可以引用，明确其提交。正式发行在公开前要求准确 PR head 的完整 Windows 四片；不要只看聚合绿色或定向诊断。

当前入口：`pnpm typecheck`、`pnpm check:architecture`（含依赖检查）、`pnpm check:brand`、`pnpm build:website`、相关 `pnpm exec vitest run ...`。测试输出保存在本次唯一证据目录，保留原失败，不覆写为成功。跳过项记录名称和真实前置条件，不能照搬旧版本的测试数量。

在 develop 提交已验证准备工作并冻结干净源码；保留人类作者与 `Assisted-by: Cindy (https://cindy.app)`。记录完整 source SHA。构建期间不能切换 HEAD 或并行改共享 Forge 输出；发现 `build/desktop-signing.lock` 先按锁中的 PID／命令／目录核实是否仍在构建，不能直接删锁重跑。

## 3. 生成并核验唯一候选

按明确选择运行其中一种构建：

```powershell
pnpm make:desktop
# 或已明确选择未签名时：
pnpm make:desktop --unsigned
```

从命令输出取本次候选目录，读取 `build-receipt.json`；不要猜最新目录。签名候选使用 `pnpm verify:desktop $releaseCandidate`，未签名候选使用 `pnpm verify:desktop $releaseCandidate --unsigned`。验证失败保留现场；重新构建生成新候选，禁止覆盖旧候选、补签已生成清单中的 EXE 或重用旧摘要。

对照真实实现核实：

- `sourceCommit`、版本、时间和 `packagedDirectory`；构建期间 git 状态未变。
- 资源摘要、PE payload 清单、签名模式、`app-update.yml`、内置日志与版本。
- `CBIM-Setup-<版本>-x64.exe`、对应 `.exe.blockmap`、`latest.yml`、`SHA256SUMS.txt` 四附件的大小、SHA-256、安装器 SHA-512 元数据。未签名元数据不得伪装 publisherName；签名模式实际重新验签，不仅检查布尔标记。

真实打包 EXE 隔离验证使用 [isolated-node-smoke.mts](../../../../scripts/isolated-node-smoke.mts)。显式将 `CBIM_TEST_EXE` 指向本次 `packagedDirectory` 下的真实主程序，`CBIM_ISOLATION_REPORT` 指向不存在的新报告路径，再执行 `pnpm exec tsx scripts/isolated-node-smoke.mts`，记录 EXE 摘要。不能让默认 `latest-build.json` 选择另一个包。覆盖文件边界、禁网、超时、取消、非零退出、输出限制及自有资源回收；结束后恢复本次设置的环境变量。

## 4. 在草稿中验证候选

**当前一体发布命令不会停下来等待安装测试。** 本流程先用 GitHub 原生 Release 接口分阶段暂存；所有制品校验仍复用 `verify:desktop`。不把 `pnpm publish:desktop` 当成草稿暂存命令，不发明不存在的参数，也不复制旧 `test-results/` 中硬编码 ID 的临时发布脚本。

1. 推送冻结源码；核实远端 source SHA。记录发行模式、账号、仓库、source SHA、tag、旧 latest 及四附件摘要到候选下本次唯一的追加日志。每次外部变更前记录意图，之后记录回包 ID 和读取核实结果；不记录凭据。
2. 用有草稿可见权限的身份分页查询同 tag。若已有 Release 或日志，转入 [恢复流程](failure-recovery.md)，不再次创建。不存在时创建唯一草稿：

   ```powershell
   gh release create $releaseTag --repo nan023062/cbim --target $sourceCommit --draft --latest=false --title $releaseTitle --notes-file $draftNotesFile
   ```

   `$releaseTag` 来自候选版本；`$sourceCommit` 是完整构建提交；说明文件明确“签名／未签名候选验收中”。读取 Release ID 并保存。创建后列表短暂缺失不是再次创建的理由。
3. 每个附件先核实远端状态，再上传确定缺失的文件。正常新版本使用 `gh release upload $releaseTag $assetPath --repo nan023062/cbim`，不加 `--clobber`；同名摘要不一致时停止调查，不覆盖。保存资产 ID、`state=uploaded`、大小和 digest，要求四附件全部与候选一致，不上传构建回执、签名配置或测试数据。
4. 验收前读 [desktop-release-acceptance.mjs](../../../../scripts/desktop-release-acceptance.mjs)。当前固定 0.1.1 作为旧版，并断言未签名和 0.x；先按本次真实上一桌面版／签名模式调整所需参数与断言、验证变更，再派发。**mode 不代表 signed/unsigned；不把固定旧版覆盖冒充上一版升级。** 首次发行若无上一版，明确不适用及原因，不生成虚构旧包。
5. 在无真实 CBIM 进程和卸载注册记录的隔离 Windows runner 执行。当前工作流命令模板：

   ```powershell
   gh workflow run desktop-acceptance.yml --repo nan023062/cbim --ref $validationRef -f version=$releaseVersion -f source_commit=$sourceCommit -f installer_sha256=$installerSha256 -f mode=candidate
   ```

   `$validationRef` 为实际包含已检查验收实现的分支或标签，记录派发时完整 SHA、输入、run ID／attempt；source_commit 是构建提交，不等于 workflow 代码提交。`gh workflow run` 受理不代表通过，不能只取列表中“最新一条”认领结果。工作流需要草稿读取所需的 `contents: write`，但只读取附件；GH_TOKEN／GITHUB_TOKEN 不得传入安装器或客户端。
6. 核验全新安装、正常启动／退出、真实上一版安装后升级、六项数据保留、实际签名模式、`isPackaged`、页面错误和模型请求。保存报告／截图；确定性模型一次完成对话用于检查无重放，不声称在线模型质量已验收。NSIS 静默退出成功不等于启动及数据保留通过。

## 5. 完整检查、合并与公开

创建／复用 `develop` → `master` PR，保留单 Issue 提交。检查 head SHA、base、工作流范围与四个完整 job，记录文件数、通过／失败／跳过及原因；单独诊断不够。正常 merge，不用管理员绕过或 squash；核实 merge receipt，并确认冻结提交可追溯至 master。

如果候选与最新验证／合并 SHA 不同，逐文件核对差异。只有 CI、验收脚本、外部文档等不进入产品和构建的变化可保留原候选，记录依据；产品代码、依赖／lockfile、打包脚本、配置、品牌和内置版本日志变化必须重新构建／核验。不能只凭“src tree 相同”判定制品不变。合并引入新变化时重验受影响部分。

公开前：

1. 再次运行候选对应模式的 `verify:desktop`，核实草稿 ID、tag、target、完整附件集合和摘要未变；并发变化立即停止。
2. 标签必须落在冻结 source SHA。现有标签用 peeled commit 比较；注解标签对象 SHA 不等于源码 SHA。若没有标签，在已授权发布范围内创建并正常推送唯一标签，记录回执；不强推、不移动旧标签。
3. 正文从候选内置版本日志加真实签名说明、构建与标签提交生成 UTF-8 文件。对**已核实 ID** 提交 Release 更新 JSON：`draft: false`、`prerelease: false`、`make_latest: "false"`、准确正文；用 `gh api --method PATCH ... --input <JSON文件>`，避免多行 shell 转义。写入意图和结果日志。分阶段已经存在的草稿不再调用一体发布命令。
4. 读取并核对公开 ID／tag／published_at、四附件和标签，确认旧 Python latest 不变；匿名获取公开 `latest.yml`、校验清单与安装下载地址，核实最终摘要。没有凭据的客户端必须能消费公开通道。

只有候选安装等门槛已经另有同一制品的有效证据、且没有待恢复草稿／日志时，才可使用一体 `pnpm publish:desktop $releaseCandidate`（未签名追加 `--unsigned`）。它的重新验签／摘要、草稿上传和旧 latest 保护不能代替完整 CI、安装或后续在线升级验收。

公开返回错误或超时：按 ID 查实态。已经公开且摘要正确就继续只读核验；仍为草稿则解决具体错误后再执行确认缺失的一步。不要因 404 重建 Release，或将 `--replace` 当成续传。详见故障与恢复。

## 6. 真实公开升级

再次核实验收脚本支持本次旧版／模式，用独立 runner 派发相同输入且 `mode=online`，关联正确 workflow SHA 和 run ID。

要求观察真实旧安装版：无 GitHub 凭据自动发现准确新版本 → 实际 UI 点击下载 → 下载缓存摘要匹配 → 普通退出并重开仍是旧版 → 从缓存准备更新 → 用户点击重启安装 → 真实更新进程完成并启动新版。IPC 状态可以辅助观察，不能用模拟下载或直接调用安装器代替本轮 UI 链。

核对新进程启动参数携带原测试用户目录（包括实际 `--updated`／`--cbim-user-data-root` 路径），等待窗口和用户菜单就绪再关闭；环境变量不一定跨 NSIS 重启继承。核对工作区、模型、同一个 completed task/run、localStorage、文件标记及无重放；页面错误为零，最后检查当前版本／更新状态和准确说明。保存失败状态／截图和原 run，不用后续成功覆盖它。

## 7. 官网、记录与双分支

线上升级失败则仍写“已公开但升级验收未完成”，先收集原因与现有安装状态，不继续宣称完整交付。公开缺陷不能通过悄悄替换附件修复；修复用更高版本。需要临时撤回时说明现有用户可能已下载的影响，按明确授权处理，不自动删除 Release／tag。

通过后同步：

- [website/release.json](../../../../website/release.json) 的 version、tag、publishedAt、repository、filename、bytes、sha256、signed 均来自公开回执／真实签名。不能用开发 package.json 或旧 Python latest 代替。
- 首页发布卡、下载页日志／FAQ／签名提示、README 和相关发布说明；搜索写死的旧版本和“新版尚未包含图标”等失效文字。签名迁移同时审阅提示文案，不能只把 signed 改为 true。保留 Search Console 验证标记、canonical、robots 和 sitemap；不重复提交收录申请。
- `pnpm check:brand`、`pnpm build:website`，再用 [website-smoke.mjs](../../../../scripts/website-smoke.mjs) 验证 320／390／1280 px、深浅色和独立离线两页（当前共 14 场景）、无溢出／页面错误、正确链接和摘要。脚本固定输出 `test-results/branding-website`；先保留已有报告，或在隔离检出运行，避免覆盖。只使用独立无头浏览器，不连接用户浏览器资料。
- 官网及收尾变更经 develop → master PR 检查、正常合并；[website.yml](../../../../.github/workflows/website.yml) 在 master 部署到既有 Pages。默认 develop 不改变部署分支，不放宽环境保护。核实 Actions 实际 head、目标 URL 与成功回执，再匿名逐文件对照 `index.html`、`download.html`、`404.html`、`robots.txt`、`sitemap.xml`、`cbim.png` 和本地构建字节／摘要。CDN 尚未更新时先只读复核。
- 将 master 的合并结果以 fast-forward 同步回 develop，核实本地／远端 SHA、默认 develop、远端仅 master／develop 和干净工作树。存在分叉或额外分支时先查差异与授权，不硬重置、不强推或自动删除未知工作；双分支收尾不是新的批量删除许可。
- 回填 [roadmap](../../../../design/tool-architecture-roadmap.md)、[开发记录](../../../../design/development-log.md)、版本报告及 PR；报告 [证据清单](evidence.md) 中的最终事实。普通安装版约启动 10 秒后及每 30 分钟检查，关闭／离线用户不会即时收到；下载和重启仍需用户操作。
