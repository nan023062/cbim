# CBIM 0.1.21 公开发布与验收（2026-11-16）

已公开 [desktop-v0.1.21](https://github.com/nan023062/cbim/releases/tag/desktop-v0.1.21)，Release ID 446663181，发布时间 2026-11-16T06:16:17Z。Windows 安装包未签名（NotSigned），发布者未验证；沿用 0.1.19 的 Ed25519 资源身份，不输出或上传私钥。用户已明确授权未签名发行及本次公开发布。

## 源码与冻结制品

- 源码及标签：`a87be67c336b5bcf4892097f736c7b6ade84ca10`。
- [PR #96](https://github.com/nan023062/cbim/pull/96) 正常 merge：`dd940b51ffc9c80074315e36340ac5aee612149f`。源与合并提交完整文件 diff 为空，未 squash、未绕过检查。
- 构建：`pnpm make:desktop --unsigned`；唯一候选 `build/desktop-release/0.1.21/unsigned-20261116-140004-7f564f97`，对应打包目录 `build/unsigned-20261116-140004-7f564f97/CBIM Assistant-win32-x64`。
- `pnpm verify:desktop <候选目录> --unsigned` 通过；四个远端附件逐一匹配本地大小和 SHA-256。
- 旧草稿 446073270 保留为 `candidate-desktop-v0.1.21-rejected-6541c41d`，原附件未删除、未覆盖。公开标签首次创建于冻结 source SHA。
- 旧 Python latest ID 327801733 / v1.0.2 保持不变；桌面公开使用 make_latest=false。

| 附件 | 字节 | SHA-256 |
| --- | ---: | --- |
| CBIM-Setup-0.1.21-x64.exe | 110421450 | 257832b956ab3c6d2a5f94a05bde46de5d21bd677a41cc81cdee89ad5c357f17 |
| CBIM-Setup-0.1.21-x64.exe.blockmap | 117162 | 380d8bdd30887a61e6c88b791b9a17d7c6fd1831d8609da181d01a39d70e0979 |
| latest.yml | 348 | 2d4c9a32646f50edeb908702da834856ab71652838449fc61de8e271fded4a12 |

SHA256SUMS.txt 是第四附件：270 字节，SHA-256 2acf1e51c55f3e7515c051c0bee32f63337091b8e908ddcbee1fbd859b90658e；逐项核对结果保存在候选 release-journal.jsonl。匿名 latest.yml 下载字节与上表一致，公开在线升级另见下文。

## 完整 CI 与打包程序

[CI 43810478834](https://github.com/nan023062/cbim/actions/runs/43810478834) 精确 head 为上述 source；四片分别 1135、881、894、806 通过，共 3716 通过、0 失败、2 skipped；静态检查及统一汇总成功。两项跳过均要求真实历史 EXE：pre-owner queued/running/checkpoint 迁移，以及 fixed pre-source EXE 的旧来源能力采纳；没有用现代包冒充旧包。这不等于覆盖全部历史版本。

- 精确 CBIM_TEST_EXE 的 isolated-node-smoke：文件边界、禁网、超时、取消、非零退出、输出上限六场景通过（build/isolation-a87be67c.json）。
- brand-desktop-smoke：欢迎页图标加载、EXE/安装器 32px 图标像素比对和资源摘要通过（build/brand-a87be67c）。
- 新打包程序中的真实主对话发送、Agent 文件读取、同根问题展示、带清单输入、UI 答复和第二个 Agent 回流通过；4 次主模型请求、10 次子模型请求，页面错误为零。输入导入/插入使用真实 IPC，不声称点选文件对话框已覆盖。图像及报告：build/desktop-agent-a87-verified。
- 首次临时 UI 验收脚本误写子模型请求数为 6，实际两个五回合子调用为 10；更正测试计数后在独立 profile 复验通过。原失败保留在 build/desktop-agent-a87，未修改产品或减少行为断言。
- 模型响应为确定性本地响应，Pi、工具、文件、IPC、打包 EXE 和更新网络均为真实对象；不代表在线模型质量。旧频道/派工 UI 脚本不是新递归界面的通过证据。

## 隔离安装及真实在线升级

[候选验收 43814256639](https://github.com/nan023062/cbim/actions/runs/43814256639)：全新安装、0.1.19 候选覆盖升级、isPackaged、NotSigned、安装器缓存摘要全部通过。全新 profile 从固定公开源下载 Pi，验证 15340 文件并完成真实模型请求。候选覆盖不冒充在线更新。

[在线验收 43815613945](https://github.com/nan023062/cbim/actions/runs/43815613945)：实际 0.1.19 安装版无登录发现 0.1.21，后台预下载，普通退出仍为旧版，重新启动复用缓存，显式 UI 安装后新进程为 0.1.21 并携带原用户目录。9 个 Range 请求、0 次全量下载，已完成安装器 payload 4215948 字节，小于完整安装包。无页面错误、无任务重放。

保留项均通过：工作区、模型、同一已完成会话、localStorage、文件标记、知识、业务文件、主 Agent 配置、自动化、引擎安装状态及缓存。在线报告迁移模型请求 1 次，另有全新 profile 的 1 次请求；不是升级后重放。制品与报告按独立 run 保存于 build/acceptance-a87-43814256639 和 build/online-a87-43815613945。

## 资源与官网

[签名资源 C 0.1.21 / R1](https://github.com/nan023062/cbim/releases/tag/runtime-c0.1.21)，Release ID 446668728。清单 payload 摘要 a4491baf0ab9ec06f06cb62b937430e90ad7a41681a3a146e0e6a3aa394feb67；资源 ZIP 1344092 字节，SHA-256 76fe2be470fccbb2d1a9efc522f45f422ad4e353f189efb392949fecef272fbd。公钥 SPKI 摘要 c3ef7bbabd7b1a03eb5faf3f755d0dc728969585e573d5ce937411b4a314a31f，四个 E 包继续复用公开固定哈希附件。

首次 publish:runtime 在清单上传后的最终匿名回读失败；随后按远端 ID 核实 latest.json 已存在，不把报错当作未发生发布，不重建 Release、不替换安装包。第二次执行完成 R/E 公开附件验证后，检测到清单前后可见性不同，拒绝再次切换。随后独立匿名下载公开 latest.json，逐字节等于已验签候选，完整文件 SHA-256 为 ffae1d7b49016eae7614f3704f7bd54b32e7b10fc179c3c567e0dc288111f6f0；确认当前清单正确，不再重发。两次失败与纠正回执保留在候选日志，不能把中途报错说成整次未发布。

官网 release.json 从实际公开安装包及资源回执生成；同步连续对话、递归工具、引擎下拉菜单、恢复边界及未签名提示。保留 canonical、Search Console、robots 和 sitemap。check:brand、build:website 通过；独立新 worktree 的网站检查 14 场景通过，页面错误为零，覆盖 320/390/1280px、明暗模式和离线页面。部署与匿名六文件对照以官网收尾 PR / Pages run 为准，不使用此文档尚不存在的最终 SHA。

## 明确边界

本版不提供多人协作服务或完整多端同步；跨进程未知暂停不自动重建，旧运行汇总预算不支持递归。已验证从 0.1.19 升级，不声称所有旧版或所有用户已经升级。安装包未签名，资源签名不能替代 Windows 发布者身份。公开制品不覆盖；后续产品修复使用更高版本。
