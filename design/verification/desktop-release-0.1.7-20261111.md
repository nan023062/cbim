# CBIM 0.1.7 发布验收

## 交付范围与来源

用户授权完成当时未关闭的 Issue、提交 PR、正常合并并发布；沿用已明确的 Windows x64 未签名个人开发发行。三个执行引擎与主 Agent 共用设置已在 0.1.6 交付，本版保留。

- #27 知识回执与校验展示：21d46da22ee6869eb3a039abbbfec7ee27441ca1。#28 隐式负责人、文件树和治理入口：db961c97829b3b15f2448565f0aba2e496d983cb。#29 当前工作区自动化与窗口标题：642dd3500fe24a3348ff021604eabb762674646f。各工单独立开发、验证和提交。
- 一并保留查询、历史存储、请求预算端口、引擎工具目录、共享执行展示和类型化模型 IPC。依赖无环不表示宽 Store、运行时职责和全部旧 IPC 已治理完毕。
- 仓库/执行账号：nan023062/cbim / nan023062。默认分支 develop，稳定及官网部署分支 master。
- 构建冻结：f18c2fe9b2a189c1dc31f63d60de83a7b6d6833f。验证 head：12ac487f7b05697592d0c0b6b237ff6df2c5163f。二者只差四个测试文件和 development-log 维护记录；产品、依赖、打包脚本、品牌和内置版本日志未变，因此不重建候选。
- [PR #34](https://github.com/nan023062/cbim/pull/34) 正常 merge，提交 ef84d1b1bd1e475ee220f91814858349e9537e71；parents 为 7fad631e8692ff2b5845e899ed49915c72d0faa4 与 12ac487f。没有 squash 或管理员绕过。冻结提交是该合并的祖先。
- 主工作树 develop 上未提交的规范/审计文档原样保留，不纳入本次发布。
- 上一公开桌面版 desktop-v0.1.6 / Release 440090082。旧 Python latest 327801733 / v1.0.2 在公开前后均未改变。

## 同一候选与四附件

- 候选目录：C:\XDTWorkspace\cbim-ai\build\architecture-query-20261110\build\desktop-release\0.1.7\unsigned-20261111-025632-11ed4d4f。
- buildStamp：20261111-025632（Asia/Shanghai）。packagedDirectory：C:\XDTWorkspace\cbim-ai\build\architecture-query-20261110\build\unsigned-20261111-025632-11ed4d4f\CBIM Assistant-win32-x64。
- 主程序 CBIM Desktop.exe SHA-256：e1d962e1fc5f4adb3843f56b086514be4216ee5755e19333cbebf55dc054a5ed。47 个 Windows payload 与资源摘要在候选 build-receipt.json。
- 显式 pnpm make:desktop --unsigned。构建后与公开前分别 pnpm verify:desktop 该候选 --unsigned，均通过。实际签名 NotSigned，没有 publisherName，也没有用摘要冒充签名。验收没有操作开发者正在使用的客户端。
- 唯一 Release ID 440782281，公开时间 2026-11-11T01:50:02Z，稳定版、非预发布、非草稿。公开页：https://github.com/nan023062/cbim/releases/tag/desktop-v0.1.7。公开 PATCH 使用 make_latest=false。注解标签对象 835bf6c1d4b620072021b753603d7a81d606352a，peeled commit 为冻结源码。

| 附件 | 字节 | SHA-256 | asset ID |
| --- | ---: | --- | ---: |
| CBIM-Setup-0.1.7-x64.exe | 391247521 | bad2f872f3c9dd5bbc3f4979feebd906656c5af340bc89592c29d53757d0ff86 | 732587471 |
| CBIM-Setup-0.1.7-x64.exe.blockmap | 407634 | d2ceb8120d7d4332f2e8765a2af3e5fe378fa179337da4c1c4bc9ef2b52ba1ef | 732587464 |
| latest.yml | 345 | c542d9b428f8e8d3a3bd4ed1c7a8936e9ab22ce1fa79431ba3dd7822cf81003b | 732587467 |
| SHA256SUMS.txt | 268 | 2e9d5146149a306a399329b8d36723e287eb788c997a5dd0f5c59da892676f8a | 732587468 |

四附件远端 state=uploaded，摘要和大小与本地候选一致。latest.yml 中安装包 SHA-512 为 H1wAtoimtAE+WrUol3CzDV7udU58deDVv95zRkUY/M6MXnVmtmEXJWaf5MiHui7XQXlxDy6jGi0Ysn75nBvDYA==，大小 391247521。未登录读取 latest.yml 与 SHA256SUMS.txt，SHA-256 与上表一致；安装地址匿名返回 206，Content-Range 总长度为 391247521。没有再次整包下载后重算安装包哈希。

## 实际验证

| 验证 | 结果与边界 |
| --- | --- |
| 开发受影响单元 | #27 八文件 62 用例；#28 十六文件 97 用例；#29 八文件 65 个独立用例。命令与一次失败修复见 development-log，不把分次重复计入独立用例。 |
| 静态检查 | pnpm typecheck 通过。pnpm check:architecture：58 目录/630 代码样式、1227 文件/6278 含类型依赖，0 循环、0 文档差异。发布输入 25 用例通过，纳入实际 0.1.6 的自动安装交互。 |
| 首次四片 CI | https://github.com/nan023062/cbim/actions/runs/42880217010 ，head f18c2fe9。384 文件、2633 用例：2626 通过、5 失败、2 原有历史 EXE 跳过。四个失败是治理 Skill 后目录数 29 变为 31；坏回包用例被 64K 原生摘要误判。原日志保留。 |
| 修正后定向用例 | 知识两文件六用例通过。坏回包仅该组改为 128K，产品摘要、重试、预算、超时和调度未改；四用例通过（36.92s）。pnpm typecheck 通过。 |
| 修正后四片 CI | https://github.com/nan023062/cbim/actions/runs/42883526839 ，head 12ac487f，base 7fad631e，四片 success。Vitest 410 suites / 2633 tests：2631 通过、0 失败、2 跳过。 |
| 真实打包 EXE | 三引擎可见；自动化保存不执行，明确运行一次，历史打开原 task/run；知识树预览/编辑并阻止坏 JSON。0 页面错误，确定性模型请求 1 次。六项隔离通过，网络请求 0。 |
| 候选安装 | https://github.com/nan023062/cbim/actions/runs/42881228441 ，workflow/source f18c2fe9。全新安装与真实 0.1.6 到 0.1.7 覆盖升级通过；isPackaged=true、NotSigned。六项保留、1 次模型请求、0 页面错误。 |
| 公开在线升级 | https://github.com/nan023062/cbim/actions/runs/42941852527 ，workflow master ef84d1b1；previous_version=0.1.6，mode=online，source f18c2fe9。旧版无凭据发现 0.1.7，实际点击下载，缓存摘要匹配。 |
| 退出取消与重启 | 自动安装窗口内普通退出后仍为 0.1.6，缓存摘要正确。再次下载后自动安装；新进程带 --updated 和原 --cbim-user-data-root。六项保留、1 次模型请求、0 页面错误、最终 phase=current、NotSigned。 |
| 官网本机验收 | 公开回执写入 website/release.json，signed=false。首页发布卡、下载日志/FAQ 和 README 改为 0.1.7。pnpm check:brand 通过。以 https://nan023062.github.io/cbim/ 构建后，node scripts/website-smoke.mjs：14 场景通过，0 页面错误。 |

两项跳过仍是 owner-execution-legacy.test.ts 与 knowledge-source-lifecycle-application.test.ts，runner 没有指定历史 EXE，不是本次新增。候选安装和在线升级不代替这两项历史恢复用例。确定性模型只证明真实引擎、界面和生命周期，不代表在线模型质量。测试与代码自查不等于人工 review 已接受。

## 资源与收尾边界

Forge 复制整份 design、docs 和 legal。安装包内 development-log 保持冻结副本，不能把后续仓库记录说成包内字节一致。Builtins 白名单 24 项与候选逐项一致，revision 59172c4ac8d3d02c4e3e427c39ec57fac16e914da61edad8b797b15662d935bb。

官网与本记录只改 website、README 和开发/验证文档，不改产品、依赖、品牌、内置版本日志或构建配置，因此不重做安装包。官网 PR 的完整 CI、master Pages 部署、匿名六文件摘要和 develop 快进，记在该 PR，不为填写部署 SHA 再提交。主工作树的本地分叉和未提交文档保留，不强推、不重置。

## 更新节奏与限制

0.1.3 起每分钟检查；用户点击下载后自动校验、展示进度、排空并安装重启。0.1.2 及更早仍是下载后再确认重启。关闭或离线的客户端不会即时升级，不能声称所有用户已经安装。未签名限制仍在，后续签名使用更高版本。自动化只在 CBIM 运行且工作区打开时触发；错过不补跑，同项不重叠，未知结果不重放。执行结束不等于业务验收通过。

## 原始证据

本机证据在 architecture-query worktree 的 test-results：desktop-017-*、ci-42880217010、ci-42883526839、candidate-42881228441、online-42941852527、desktop-017-anon，以及 branding-website/website-report.json。发布过程追加在候选 publication.jsonl。云端 artifact 按 run ID 保存。
