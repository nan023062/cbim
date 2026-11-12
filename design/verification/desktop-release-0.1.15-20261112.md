# CBIM 0.1.15 分层更新首次发布验收

日期：2026-11-12。用户授权完成侧栏更新入口、按桌面更新设计重构，并要求发布后重跑在线升级。真实上一公开桌面版为 0.1.14；本轮冷包为 C 0.1.15 / R 1。用户提到历史 0.1.0 → 0.1.1；核实 0.1.0 标签代码后确认它按最高稳定版本选择，当前会直接选择 0.1.15。因此除上一版外增加独立的 0.1.0 → 0.1.15 验收，不改变旧包或公开通道，不将结果冒充历史 0.1.0 → 0.1.1。

## 范围与冻结

- 仓库/账号为 `nan023062/cbim` / `nan023062`，默认分支 develop，稳定分支 master。开放 Issues 为空，按直接授权实施，没有新建工单或吸收其它未授权工作。
- 纳入侧栏图标 `95458460`、C/R/E 架构 `2187842f`、已在 develop 的 Codex 中断登记及聊天恢复 `34afe7c7`，保留独立提交。合并冲突仅涉及注释与开发记录，保留双方行为及记录。
- 冻结构建提交为 `ca0f75992b17b918302a8c066af9afcd8e547e96`，唯一候选为 `build/release-015/build/desktop-release/0.1.15/unsigned-20261112-193123-7bd6a308`，构建时间按 Asia/Shanghai 记录。
- 构建与复核使用 `pnpm make:desktop --unsigned`、`pnpm verify:desktop <候选目录> --unsigned`，12 个 PE payload、冷壳与初始 R1 均通过。Windows 发行沿用此前明确的未签名选择，实际为 `NotSigned`，资源签名不替代 Authenticode。
- 资源发布使用长期 Ed25519 身份；私钥保存于仓库外 `%LOCALAPPDATA%/CBIM/release-keys/runtime-ed25519.pem`，目录 ACL 仅当前 Windows 用户与 SYSTEM。公开 SPKI DER SHA-256 为 `378c827bf38efb6724466bbb39d3e39ee4ef2dc1de2576fa1fde760443145c49`。私钥未写入源码、日志、制品或远端；后续兼容 R 发布必须妥善保管同一身份，轮换公钥需要新 C。
- 后续验证提交仅改变 `tests/layer-boundaries.test.ts`、`scripts/isolated-node-smoke.mts` 和 `tests/codex-interruption.test.ts`，没有改变产品、依赖、构建配置、品牌或内置资源。保留同一候选，不用测试提交假称构建来源。

## 本地与候选验收

本次合并消费者检查为 5 文件/13 项，覆盖 Codex 生命周期、引擎绑定和前端恢复；验收输入检查 42 项。类型、架构/依赖、品牌及官网构建通过。此前专项的 UI 11 项、隔离 Electron R1 → R2 10 项及安全边界回归见[架构专项记录](desktop-runtime-20261112.md)，它们不替代正式安装或公开通道。

本候选实际 `CBIM Desktop.exe` 的 SHA-256 为 `afe4eca750ccfa4434c4bbe08bda7e4139e00e622fe7f3d89fceecc83d2d4be0`。六项 Windows 隔离场景通过：文件边界、禁网、超时、取消、非零退出、输出限制；自有资源回收通过。实际 worker 来自本包 `bundled-resources`，验证脚本修正了原 app.asar 路径假设，执行脚本、差异与摘要单独保存在候选证据中。

