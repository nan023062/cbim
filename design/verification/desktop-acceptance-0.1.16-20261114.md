# CBIM 0.1.16 候选：在线模型、打包与安装验收

2026-11-14，用户要求继续在线模型和打包发布验收，并确认沿用 Windows 未签名模式。本轮目标是验证候选；未合并 master、公开 Release、切换更新通道或更新官网。

**结论：本轮候选验收通过。** 真实在线模型、签名资源与冷包验证、实际 EXE 隔离、重开历史、隔离全新安装及 0.1.15 → 0.1.16 覆盖升级均通过；完整 CI 为 494 文件、3354 通过、0 失败、2 项已有条件跳过。公开自动升级与差分下载尚未验收，候选保持草稿。

## 源码与制品

- 仓库及账号：`nan023062/cbim` / `nan023062`，开发分支 `develop`。
- 冻结提交：`b21a77ec23f17089a80ec738bbe365f9c56e71d5`。之前的 `eed6eb25` 保存在线验收器，`a2fdce3a` 准备版本与旧版升级输入，本提交修正冷包资源收集。
- 新冷壳 C 0.1.16 / R1。实际冷指纹 `c192e18fe4616db92dca948f4d279426313e73d150fb7e90eb7996037f5deac9` 与旧 C 不同，不能以 C 0.1.15 / R5 代替。
- 候选目录：`build/desktop-release/0.1.16/unsigned-20261114-094902-d205c3b0`。真实主程序：`build/unsigned-20261114-094902-d205c3b0/CBIM Assistant-win32-x64/CBIM Desktop.exe`，完整回执见候选的 `build-receipt.json`。
- Windows 模式 `unsigned`，隔离安装后实际签名状态 `NotSigned`。资源仍由原 Ed25519 身份签名，公钥 SPKI DER SHA-256：`378c827bf38efb6724466bbb39d3e39ee4ef2dc1de2576fa1fde760443145c49`。未输出或上传私钥。
- R 清单 payload digest：`b2f2f5d7278bd5e1ac1a374c2d8ecca88d794c21c4c77832e743d94280a1acfc`。Pi 1.5.0、Claude Code 0.3.322、Codex 0.167.0 的 E ZIP 与原公开版本摘要一致。

| 附件 | 字节数 | SHA-256 |
| --- | ---: | --- |
| `CBIM-Setup-0.1.16-x64.exe` | 111930139 | `4ca66fdb13118b67c6e2f08891b9204fc854dc6dabfb2609c09fa182b670ef39` |
| `CBIM-Setup-0.1.16-x64.exe.blockmap` | 118837 | `d7ca16df94638874089e87647ec729a71630fcc4ebc31874f4afe7dcd30bf3dd` |
| `latest.yml` | 348 | `bbfaad405560d675ac9d5909655c421065f79bd725e6b081c84bee5f0610c1c6` |
| `SHA256SUMS.txt` | 270 | `246098444f8e8f84c826f8d517a8af263e408b6039aee2dc14cce2cbaa744cb6` |

草稿 Release ID `444935258`，tag `desktop-v0.1.16`，target 为上述冻结提交，四附件已回读匹配摘要、长度及 uploaded 状态；对应 asset ID 分别为 `745927771`、`745927777`、`745927773`、`745927775`。按 tag 的接口曾返回 404，随后通过分页列表定位唯一草稿 ID 继续上传，没有重复创建。旧 Python latest 保持 `327801733 / v1.0.2`，公开桌面仍为 0.1.15。master 保持 `9e3f4d49bde7b4b0dd80fdcf222a7857734607eb`。

## 在线模型与真实 EXE

使用本机已配置的 DeepSeek `deepseek-flash`，真实 Pi 引擎、Application、IPC 和持久化。测试知识、岗位和文件在独立临时工作区；仅复制加密模型配置及系统加密元数据，结束删除副本，不改变生产工作区或模型设置。

