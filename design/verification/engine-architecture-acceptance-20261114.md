# 官方领域引擎架构：分支、真实模型与安装验收

2026-11-14。用户要求推送引擎架构分支，运行完整 CI、外部真实模型及安装升级验收；随后明确本轮只验现有生成模型，向量模型另验。本次不合并、不公开桌面候选、不修改公开桌面或独立 E 的更新索引。

## 冻结源码与候选

- 仓库/账号：`nan023062/cbim` / `nan023062`；分支 `refactor/engine-model-catalog` 已推送。
- 安装候选源码：`0ae674acf5b0582234f5f1ae1b1ad5358198a8bf`。C 0.1.17 / R1，官方 Pi、Claude Code、Codex、memory 适配器均为 1.1.0。
- 候选：`build/desktop-release/0.1.17/unsigned-20261114-144454-d3ba153c`；EXE：`build/unsigned-20261114-144454-d3ba153c/CBIM Assistant-win32-x64/CBIM Desktop.exe`。
- Windows 沿用已确认的个人开发 `unsigned` 模式；原资源 Ed25519 公钥 SPKI DER SHA-256 为 `378c827bf38efb6724466bbb39d3e39ee4ef2dc1de2576fa1fde760443145c49`，私钥未输出或上传。
- 签名 R payload digest：`81eee236e30954df7e80e4ed6e0addcdb09ecda053de2404512e1bfe4f1b1a5b`。
- 草稿 Release ID `445084616`，`desktop-v0.1.17`，target 为上述源码；四附件已上传并回读长度、摘要和状态，保持 `draft=true`。创建后列表曾短暂缺失，按已核实 ID 继续，没有重复创建。

| 附件 | 字节 | SHA-256 |
| --- | ---: | --- |
| `CBIM-Setup-0.1.17-x64.exe` | 111857839 | `e7a3753a348bc9029c3d71532289c5a25ef31cce4a0596f7a4583715628c6102` |
| `.exe.blockmap` | 118690 | `b3f564fa94fc556bfb87e974466a3494a39a5fe4c9a06e70af07996e8123ead1` |
| `latest.yml` | 348 | `a6f44002d0ad01a4f2ea2cb4f2f483b092359d43d371899ae7908ca6ab0f7747` |
| `SHA256SUMS.txt` | 270 | `f012e63a05ad5245bd3d0e50d16608c2b5318b3f7f13a97d3c37c6bac5884942` |

## 独立引擎与真实 EXE

`pnpm make:desktop --unsigned` 完成构建及 R/E 完整目录、冷包资源、payload、安装器校验。随后对同一 packagedDirectory/runtimeDirectory 执行 `pnpm exec tsx scripts/verify-cold-payload.ts <packagedDirectory> <runtimeDirectory> --published-engines`，四个 E 从固定公开源重新下载并核验通过。

为使候选真实客户端按固定源下载，向既有 prerelease `runtime-engines`（ID `442866980`）仅追加四个按内容摘要命名的不可变附件，未覆盖旧附件、未生成或更新独立 `latest.json`：

| E 适配器 | ZIP 字节 | SHA-256 |
| --- | ---: | --- |
| Pi 1.1.0 / SDK 1.5.0 | 32345701 | `674b46c21dc4aa15f7a2773ac9140e6ef10e70409d7a99708ebc29bbe6606fc6` |
| Claude Code 1.1.0 / SDK 0.3.322 | 170622274 | `ffe568ae3a25c1bc0591685d03526a12db989c4260daf44a9cb29c941be925c3` |
| Codex 1.1.0 / SDK 0.167.0 | 181611251 | `278780160c41a90d3057d603c2993fe51db1242624f5a0e8d654505231f6a810` |
| memory 1.1.0 | 47650 | `d5240bd340f98a592aa9e8496a8d9131e89422d3d9df77f69297d87c98246c5b` |

显式设置 `CBIM_TEST_EXE` 为本候选程序，运行 `pnpm exec tsx scripts/isolated-node-smoke.mts`：文件边界、禁网、超时、取消、非零退出及输出上限六项通过。证据：`test-results/engine-acceptance-20261114/isolation-candidate.json`，真实程序 SHA-256 `81bb819383a8cf343fbe3b46fcbec08be608a18bd25aea00ae80051c696f7d5e`，无网络请求，自有资源回收。

## 外部真实生成模型

同一候选 EXE 显式执行 `pnpm exec tsx scripts/office-team-online-smoke.mts`，使用本机已有 DeepSeek `deepseek-flash` 和实际 Pi 1.5.0。2026-11-14 06:47:58–06:51:11 UTC 完成；没有模型替身或生产工作区操作。仅把加密模型配置及系统加密元数据复制到独立临时 profile，测试结束删除副本。

- 两个话题、两个成员任务、四个主运行全部完成；第二任务先排队，再形成独立话题。
- 成员分别实际读取 `OFFICE_ALPHA_9462` / `OFFICE_BETA_7318`，回传并完成目标审阅；同角色一个逻辑子会话，话题各自使用独立原生 Session，未带入另一话题标记。
- 页面错误为 0；`--verify-report` 只读核验原始持久记录，没有再次请求模型。
- 删除加密凭据副本后重开同一候选，等待工作区自然恢复，不主动 open；原四个 run ID、成员结果和审阅决定一致，无任务重放。
- 证据：`test-results/office-online-vIZZPm/report.json`、`member-context-evidence.json`、`reopen-report.json`、截图；重开检查脚本在 `test-results/engine-acceptance-20261114/reopen-online.mjs`。

