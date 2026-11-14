# CBIM Desktop 0.1.16 公开发布与真实升级验收

2026-11-14，用户明确要求继续公开发布、自动升级和差分下载验收，发现问题即修复；沿用此前确认的 Windows 未签名模式，资源清单继续使用原 Ed25519 身份。

## 发布与源码身份

- 仓库/账号：`nan023062/cbim` / `nan023062`；默认分支 develop，稳定与 Pages 部署分支 master。
- [公开 Release](https://github.com/nan023062/cbim/releases/tag/desktop-v0.1.16)：ID `444935258`，公开时间 `2026-11-14T03:06:33Z`，stable、非草稿、`make_latest=false`。
- 标签 `desktop-v0.1.16` 指向冻结源码 `b21a77ec23f17089a80ec738bbe365f9c56e71d5`，未移动旧标签或覆盖附件。候选目录 `build/desktop-release/0.1.16/unsigned-20261114-094902-d205c3b0`，C 0.1.16 / R1。
- 安装包 `CBIM-Setup-0.1.16-x64.exe`：111930139 字节；SHA-256 `4ca66fdb13118b67c6e2f08891b9204fc854dc6dabfb2609c09fa182b670ef39`。
- Windows 未签名；Ed25519 公钥 SPKI DER SHA-256 `378c827bf38efb6724466bbb39d3e39ee4ef2dc1de2576fa1fde760443145c49`。未输出、上传或更换私钥。
- 旧 Python latest 保持 `327801733 / v1.0.2`，旧桌面与旧资源附件保持原状。

## 候选与准确 PR 检查

候选的真实在线模型、打包 EXE 六项隔离、历史重开、全新安装及旧 C/R1 覆盖升级已通过，详细事实见[候选验收](desktop-acceptance-0.1.16-20261114.md)。本轮没有重复构建候选。

- [PR #72](https://github.com/nan023062/cbim/pull/72)：head `f45db507fddf99256eb0ce2215472e941dde6b5d`，base `9e3f4d49bde7b4b0dd80fdcf222a7857734607eb`。
- [完整 PR CI 43548540249](https://github.com/nan023062/cbim/actions/runs/43548540249)：类型、架构/依赖、模块测试边界、品牌/官网构建、四片测试及完整覆盖汇总通过。494 文件，3365 通过、0 失败、2 跳过，总计 3367 项。
- 分片 1/2/3/4 分别为 1004/757/858/746 通过；第 3/4 片各一项既有历史 EXE 前置条件跳过，仍为 `owner-execution-legacy.test.ts` 与 `knowledge-source-lifecycle-application.test.ts` 中指定旧 EXE 的迁移验证。本轮没有新增 skip，也不计其为通过。
- 原 head `91f6be2d` 的 PR CI `43548140160` 被验收器修正提交取代，不作为最终通过证据。
- 2026-11-14T03:05:41Z 正常 merge，未 squash、未管理员绕过：`22d794f53042dfe40da452725b368ce0af2b63b0`。冻结源码为该提交的祖先，差异只有验收脚本、测试/夹具和后续记录；产品、构建输入、依赖、内置业务白名单、版本说明未变化。
- design/docs/legal 随包冻结；后续报告和开发记录不在已签名制品中，不宣称当前仓库全部资源字节与候选相同。已有其他分支及无关未跟踪架构草稿保留，不纳入本次发布。

## 公开与匿名回读

公开前再执行 `pnpm verify:desktop build/desktop-release/0.1.16/unsigned-20261114-094902-d205c3b0 --unsigned`，通过。按已核实 ID 公开原草稿，四附件 ID/摘要保持不变。

无 GitHub 凭据读取公开 Release、标签提交，并实际下载全部四附件；长度、SHA-256、安装器 SHA-512 与 `latest.yml` 一致，旧 Python latest 未改变。证据为 `test-results/desktop-public-016-20261114/public-verification.json`，原始四文件保存在 `anonymous-assets/`。本轮外部变更意图、合并及发布回执同目录保留。

| 附件 | Asset ID | 字节 | SHA-256 |
| --- | --- | ---: | --- |
| CBIM-Setup-0.1.16-x64.exe | 745927771 | 111930139 | `4ca66fdb13118b67c6e2f08891b9204fc854dc6dabfb2609c09fa182b670ef39` |
| CBIM-Setup-0.1.16-x64.exe.blockmap | 745927777 | 118837 | `d7ca16df94638874089e87647ec729a71630fcc4ebc31874f4afe7dcd30bf3dd` |
| latest.yml | 745927773 | 348 | `bbfaad405560d675ac9d5909655c421065f79bd725e6b081c84bee5f0610c1c6` |
| SHA256SUMS.txt | 745927775 | 270 | `246098444f8e8f84c826f8d517a8af263e408b6039aee2dc14cce2cbaa744cb6` |

## 线上路径与验收器修正

核对真实 `desktop-v0.1.15` 后确认：其 RuntimeUpdates 优先同 C 的 R4，尚在内置 R1 的客户端先更新 R4，随后才发现 C 0.1.16。原安装验收器仅等待目标冷版本，未覆盖中间资源步骤。

修正只作用于验收工具：严格识别已核实的 C 0.1.15/R4，真实等待下载、核对普通退出不激活、点击原侧栏入口重启，再核对实际 R4；之后由原定时器发现目标 C。没有模拟网络、改缓存/激活日志、改变旧版行为或放宽差分断言。

`pnpm exec vitest run tests/desktop-acceptance-inputs.test.mjs`：57/57；脚本语法及模块边界检查通过。没有修改 `src/`，不涉及产品注释/契约/类图。

公开后保留各轮失败与修正，不能把下载就绪或前序通过当作整条升级通过：

| 运行 | 实际结果 | 修正 |
| --- | --- | --- |
| [43549948251](https://github.com/nan023062/cbim/actions/runs/43549948251) | R4 已激活，冷包摘要正确且已就绪；网络仅记录重开后的 latest.yml，没有 Range，差分断言失败 | 验收器在未连接的新进程中等 15 秒，超过原 10 秒预下载起点；不能据缓存证明差分 |
| [43550661868](https://github.com/nan023062/cbim/actions/runs/43550661868) | 提前正常关闭新资源窗口超时，尚未进入差分统计 | 放弃靠窗口关闭时间交接，改为直接连接同一真实资源重启进程 |
| [43551363194](https://github.com/nan023062/cbim/actions/runs/43551363194) | 已接回真实 R4、原用户目录、无重放；随后客户端报告暂时无法检查更新，原验收器立即失败，底层联网原因未知 | 允许观察旧版既有每分钟自动重试，五分钟上限；不主动重试或改变产品，下载/校验/安装及未知错误仍失败 |
| [43551883142](https://github.com/nan023062/cbim/actions/runs/43551883142) | 10 个 Range、0 次全量回退、4683509 字节，正确缓存摘要；正常退出后的 PID 查询返回 1，验收误报 | 只读复现不存在 PID 时 PowerShell 仍返回 1；改为正常枚举筛选，已退出为空通过，仍运行必须等退出 |
| [43552366779](https://github.com/nan023062/cbim/actions/runs/43552366779) | 差分、普通退出不安装、缓存复用通过；点击重启安装后，查询已关闭旧页面失败 | 预先订阅实际进程退出，再核对真实 NSIS 新进程；不将旧窗口关闭当作升级成功 |
| [43552909174](https://github.com/nan023062/cbim/actions/runs/43552909174) | 已取得真实点击及旧进程关闭回执；随后读取已释放 Playwright 对象的 process 失败 | 使用点击前保存的原生 PID，关闭后清除旧连接，不再调用已释放对象 |

最终观测方式通过已核实安装路径/PID 查找本机调试端口，再次核对 PID/EXE；先连接主进程被动网络记录，再接 Chromium 页面，不暂停执行或改变下载行为。连接模块使用自身空 Node 子进程验证真实协议，2/2；输入与严格重试状态单元 67/67，既有网络统计 3/3，模块边界 495 文件通过。测试仅针对验收工具，产品、发布标签、四附件与缓存没有修改。

[修正 PR #73](https://github.com/nan023062/cbim/pull/73) 的最终 head 为 `f4637eed9e47d9b2ec7911eddfd1245c1741cfd8`。[线上验收 43553423494](https://github.com/nan023062/cbim/actions/runs/43553423494) **通过**，完成时间 `2026-11-14T03:50:30.496Z`；workflow head 为 `92658a0fb62811031425e78b2b96c72427812b65`，source 仍为冻结构建提交，`previous_version=0.1.15`、`mode=online`、`transfer_expectation=differential`。线上通过后仅调整终端集成测试等待窗口及开发记录，验收脚本、产品和四附件未变，不重复安装。

- 真实路径：C 0.1.15/R1 → 同 C 公开 R4 → C 0.1.16/R1。资源和冷包由原定时器发现，分别通过真实 UI 明确重启；普通退出不应用更新。
- 安装器 10 个成功 Range、0 次全量回退；实体响应共 **4683509 字节（4.68 MB）**，完整包 **111930139 字节（111.93 MB）**，少约 **95.8%**。统计只含安装包完成响应 Content-Length，不含 R4、索引、blockmap 或协议开销，不是整条链路总流量。
- 下载缓存 SHA-256 与公开冻结附件一致；普通退出后仍为 0.1.15，重开复用缓存，安装器重复请求 0。
- 真实按钮点击后旧进程关闭；NSIS 启动的新进程带 `--updated` 与原 `--cbim-user-data-root`。实际 EXE 的版本为 0.1.16、packaged=true、同一 user/desktop、NotSigned；内置状态与说明为 R1，最后检查为 current。
- 工作区、模型、同一 completed task/run、localStorage、文件标记、知识、业务文件、主 Agent 设置、自动化和无重放全部通过；迁移模型请求仅 1，页面错误 0。最终成功运行没有检查错误重试（checkRetries=[]），因此不将“真实失败后自动恢复”另计为已覆盖；已验证其严格状态选择单元。
- 原始 `online/report.json`、`online-differential.json`、`online-cache-reuse.json`、`online-ui-install.json`、`online-restart.json`、截图及各失败 attempt 均在 `test-results/desktop-public-016-20261114/` 保留；云端 artifact 见对应运行。

### 修正 PR 的完整 CI

- 旧 head `92658a0f` 的 [43553426723](https://github.com/nan023062/cbim/actions/runs/43553426723) attempt 1/2 均因终端首个真实 PowerShell 命令超过 30 秒失败，状态为无输出、仍运行、无退出码；其余三片和静态检查通过。先保留原结果，只重跑失败分片仍复现，没有据此忽略失败或合并。
- 本机精确终端套件 3/3；根据该套件的输出、退出码、隔离职责，将首项观察上限设为 120 秒，保留十秒快照与最终耗时，不重试命令、不预热、不改产品实现；修改后本机同一套件 3/3。底层启动延迟的具体原因尚未证实，不能把 30 秒无输出直接归因于某个系统组件。
- attempt 2 的实际 artifact 为 `14097294664`（2026-11-14T04:09:48Z），已按 ID 下载至 `observer-ci-attempt2/shard1-exact/`；按同名选择的旧附件另行标注，避免混用旧报告。
- 最终 head `f4637eed9e47d9b2ec7911eddfd1245c1741cfd8`、base `22d794f53042dfe40da452725b368ce0af2b63b0` 的 [完整 CI 43555526643](https://github.com/nan023062/cbim/actions/runs/43555526643) **通过**：495 文件、3377 通过、0 失败、2 项既有条件跳过。四片分别为 780/949/840/808 通过，前两片各 1 项原历史 EXE 前置条件跳过；静态检查与完整覆盖汇总通过，中间 head 不作为最终通过证据。
- 本轮终端首项实际约 3366ms 完成，输出 TERMINAL_OK、退出码 0、会话隔离正确，低于旧 30 秒上限；这证明本轮行为通过，不证明已经定位前两次平台启动延迟的原因。报告及终端状态在 `final-ci/`。
- PR #73 于 `2026-11-14T04:26:28Z` 正常合并为 `0a12a3d54b4f40111807052df3d47cf3b3898475`，未 squash/管理员绕过，develop 随后快进同步。该修正只含验收脚本、测试、测试归属与记录；没有修改已发布产品或构建输入。

## 官网与分支收尾

官网与 README 按本次公开回执更新 C 0.1.16/R1、下载字节/摘要、未签名说明、话题与办公室功能，并说明旧 R1 先升级 R4 的真实路径。保留旧 0.1.15 历史入口与既有站点验证/SEO；不改用 Python latest。

`CBIM_WEBSITE_URL=https://nan023062.github.io/cbim/ node scripts/ci-website-smoke.mjs`：品牌/官网构建与 **14 场景通过、0 页面错误**，包含 320/390/1280、浅色/深色、下载/首页、摘要/下载入口及两个独立单文件页面。原官网证据先移至 `website-before-016/`，新证据另存，未覆盖历史。

官网 PR、实际 Pages 部署与匿名六文件核验待回填；不将本地构建视为线上部署，也不宣称所有用户已升级。