[候选安装 run 43212888739](https://github.com/nan023062/cbim/actions/runs/43212888739)，workflow head 为 `cad4fcf051a519eee95d3c91e5f9d7b248b82976`，source 仍为上述冻结提交，`mode=candidate`、`previous_version=0.1.14`。隔离 Windows runner 没有真实用户安装；未在开发者工作站运行 NSIS。

- 全新安装、正常启动/退出、原安装器生成的差分缓存摘要通过。
- 全新 profile 从固定公开源下载真实 Pi 1.5.0 E，15,338 个文件逐项核对长度与摘要，并完成一次确定性模型请求；没有手工填缓存或给客户端 GitHub 凭据。
- 实际 0.1.14 安装后覆盖升级到同一 0.1.15 候选，原工作区真实恢复，工作区、模型、知识/修订、业务文件、同一已完成 task/run、localStorage、用户标记、主 Agent 配置/修订、自动化定义均保留。
- 迁移场景模型请求恰好 1 次，全新场景另 1 次；没有任务重放，页面错误 0。确定性模型用于核对执行与恢复，不代表用户线上供应商质量。
- 新图标 tooltip 显示 `C 0.1.15 · R 1`，实际 `isPackaged=true`、`NotSigned`。

## CI 失败与修正

- [43209853130](https://github.com/nan023062/cbim/actions/runs/43209853130)：第 4 片独立层级测试遗漏新增 bootstrap；其余三片通过。补齐 bootstrap → bootstrap/main/updater 的真实允许边界，其它分层限制保留；相关 2 项与架构检查通过。
- [43212374059](https://github.com/nan023062/cbim/actions/runs/43212374059)：第 1 片两个 Codex 中断用例在默认 1 秒轮询窗口到期时尚无模型请求，其余三片通过。测试等待改用原 fixture/应用回合时限，精确请求次数、会话身份、单次工具执行及无重放断言保持不变；定向 5 项通过。没有修改产品超时或加入重试掩盖失败。
- 新完整 CI 为 [43214483203](https://github.com/nan023062/cbim/actions/runs/43214483203)，head `42e6d73b529f502635ec00166273c5a2b4290154`。完整四片全部通过：422 文件、2841 项，2839 通过、0 失败、2 跳过。跳过为 owner-execution-legacy 与 knowledge-source-lifecycle-application 两个固定历史 EXE 场景，runner 缺少其固定历史包，非新增跳过。PR #59 正常合并为 ca7999abb3c991362e31b5ecbf576ec0528e8113，合并相对冻结制品仅有上述三处验证文件差异。

## 制品与资源通道

[公开桌面版](https://github.com/nan023062/cbim/releases/tag/desktop-v0.1.15) Release ID 为 442863050，公开时间 `2026-11-12T12:30:19Z`。标签指向冻结 source；四附件从草稿、候选安装至公开保持同一 ID、大小和摘要。匿名元数据/清单/blockmap 的完整字节与安装器 HEAD 核验通过，旧 Python latest 保持 `327801733 / v1.0.2`。

| 附件 | Asset ID | 字节 | SHA-256 |
| --- | --- | --- | --- |
| CBIM-Setup-0.1.15-x64.exe | 739260840 | 111828931 | `b9a8ecbf29e2a285f2dd963fad5379f306f7c4fba9e11bc35ff9eeefee019a69` |
| CBIM-Setup-0.1.15-x64.exe.blockmap | 739261437 | 118526 | `40b0d43f8b981fd5549e65eee4ac53d3e6cdce618cb35bd800c566772b5d185e` |
| latest.yml | 739261582 | 348 | `0cf0acc45c0648652ba1a813ca592de03ded5f5d8e9eeb8d277aa8f93b1962e2` |
| SHA256SUMS.txt | 739261729 | 270 | `760a069c58d5b34ee6860c9e51cd106f0501f95501f3652e7eaddc249c1064fb` |

初始 R1 ZIP 为 3,947,616 字节，SHA-256 `3d5f9c3f536bb482616efa3dd646d0bd4f29566b8145bc731db1bfd233e35134`；签名清单 payload 摘要为 `3154d565f3f9986f3fda48857078989370736f21a4e0f486bd76d7a454ad6849`。R ZIP 大小不包括 3,706,719 字节的签名清单及首次 E 下载，不能把该 ZIP 大小当作完整更新网络流量。

资源通道 [runtime-c0.1.15](https://github.com/nan023062/cbim/releases/tag/runtime-c0.1.15) 为公开 prerelease / latest=false，Release ID 442909771。`publish:runtime` 先核验本地 R/E，上传 R，并逐项回读公开 R/E，最后才上传 latest.json。首次上传后的立即清单回读报“无法读取更新附件”；远端事实已显示清单和全部附件到位。没有重跑上传或覆盖附件，单独使用客户端同一 `downloadRuntimeManifest` / `verifyRuntimeManifest` 回读，于 `2026-11-12T12:29:43.197Z` 匿名验签成功。原命令没有输出 HTTP 状态，因此不把某一种网络原因写为已证实。

E 先追加到公开 prerelease `runtime-engines`（Release ID 442866980，latest=false），以便全新候选真实下载；不改变稳定桌面通道。三个 E 的公开字节已完整匿名下载并核对长度/SHA-256，对应本地 ZIP 与文件集合此前通过客户端同一 `RuntimeStore` 验证器：

| E | 字节 | SHA-256 |
| --- | --- | --- |
| Pi 1.5.0 | 32293667 | `34a35b2057f86350d0756e6ef1843915c941a8da4a0e6631791277a9351ce431` |
| Claude Code 0.3.322 | 170459775 | `8ad7cc49eae38aa454d477a116c4c71ad967e6f22f76698ac650db1a4d1c287e` |
| Codex 0.167.0 | 181562538 | `4e0135447de1f36dd2c097da75eecdddbf1f432d96435979989da93d190949ab` |

草稿创建后的 tag 查询曾 404，E 创建后列表曾短暂未显示；通过分页列表及唯一 ID 核实已创建对象后继续，没有重复创建、覆盖附件或移动历史标签。原失败和外部写入意图/回执均保留在 `publication-events.jsonl`。

## 公开、在线升级和收尾

公开后已派发两个独立 runner：

- [0.1.14 首次在线 / 43218619687](https://github.com/nan023062/cbim/actions/runs/43218619687)，workflow `ca7999abb3c991362e31b5ecbf576ec0528e8113`，默认 differential。旧版第一次读取公开列表失败，停在 idle，尚未发现版本或下载；旧客户端只给出“暂时无法检查更新”提示，没有暴露原 HTTP 状态，具体网络原因未知。保留原 failure.json/截图。随后匿名调用客户端 `latestDesktopRelease` 成功得到 0.1.15，独立 0.1.0 runner 也成功；据此用相同 workflow/断言、同一制品、新 runner 进行一次复验 [43219727847](https://github.com/nan023062/cbim/actions/runs/43219727847)，没有手动填缓存、替换网络或放宽差分条件。
- [0.1.14 → 0.1.15 复验 / 43219727847](https://github.com/nan023062/cbim/actions/runs/43219727847) **通过**，完成于 `2026-11-12T12:42:30.285Z`。真实旧客户端自动发现、后台预下载、普通退出不安装、重开复用缓存、显式点击重启和原用户目录下的新进程均通过。完成的安装包响应为 **2,814,218 字节（2.68 MiB）**，相对完整包 111,828,931 字节（106.65 MiB）减少 **97.48%**；13 次真实 Range、0 次全量回退。统计不含 blockmap、更新清单、协议开销及独立 E 下载，仅代表本次版本和环境。重建包与公开附件的 SHA-256 一致；缓存复用阶段安装包请求与传输均为 0。工作区、模型、同一已完成会话、localStorage、用户标记、知识、业务文件、主 Agent 配置及自动化定义均保留，无任务重放；模型请求 1 次、页面错误 0。原始报告、缓存与传输记录见 [artifact 13946090986](https://github.com/nan023062/cbim/actions/runs/43219727847/artifacts/13946090986)，本地独立保存在 `build/online-43219727847/`，未覆盖首次失败现场。
- [0.1.0 → 0.1.15 / 43218707122](https://github.com/nan023062/cbim/actions/runs/43218707122) **通过**，workflow `f302dd4433682def94e934c4cbddbe9663ff4d78`。按真实 0.1.0 标签适配原设置页 region；输入测试 44 项、脚本语法和三份发布入口一致性通过。旧版自己发现最高稳定版，原 UI 下载、普通退出不安装、重开后再次下载确认并显式重启，实际新进程带原用户目录启动 C 0.1.15 / R 1。工作区、模型、知识/修订、业务文件、同一已完成会话、localStorage/标记保留，无重放；模型请求 1 次、页面错误 0。旧版尚无主 Agent 配置/自动化，明确不适用；本场景未观测 Range，不宣称差分或后台预下载成功。

两条成功在线路径的 source、安装器摘要与上述公开候选一致；首次失败与独立复验分别记录，不合并为一次无失败运行。没有重新生成、替换公开安装包或移动标签。

官网 `website/release.json`、首页、下载页与 README 依据公开回执更新到 0.1.15，完整保留未签名说明、首次 E 下载要求及冷更/资源更新边界。已有 `pnpm check:brand`、`pnpm build:website` 与 `node scripts/website-smoke.mjs` 通过；320/390/1280、深浅色及单文件离线两页共 14 场景通过，无溢出/页面错误。网页输入和已验证产物未再改变，本轮沿用这些结果，只补充事实、引用及字节一致性核对，不重复运行产品测试、打包或安装。收尾改动经过 develop → master 的既有 PR 检查；部署使用原 GitHub Pages 工作流，部署 head、run、六文件匿名摘要与双分支最终回执记录在本报告所属收尾 PR，便于核对实际执行结果，不以文件提交替代部署成功。

`2026-11-12T12:41:30.230Z` 的冻结资源复核通过：24 个 Builtins 白名单条目及正文、运行实现与冻结候选一致，catalog revision 为 `87e523495336c3b5bfc1a564ec40811b637f38bff4be3882a1328d823e11b7da`。后续发布报告和官网回填不属于白名单正文；不声称整个 design/docs 目录与已公开安装包逐字节相同。

## 当前限制

- 旧客户端必须先进行一次冷更；后续兼容 R 更新才免运行安装器。R 包仍为完整 ZIP，没有文件/块差分或主进程无重启 HMR。
- 安装器不携带 E，首次引擎使用需要联网；窗口优先显示，工作区恢复与引擎准备仍需要时间。未承诺任意网络或任意工程都能在固定秒数内恢复。
- 不兼容 E 的原生会话保留历史并要求新建会话，不自动迁移跨 E 历史。缓存尚无自动回收、跨 C 共享能力。
- 资源公钥是本产品清单的信任根，不是 Windows 代码签名证书；Windows 未知发布者提示仍可能存在。
- 已访问原数据的候选启动失败只允许重试同一候选或退出，不自动用旧代码读取可能迁移的数据。更新恢复不能替代用户数据备份。
- 冻结包内 design/docs/legal 是构建时副本，后续验证记录和官网回填不追补到已公开包。Builtins 白名单正文和运行入口已按上述证据核对，不声称整个资源目录与后续仓库逐字节相同。
- 主工作树存在用户同期未提交的概念/边界文档，发布使用隔离工作树，未收编、覆盖或清理这些改动。远端双分支同步与本地未提交状态分别报告。