该结果只覆盖本次 DeepSeek/Pi 小型主成员协作，不表示 Claude/Codex 的外部服务、任意模型或记忆引擎向量调用都已验收。按用户选择，向量模型另验。

## 完整 CI 与契约修正

首次完整运行 [43567438913](https://github.com/nan023062/cbim/actions/runs/43567438913) 对 `ab54c81e` 覆盖 515 文件：3456 通过、2 失败、2 条件跳过。原始报告保留在 `test-results/engine-acceptance-20261114/ci-initial/`。

失败均为已核实的旧断言：架构契约遗漏仅含静态描述/规则的 `logic/engines` 便携入口，协议表遗漏已登记 memory 的 Chat 主模型支持。修正精确入口和预期表，具体适配器仍只在执行装配点选择；记忆引擎必填向量角色、停用/未知模型拒绝均保留。对应 19 项定向测试通过，没有修改产品来绕过失败。

验证提交 `a53171c3c92b3b384741bbacfb67d43191cb0982` 相对冻结候选仅测试、验收脚本和开发记录变化。产品、依赖、版本、构建输入一致；候选内的 design 副本保持冻结版本，不把后补记录声称为已在原包内。中间运行 `43568661428` 被新验证提交取消，不计通过。

最终完整运行 [43568765411](https://github.com/nan023062/cbim/actions/runs/43568765411) 成功：精确 head 为 `a53171c3c92b3b384741bbacfb67d43191cb0982`，类型、架构/依赖、测试边界、官网检查、完整 Windows 四片和最终覆盖汇总均通过。原始报告在 `test-results/engine-acceptance-20261114/ci-final/`，统计在 `ci-summary.json`。

| 分片 | 文件 | 通过 | 失败 | 条件跳过 |
| --- | ---: | ---: | ---: | ---: |
| 1 | 129 | 777 | 0 | 1 |
| 2 | 128 | 985 | 0 | 1 |
| 3 | 129 | 876 | 0 | 0 |
| 4 | 129 | 831 | 0 | 0 |
| 合计 | 515 | 3469 | 0 | 2 |

两项既有条件跳过分别来自 `owner-execution-legacy.test.ts` 和 `knowledge-source-lifecycle-application.test.ts`，需要 runner 中不存在的固定历史 EXE 夹具。没有删除这些覆盖或把它们写成通过；本轮实际 0.1.16 安装迁移另由下述隔离 runner 验证。完成后只追加外部验证记录，不重复全量产品 CI。

## 隔离安装与升级

首次安装运行 [43568253630](https://github.com/nan023062/cbim/actions/runs/43568253630) 成功，但报告中主 Agent/自动化为 `not-applicable`。检查发现验收器另两处旧版本名单止于 0.1.15，首次结果未覆盖这两项及旧缓存断言；保留原报告，不改写为已验证。

已将接受的旧版本与保留检查联动，核对 0.1.16 已有能力：旧 NSIS 缓存、主 Agent 配置、自动化定义均必须验证，未来未核实版本仍拒绝。`tests/desktop-acceptance-inputs.test.mjs` 68 项通过。

补齐后对相同冻结草稿执行 [43568768368](https://github.com/nan023062/cbim/actions/runs/43568768368)，workflow head 为 `a53171c3`，source_commit 仍为 `0ae674ac`；2026-11-14 07:00:41 UTC 成功，最终证据在 `test-results/engine-acceptance-20261114/installation-final/`。

- 全新安装，以及真实 0.1.16 → 0.1.17 覆盖升级通过；主程序为 `isPackaged=true`，实际 Windows 签名状态 `NotSigned`，用户数据目录不变。
- 原工作区、模型、已完成会话、localStorage、文件标记、正式知识、业务文件、主 Agent 配置及自动化定义均保留；主 Agent revision/selection、自动化 id/revision 不变，自动化运行数为 0，无任务重放，页面错误为 0。
- 原 NSIS 产生的缓存为真实 0.1.16 安装器 `111930139` 字节、SHA-256 `4ca66fdb13118b67c6e2f08891b9204fc854dc6dabfb2609c09fa182b670ef39`；新缓存与本候选摘要一致，未人工补缓存。
- 全新 profile 下载实际 Pi E 并核对 15340 个文件，完成一次确定性模型请求；迁移 profile 一次，共两次，无重放。报告中的 `version=1.5.0` 是 SDK 版本，对应签名清单中的适配器版本为 1.1.0。
- 本次 `mode=candidate`，报告的公开自动发现、差分下载、普通退出取消安装等在线通道字段均为 false，不计作公开通道验收。

安装测试只能在没有用户 CBIM 安装的 GitHub Windows runner 进行。候选全新安装的 Pi E 从真实固定公开源下载到共享引擎缓存，并逐文件核对；模型响应为确定性安装探针，与前述真实 DeepSeek 验收分别记录。

## 本轮边界

不合并或正式发布；草稿覆盖升级不等同于公开通道自动发现、差分下载及显式重启安装。没有切换公开桌面或资源更新通道，没有操作开发者生产安装。向量模型按用户决定后续另验。旧 Python latest 保持 `327801733 / v1.0.2`。