1. 编译后 Electron 入口：`pnpm exec tsx scripts/office-team-online-smoke.mts`，`test-results/office-online-v2RDiK/report.json` 通过。另用 `--verify-report` 只读核验同一批原始记录，没有重发付费请求。
2. 本候选实际 EXE：显式 `CBIM_TEST_EXE` 后运行同一脚本，`test-results/office-online-4P3rDj/report.json` 通过。两个任务真实派发给成员、回传实际文件内容并通过目标审阅；第二任务排队后自动形成独立话题。一个角色保留一个逻辑子会话，两个话题使用不同原生 Session，各自包含当前结果且不包含另一话题结果，页面错误为 0。
3. 只读重新启动同一隔离 profile，原主运行 ID 不变、没有新运行；办公室显示 2 位 Agent、当前任务 0、默认折叠的历史任务 2；成员头顶入口可打开原结果。脚本与证据为 `test-results/desktop-016-20261114/reopen-office.mjs`、`reopen-history.json` 和两张 `packaged-*-history.png`。此时加密模型副本已清理，界面中的模型不可用提示是验收清理结果，不是生产配置丢失。
4. 显式 `CBIM_TEST_EXE`、`CBIM_ISOLATION_REPORT=test-results/desktop-016-20261114/isolation-candidate2.json`，执行 `pnpm exec tsx scripts/isolated-node-smoke.mts`：文件边界、禁网、超时、取消、非零退出、输出上限六项通过，自有进程与资源均回收。

在线结果只代表本次模型与小型任务路径，未宣称所有模型、复杂任务或三引擎在线质量都已覆盖。

## 制品与隔离安装

