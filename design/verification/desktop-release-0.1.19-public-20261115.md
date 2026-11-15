# CBIM Desktop 0.1.19 公开发布验证

本记录区分候选安装、公开通道、实际在线升级及官网结果。产品定位为本地／多端 AI Native 工作流工具，当前面向单人使用；保留本地 Agent 任务与交接，不建设账号或多人协作服务。P4、Git、飞书等工程团队协作是未来插件/连接器方向，不代表本版已经具备完整多端同步。

## 版本与签名

- 冻结提交：`1c498878e07b38da4a91454342bb8cb15511c2a1`，PR [#88](https://github.com/nan023062/cbim/pull/88)，修复 Issue [#89](https://github.com/nan023062/cbim/issues/89)。
- 候选：`unsigned-20261115-155403-af5865e8`；C 0.1.19 / R1。
- 安装器：`CBIM-Setup-0.1.19-x64.exe`，112,368,217 字节，SHA-256 `2ad92a1bebf12223cb9c6a7bd742002b0acfc931f07555c8bc1424974aca1674`。
- Windows 安装器与应用未签名（`NotSigned`），发布者未验证。资源清单使用 Ed25519，不能代替 Windows 代码签名。
- 新公钥 SPKI DER SHA-256：`c3ef7bbabd7b1a03eb5faf3f755d0dc728969585e573d5ce937411b4a314a31f`；公开 PEM 在 [版本资料](../releases/runtime-c0.1.19-public-key.pem)。私钥在仓库外受限目录，未输出或上传；尚无独立离线备份证据。
- 打包 `app.asar` 冷配置与公开 PEM 完全一致；初始清单与候选 R1 一致，原签名通过，篡改签名拒绝。

## 原失败与修复

首次 8db77b84 候选安装 run [43690888838](https://github.com/nan023062/cbim/actions/runs/43690888838) 在升级后的 `engines.settings` 报“更新清单签名无效”。新安装已成功；失败发生在用新钥重验旧 E 来源。原草稿 445887676 保留原附件，改为 `candidate-desktop-v0.1.19-rejected-8db77b84`，没有公开或覆盖旧发布版本。

EngineArtifacts 现在仅对本机历史来源接受冷宿主固定的既有公钥；新启动资源和远程 E 索引仍只接受当前钥。既有公钥 SHA-256 `378c827bf38efb6724466bbb39d3e39ee4ef2dc1de2576fa1fde760443145c49` 已验证公开 0.1.18/R2 签名。新 E 索引使用 `latest-c3ef7bbabd7b1a03eb5faf3f755d0dc728969585e573d5ce937411b4a314a31f.json`，序号 2；原 `latest.json` 的 SHA-256 `dea69681af37348fe1e520d839a907ff6af93897224dbc5d341a81515bf7bc5e` 保持不变。历史公钥不授权新资源启动，也不授权新的远程 E 更新。

## 已执行的候选检查

- 定向 4 文件 13 项通过：制品服务、签名索引/地址、签名工具以及引擎缓存消费者契约；覆盖换钥、离线复用、停用、未授权钥、远程旧签名和篡改。
- `pnpm typecheck`、`pnpm check:architecture`、`pnpm check:test-modules` 通过：134 个架构目录，1629 文件/7712 条含类型依赖，0 循环，530 个测试文件登记。
- `pnpm make:desktop --unsigned`、`pnpm verify:desktop <本次候选> --unsigned` 通过。构建完成后源提交与工作树未变化。
- 实际本次 EXE 的 6 个隔离场景通过：文件边界、禁网、超时、取消、非零退出、输出上限；使用独立临时环境，没有安装到开发者正在使用的客户端。
- 4 个 E 附件匿名下载、长度和 SHA-256 核对通过；新候选 E 描述与这些附件相同。新钥 E 索引追加到既有 prerelease 运行库，回读验签成功，旧索引附件未修改。
- [候选安装 43692274811](https://github.com/nan023062/cbim/actions/runs/43692274811) 通过：隔离 Windows 全新安装、真实 Pi 首次下载、15340 个 E 文件核验、0.1.18 覆盖升级、原工作区/模型/对话/localStorage/知识/业务文件/主 Agent 配置/自动化/引擎安装及停用和缓存保留。2 次确定性模型请求，迁移仅 1 次，无业务重放，0 页面错误。新客户端真实 `engines.check` 成功，检查后原状态不变。

候选覆盖安装不等于公开在线升级；上面的 candidate 报告 `differentialDownload=false`，不据此宣称差分通过。

## 正式发布与在线验收

- [完整 CI 43692077886](https://github.com/nan023062/cbim/actions/runs/43692077886)：四片 Windows、静态检查与统一汇总全部通过。下载 JSON 实际汇总 530 文件、3567 项：3565 通过、0 失败、2 跳过。跳过项为 `knowledge-source-lifecycle-application` 的真实 pre-source EXE 和 `owner-execution-legacy` 的真实 pre-owner EXE，缺少对应历史制品，未删除覆盖。
- PR #88 正常合并，master 为 `14c35169114c43c9b34a51be07c19099e878b760`；合并树与冻结 1c498878 无文件差异。标签 `desktop-v0.1.19` 指向冻结源码，没有移动旧标签。
- [桌面 Release](https://github.com/nan023062/cbim/releases/tag/desktop-v0.1.19) ID `445896208`，公开时间 `2026-11-15T08:16:07Z`，非草稿、非预发布。独立 Python latest 仍为 `v1.0.2` / `327801733`。
- [R1 资源](https://github.com/nan023062/cbim/releases/tag/runtime-c0.1.19) ID `445902185`；资源 ZIP 4,512,553 字节，SHA-256 `345838bdbba15765daed54025cd3f4c29e5fda4fe1db151bc6a07f54b9538bdd`；签名 payload 摘要 `ae6142ce8da384cfb21b1c1b752bb22119d68eacb3d2e999cfdf1e420610c8c8`。
- 首次最终回读失败：清单上传前的 404 被缓存；远端实际已有正确附件。只读刷新后用原客户端地址重新验签成功，没有重复上传或覆盖制品。公开列表最初也返回旧快照，刷新后原客户端发现函数识别 0.1.19。
- 四个桌面附件均匿名下载核对真实字节。安装器见上文；blockmap SHA-256 `25f9ce6954d3a93eab84b2c40496fd195992641757488e12eecd27eea3d029e2`；latest.yml 为 `f298f1f17880e7b75860f884ad7d32f555b94b91232bd9ad234deeea3206d178`；SHA256SUMS.txt 为 `42c19ba4ba511d868bb198f9c09dae8bb589fb186ed70f7e778a121bd70f18ee`。

公开在线升级 run [43693725655](https://github.com/nan023062/cbim/actions/runs/43693725655) 通过，完成时间 `2026-11-15T08:22:43.285Z`。真实路径为 0.1.18/R1 → 原公开 R2 → 0.1.19/R1：原客户端计时器发现公开版本，后台下载，普通退出不应用 R 或安装 C；重开复用准确缓存，由真实界面点击后安装并恢复同一用户目录。11 次 HTTP Range、0 次全量回退，实际安装器载荷 2,941,791 字节，最终缓存仍为完整 112,368,217 字节且摘要匹配。原模型、完成对话、工作区、知识与业务文件、主 Agent 设置、自动化和引擎安装/停用/缓存全部保留；2 次模型请求（全新与迁移各 1）、无重放、0 页面错误。

## 官网检查

依据公开回执更新版本、大小、摘要与时间，保留 0.1.18/R2 和 R1 的固定历史链接。文案明确本地 AI 工作流与未来多端/连接器边界。`pnpm check:brand`、`pnpm build:website` 通过；首次直接运行 browser smoke 因未启动预览服务报连接拒绝，改用既有 `node scripts/ci-website-smoke.mjs` 完整入口后，14 个场景通过、0 页面错误。覆盖 320/390/1280px、明暗主题、校验详情与导航，以及两页分别独立打开；审阅了实际桌面首页截图。GitHub Pages 部署、匿名页面及双分支同步的最终回执记录在 [PR #88](https://github.com/nan023062/cbim/pull/88) 评论中，不将本地构建当作已上线，也不为回填自身提交 SHA 重建已公开制品。

## 验证边界

- 原用户桌面逐页人工验收此前因前台激活失败受阻；隔离 UI 与安装验收不能代替该范围。7 个聚合/扩展设计不等于全部产品能力完成；详见 [UX 整合](ux-integration-20261115.md) 与 [单人工作流](ux-single-user-20261115.md)。
- 历史 EXE 缺失的两项条件测试不等于通过；完整 CI 的具体数量以本次 JSON 汇总为准。
- 模型请求使用确定性本机服务，用于验证流程与无重放，不代表外部模型质量或 Memory 真实双模型已验收。
- 本次发行后的官网/README/验证记录属于收尾提交，冻结安装包保留构建时的 design/docs/legal 副本；不声称后续记录与原包全部资源字节一致，不修改已冻结或已公开包来补记录。
- 公共升级通过只证明隔离环境的真实路径，不代表所有用户已经升级。
