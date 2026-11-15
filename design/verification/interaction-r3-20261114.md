# C 0.1.17 / R3 交互区发布验证

## 范围与冻结准备

2026-11-14，用户授权在 PR 提交后发布新版本。本次仅发布 PR #81 的交互区改造，保留三个独立功能提交：5f024443、f0581dfd、213ce6a7。未纳入其它开放 Issue。

基线 master/develop 为 233921c278551fde79a8f7d069d358ced4176b97；当前公开资源为 C 0.1.17 / R2。采用现有 R-only 流程升至 R3，实际构建仍校验固定冷包指纹。沿用原 Ed25519 资源身份，四个 E 描述从已签名 R2 复用；Windows 基础安装包保持原 NotSigned，不重打包或替换公开安装器。Python latest 基线为 Release 327801733 / v1.0.2。

## 已有开发证据

- 准确产品提交 213ce6a7f10e3513d143fcf7718727b47cd9a7bc 的手动完整 CI [43606671445](https://github.com/nan023062/cbim/actions/runs/43606671445) 通过：523 文件、3525 通过、2 个既有历史 EXE 前置条件跳过、0 失败；四个 Windows 分片、静态检查和完整覆盖汇总成功。
- [PR #81](https://github.com/nan023062/cbim/pull/81) 指向 master；发布准备更新后将以最终 head 的自动完整 CI 为准。
- 开发阶段受影响单元、契约、类型、依赖/架构和测试归属检查通过；真实隔离 Electron/React 的交互区 9 组与办公室 16 组检查通过。IPC 为内存夹具，不冒称在线模型或安装升级证据。详情见 development-log 对应三步记录。

## 本次验收边界

资源候选由干净冻结提交构建，以 build/runtime/c0.1.17-r2-5yrEjL 为基线；签名候选完整文件表和原公开 E 用客户端同一验证器核实。安装升级仅在无 CBIM 用户安装的 GitHub Windows runner 运行。

现有 runtime-acceptance 从真实 desktop-v0.1.17 内置 R1 安装启动，验证跨版本到 R3。候选模式明确暂存签名包；公开模式使用原匿名通道、实际 UI 点击和进程重启，检查普通退出不应用、六类数据保留和任务不重放。该验收不声称专门从已激活 R2 开始，也不代表外部模型质量验收。用户当前安装保持不受测试操作影响。

本节为冻结前计划：候选构建、最终 PR CI、合并、发布、公开升级与官网同步尚待实际回执。后续只追加真实结果，不修改已公开资源包；包内 design/ 保留冻结副本。

## 实际构建、CI 与发布

- 冻结源：`df1137414de4188d665ae2246c65f3d8b5ff032c`。PR #81 于 2026-11-14T15:14:49Z 正常 merge，master 为 `6e759a77584dc7797d5c3e57dedbc47c489305c4`；merge tree 与冻结源完全一致，均为 `a175811fab196d441aa2124fb64622b7cae41637`。新追溯标签 `runtime-c0.1.17-r3` 的 peeled commit 指向冻结源；已有资源通道标签不移动。
- 命令：`pnpm make:resources build/runtime/c0.1.17-r2-5yrEjL 3 design/releases/runtime-c0.1.17-r3.md`。候选 `build/runtime/c0.1.17-r3-n0d9ki`，冷包指纹一致。`pnpm verify:runtime build/runtime/c0.1.17-r3-n0d9ki` 通过，包含 R3 和四个原公开 E 的完整校验。
- [最终 PR CI 43608092939](https://github.com/nan023062/cbim/actions/runs/43608092939)：准确 df113741 的四片、静态和完整覆盖汇总通过，523 文件、3525 通过、2 跳过、0 失败。跳过是 `owner-execution-legacy` 与 `knowledge-source-lifecycle-application` 中需要真实历史 EXE 的既有迁移用例，无新增跳过。此前 43607732703 在提交发布说明后由工作流自动取消，未冒称通过。
- [候选验收 43608615116](https://github.com/nan023062/cbim/actions/runs/43608615116)：准确冻结源，草稿 Release 445379857，真实 C 0.1.17 / R1 → R3。普通退出不应用、工作区/知识/模型/已完成任务/文件/localStorage 保留、旧主题与新设置保存均通过；1 次确定性模型请求、0 任务重放、0 页面错误。加载前资源损坏隔离回 R1，访问数据后未确认禁止降级；候选显式暂存不冒称公开下载。报告 `test-results/release-r3/candidate-43608615116/report.json`。
- 公开资源 Release [runtime-c0.1.17](https://github.com/nan023062/cbim/releases/tag/runtime-c0.1.17)，ID 445199186。R3 ZIP asset 747876695，4044795 字节，SHA-256 `ff7a3c9e06c647d7e9eed598fbd2082f927ebaad8d7ef1dbe2c90b082831394a`；签名清单 payload 摘要 `e40bbe65cc23f0a0ac187f0d4776bf9de0baff4e7150a2d9c04af9c89e3d5981`。
- `pnpm publish:runtime build/runtime/c0.1.17-r3-n0d9ki` 完成附件及 latest.json 上传后，最后回读报告“公开通道回读不符”，exit 1；保留 `publish-output.log`。没有重发、覆盖 ZIP 或重复调用发布器。按远端 Release ID 核实 latest.json asset 747890189 于 2026-11-14T15:23:58Z 上传完成，文件摘要 `5a22e280eb001663ab9d831bced9f3066a9f2a82cde286ce130894af7c1182b0` 与本地一致。2026-11-14T15:25:34Z 用客户端原始地址匿名读取，验签、payload 与签名全部匹配 R3。首次回读原响应未保留，缓存原因未被直接证实；仅记录短时不一致及恢复后的证据，不把推测写成根因。
- 原 Python latest 仍为 327801733 / v1.0.2；desktop-v0.1.17 四附件保持原摘要，安装器仍为 `e7a3753a348bc9029c3d71532289c5a25ef31cce4a0596f7a4583715628c6102`。四个 E 描述与 R2 完全一致，公钥 SPKI DER 摘要仍为 `378c827bf38efb6724466bbb39d3e39ee4ef2dc1de2576fa1fde760443145c49`。

R2/R3 文件清单共 9 项新增/替换/删除差异：5 项前端 HTML/JS/CSS 路径及 4 项随包开发、版本和验证说明。主进程、固定启动器和 E 不变。后续证据回填不会覆盖已公开资源中的冻结文档副本。

## 公开升级与收尾

- [公开升级 43610142288](https://github.com/nan023062/cbim/actions/runs/43610142288) 已通过，工作流引用冻结标签 `runtime-c0.1.17-r3`，head 为 df113741。真实 C 0.1.17 / R1 使用原匿名更新通道发现并下载 R3；普通退出仍 R1，实际 UI 点击后新 PID 4528 在同一安装路径运行，重开确认 R3。2026-11-14T15:29:10Z 完成。
- 原工作区、知识、模型、同一 completed task/run、业务文件和 localStorage 保留；旧主题与新字号保存检查通过。确定性模型请求 1 次，任务重放 0，页面错误 0。报告 `test-results/release-r3/online-43610142288/report.json` 与 `actual-restart.json`。仅在隔离 runner 测试，没有操作用户生产安装。
- 公开升级与候选校验使用同一资源摘要；本次专门验证 R1 → R3，不把结果扩写为单独测试 R2 → R3、外部模型质量或所有用户已更新。
- 官网、README 和本记录按真实公开清单更新。基础安装元数据继续指向 C 0.1.17 / 内置 R1；在线资源为 R3 / 4044795 字节，不把资源 ZIP 标作安装器。后续源码文档只补证据，不覆盖公开包中冻结副本。官网 CI、master 部署与最终双分支 SHA 以收尾 PR 回执为准。

官网本地验证：`CBIM_WEBSITE_URL=https://nan023062.github.io/cbim/ node scripts/ci-website-smoke.mjs`（含构建与品牌）通过 14 场景，覆盖 320/390/1280 px、明暗主题及两页独立离线；0 页面错误、无横向溢出，安装链接与原安装器摘要一致。报告 `test-results/branding-website/website-report.json`；上次报告已单独保留。本次收尾仅 README、website 与发布记录，不重复产品全量。