- `pnpm make:desktop --unsigned`：第二候选通过 R/E ZIP、冷包资源、payload、安装器及清单核验，退出码 0。
- `pnpm exec tsx scripts/verify-cold-payload.ts <packagedDirectory> <runtimeDirectory> --published-engines`：通过，三个 E 的固定公开下载字节均重新核验，不仅检查附件名称。
- [隔离安装运行 43543271035](https://github.com/nan023062/cbim/actions/runs/43543271035)：`mode=candidate`，workflow head、源码、安装器摘要均与本候选一致，成功完成。报告位于 `test-results/desktop-016-20261114/installation-43543271035/`。
- 无用户安装的 Windows runner 完成全新安装，以及真实 C 0.1.15 / 内置 R1 → C 0.1.16 / R1 覆盖升级；工作区、模型、已完成会话、localStorage、文件标记、知识、业务文件、主 Agent 配置和自动化均保留，无重放，0 页面错误。实际新 EXE 为 packaged，原用户目录保持一致。
- 新安装从固定公开源下载实际 Pi 1.5.0，核对 15338 个文件，并完成一次确定性模型请求；迁移 profile 另完成一次，共 2 次请求。此确定性安装检查与前述真实 DeepSeek 在线验收分别记录。
- 这是候选安装及覆盖升级，不是公开更新通道的自动发现、差分下载、退出取消与 UI 重启安装验收；报告相应字段为 false。也不将 R1 起点写成 R4 起点。

## 失败与修复

首候选 `unsigned-20261114-094417-9c19e1db` 已生成 NSIS，但最终报“资源目录包含多余内容”。实际原因是源码迁移残留的 `design/skills/` 空目录被递归复制，文件清单及 ZIP 却只登记文件。修正 `collectResources` 只在新建制品边界内清理空目录；源目录不变，链接拒绝与启动校验保持严格。首候选、回执及失败现场保留，不公开或覆盖它。

相关检查：`tests/runtime-packaging.test.ts` 3/3；`tests/desktop-acceptance-inputs.test.mjs` 46/46；`pnpm check:test-modules` 494 文件边界通过。源码 `src/` 未因本轮验收修改，因此没有产品注释或类图变更。

完整 CI 首次失败还暴露了 7 项旧契约断言和 2 项夹具错误。协作回调增加队列话题标识，在线等待的新任务应为 pending、重启为 paused，普通输入始终排队；相应测试补充精确身份与等待边界。依赖修订夹具从整个上下文匹配目标，误把前置 A 当作当前 D；改为精确读取当前派发原文，A/B/C/D 各自返回真实文件标记。产品正确拒绝错误候选，未降低审阅要求或放宽超时。

本地定向复测：`queued-task-cancel-pi.test.ts` 3/3；`execution-collaboration.test.ts`、`queue-insertion-view.test.ts`、`queued-dependency-revision-pi.test.ts` 共 30/30。保存于 `test-results/desktop-016-20261114/*local.json`、`ci-regressions-before.json`、`ci-regressions-after.json` 和两份 `dependency-revision-*-before.json`。夹具修改后模块边界检查仍为 494 文件通过。

## 完整 CI

- 首次版本准备运行 [43542347851](https://github.com/nan023062/cbim/actions/runs/43542347851) 被后继提交运行取代而取消；不计为通过。
- 冻结候选运行 [43543016620](https://github.com/nan023062/cbim/actions/runs/43543016620)：静态、第 2/4 片通过，第 1/3 片共 9 项失败，原始四片报告保留在 `test-results/desktop-016-20261114/ci-43543016620/`。
- 修复后的验证提交 `cfb30c776a2bd84aa72b1172a29b675f29db4188` 已推送 develop，完整运行 [43545100842](https://github.com/nan023062/cbim/actions/runs/43545100842) 成功。类型、架构/依赖、测试边界、官网检查、完整 Windows 四片及最终覆盖汇总均通过。此 head 相对冻结候选仅四个测试/夹具和开发记录变化；产品源码、构建输入、依赖、版本与签名附件未改变。

| 分片 | 文件 | 通过 | 失败 | 跳过 |
| --- | ---: | ---: | ---: | ---: |
| 1 | 123 | 993 | 0 | 0 |
| 2 | 124 | 757 | 0 | 0 |
| 3 | 124 | 858 | 0 | 1 |
| 4 | 123 | 746 | 0 | 1 |
| 合计 | 494 | 3354 | 0 | 2 |

总计 3356 项，逐片原始报告在 `test-results/desktop-016-20261114/ci-43545100842/`，工作流回执与去重汇总分别为 `ci-final-run.json`、`ci-final.json`。没有漏片或重复测试文件。工作流的独立 Documentation job 因选用 full 模式按既有配置跳过，不是测试漏跑。

两项条件跳过均为原有 `skipIf`，本轮没有新增跳过：

- `owner-execution-legacy.test.ts`：runner 缺少固定前负责人机制 EXE `build/20261107-235854/CBIM Assistant-win32-x64/CBIM.exe`（可由 `CBIM_OWNER_LEGACY_EXE` 指定）。
- `knowledge-source-lifecycle-application.test.ts` 的实际旧 EXE 迁移用例：runner 缺少 `build/20261107-222611/CBIM Assistant-win32-x64/CBIM.exe`（可由 `CBIM_SOURCE_LEGACY_EXE` 指定）。

不将上述两项计为通过，也不以本次 0.1.15 安装升级替代这些特定旧格式的验证。

## 冻结与记录边界

候选 ZIP 会收录 design/docs/legal 的冻结副本。本报告及开发记录后续回填没有进入已签名候选，不宣称当前仓库全部资源与候选字节相同；后续资料不改变产品、依赖、构建配置、内置业务白名单或版本说明。正式公开仍需按真实 PR、合并及公开升级证据完成后续步骤。

自包含查看报告：`test-results/desktop-016-20261114/report.html`，内嵌三张实际截图。报告自身用独立无头浏览器核对 320px 浅色/深色、展开全部图片后仍无横向溢出、无外部图片依赖、无页面错误；这属于交付报告检查，不代替产品验收。
