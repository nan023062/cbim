# C 0.1.15 / R2 发布记录

2026-11-13 更新：R2 已投放原签名资源通道，准确 PR head 的完整 Windows 四片与真实旧客户端在线升级均通过。C 0.1.15 安装包和三个引擎未替换。官网文案与发布快照在后续独立收尾 PR 同步，其合并、Pages 部署及匿名文件核验的最终回执回填该 PR；不将本文件的合并前记录当作部署回执。

用户授权发布新版本并提交、推送本地全部改动。仓库和账号为 `nan023062/cbim` / `nan023062`；旧 Python latest 为 `327801733 / v1.0.2`。本次沿用已公开 C 0.1.15 和原 Ed25519 身份，只发布 R2，三个 E 不变，不重新签发或替换 Windows 安装包。

已提交本地清理、通用代码检查、有界返工及安全结果恢复为 `013eb98a`，合入已公开 0.1.15 修复为 `b3122016` 并推送 develop。冲突仅涉及文档记录和等价的 bootstrap 依赖测试规则；保留两侧成果。合并消费者 4 文件/11 项通过，类型、架构、品牌及官网构建通过。历史专项证据见[返工与恢复](automatic-rework-recovery-20261112.md)；发布仍须此次准确 head 的完整四片 CI。

新增 `runtime-acceptance.yml` 与 `runtime-release-acceptance.ts`：仅在无现有安装的隔离 GitHub Windows runner 安装真实 0.1.15。候选模式通过原公钥核对签名、暂存完整 R2、验证普通退出和真实冷壳激活及数据保留，失败分支使用实际候选和选择器验证，明确不是原生恢复窗口 UI；在线模式由真实旧客户端匿名下载、普通退出、UI 点击和真实新进程验证，不替换下载源。

验收脚本单独严格 TypeScript 检查通过；首次发现环境映射、IPC 多余字段和配置字面量类型问题，修正后通过。产品常规 tsconfig 不包含 scripts，不能用产品类型检查代替该项。以下按阶段记录实际回执。

## 冻结候选与隔离验收

- 冻结源码 `e5e7fc471af39c05dd856f7e8016f43df3b01b89`；唯一候选 `build/runtime/c0.1.15-r2-utN5mA`。冷包实际来自原 `unsigned-20261112-193123-7bd6a308/runtime`；C 指纹 `1bbb10bf276fad5bb811872d62f0f472bda0249a592db2a43c202a7c2a9cdc47`、公钥及三个 E 完全沿用。
- 清单 payload 摘要 `b0e0c5712a558dcad80190f2463da16cf0daf90114a7b9a74a62632af29bf123`；R ZIP 为 3,934,130 字节，SHA-256 `3e2da486b30edb71762435d908cb14590c49375d89832f99039b65519a63deee`。此大小仅为资源 ZIP，不包括清单、首次引擎下载或安装包。
- 唯一草稿 `runtime-c0.1.15-r2-candidate` / Release `443146945`，目标为冻结源码；R ZIP、`latest.json`、`runtime-cold.json` 已上传并核对。此验收草稿保持未公开；正式投放使用下述既有 `runtime-c0.1.15` 通道。
- 构建曾因本机配置 CRLF/LF 字节与旧冷包不一致而拒绝。核对 Git 规范化内容及编译启动器相同后，恢复原冷包的准确配置字节再构建，未改变指纹或放宽验证。首次远程 E 验证下载停滞，保留日志并停止本次进程；复制原候选中摘要相同的三个 E 后，完整 `pnpm verify:runtime build/runtime/c0.1.15-r2-utN5mA` 通过。
- [候选验收 43249744548](https://github.com/nan023062/cbim/actions/runs/43249744548) 首次失败于 Electron 主进程 evaluate 中没有 `require`；改用 `process.getBuiltinModule`。草稿 tag API 的 404 则改由有权限的分页列表定位既有 ID，没有重复创建 Release。
- [候选验收 43250200307](https://github.com/nan023062/cbim/actions/runs/43250200307) 通过，验证脚本 head `4ef4515da2c8650c79562babad032c48ce64f857`，artifact `13958013830`。真实 C 0.1.15 安装包 SHA-256 `b9a8ecbf29e2a285f2dd963fad5379f306f7c4fba9e11bc35ff9eeefee019a69`；真实冷壳激活 R2，工作区、知识、模型、同一已完成任务、文件和 localStorage 保留，模型请求恰为 1、页面错误为 0。加载前损坏隔离回退和数据访问后拒绝降级两项通过；后两项使用实际选择器，不冒充恢复窗口 UI。

## 全量 CI 暴露的旧测试消费者

- [PR #61](https://github.com/nan023062/cbim/pull/61) 的完整 [CI 43250212464](https://github.com/nan023062/cbim/actions/runs/43250212464)，head `4ef4515d`，四片合计 2,858 通过、8 失败、2 历史跳过。原失败报告逐片保存在 `test-results/release-r2/ci-43250212464/`，没有覆盖。
- 失败集中在 `scope-wait-pi`、`human-continuation-pi`、`queued-task-cancel-pi`、`active-goal-input-pi`、`goal-review-pi` 的负向路径。新系统允许缺少完成审阅时有限反馈；旧确定性供应商只接受原回合数，额外回合导致供应商错误，或滑入仅属于用户显式接续的脚本分支。修正测试供应商继续返回同样的无效结论，逐一验证两次无进展后失败、原权限/输入/人工条件不变、旧成员不重跑、队列不自动消费、重启不重放。
- 仅修改 9 个测试文件，未改产品、安全判定或候选。定向命令 `pnpm exec vitest run tests/scope-wait-pi.test.ts tests/human-continuation-pi.test.ts tests/queued-task-cancel-pi.test.ts --reporter=default --reporter=json --outputFile=test-results/release-r2/repair-consumers.json`：3 文件 / 14 项通过；`pnpm exec vitest run tests/goal-review-pi.test.ts tests/active-goal-input-pi.test.ts --reporter=default --reporter=json --outputFile=test-results/release-r2/repair-input-review.json`：2 文件 / 14 项通过。`git diff --check` 通过；随后完成下述准确 head 全量验证。
- 冻结后差异仅为测试、验收脚本和发布记录，不改变产品、依赖、构建配置、品牌、内置更新日志或 Builtins 运行资料。`collectResources` 会复制整个 `design/`，因此候选仍保留冻结时的发布报告与开发记录；仓库后续回填不是候选中的资源字节，不声称两者逐字节相同，也不追改已冻结 ZIP。

## 完整检查、公开与真实在线升级

- [完整 CI 43253752246](https://github.com/nan023062/cbim/actions/runs/43253752246) 在 `84c723f78d3d48b00d95e40183e9ec1d71382594` 上四片全部通过：426 文件、2,866 项通过、0 失败、2 跳过。类型、架构与依赖、品牌和官网构建均通过。两项历史跳过是 `owner-execution-legacy` 的 pre-owner EXE 和 `knowledge-source-lifecycle-application` 的 pre-source EXE；runner 不具备指定旧二进制，保留原 skip 条件，未新增跳过。
- PR #61 正常 merge（未使用 admin/squash）为 `f3b8cf693296e3530ecacc09c8740aeb822eb904`，冻结源码可追溯至 master，合并未引入其他产品或构建差异；develop 当时已快进同步。公开前再次执行 `verify:runtime`，同一清单、R 和全部 E 的本地验证通过。
- 在冻结源码的干净独立 worktree 调用现有 `scripts/publish-runtime.ts`。第一次看到目录列表显示 0 字节便停止了本次发布进程；后续直接打开文件句柄读到 131,349,245 字节，确认 Windows 目录元数据不及时反映正在写入的文件。因此不能把第一次观察当成已证实的网络停滞。异步进程退出期间一次恢复尝试被 `EEXIST` 锁保护拒绝；确认原进程均退出、锁路径和内容正确后清理遗留锁，恢复同一候选，未覆盖 R/E ZIP。
- 恢复发布完成 R 和全部 E 的匿名大小/摘要核验，最后上传 R2 清单。脚本随后因旧缓存回读 R1 而返回失败；GitHub API 已显示 R2，带诊断查询参数的匿名源读取也验证了 R2 签名，随后未经修改的固定公开 URL 同样读到 R2。没有再覆盖清单来解决缓存，保留各次日志及诊断结果。
- 正式通道：[runtime-c0.1.15](https://github.com/nan023062/cbim/releases/tag/runtime-c0.1.15)，Release `442909771`，公开、prerelease、非 latest。R2 `latest.json` asset `740181988` 更新于 `2026-11-12T16:24:04Z`（北京时间 2026-11-13 00:24:04），3,702,241 字节，SHA-256 `9265203e85f5618521ba3e1d919dbc7e6f26ac2033c6581c8a02ee489e1bcaf6`；清单 payload 摘要和 R ZIP 与冻结候选一致。R1 ZIP 保留；三个 E、旧冷安装附件及旧 Python latest `327801733 / v1.0.2` 未变。
- [真实在线升级 43258611285](https://github.com/nan023062/cbim/actions/runs/43258611285) 通过，workflow head 为 `f3b8cf69`，完成于 `2026-11-12T16:29:08.747Z`。干净 Windows 安装真正公开的 C 0.1.15 / R1，原定时器从固定匿名公开通道发现并准备 R2；普通退出和重新启动仍为 R1，实际点击侧栏“版本与更新”后观察真实重启进程和 R2 确认日志。未替换网络响应或调用安装器冒充在线升级。
- 在线报告：原工作区自动恢复、知识版本和全部文件、模型、同一 completed task/run、业务文件与 localStorage 均保留；模型请求恰为 1、页面错误为 0。候选/在线报告和原进程回执分别保存在 `test-results/release-r2/candidate-43250200307/` 与 `online-43258611285/`，对应 Actions artifact 可下载。
- 官网使用真实 R2 清单更新时间，保留 C 0.1.15 安装包的原大小/摘要/下载地址，明确安装包内置 R1、安装后准备 R2。`pnpm check:brand`、`pnpm build:website` 与 `node scripts/website-smoke.mjs` 通过：320/390/1280 px、深浅色、独立离线两页共 14 场景，零页面错误、无横向溢出，下载链接与摘要正确。历史官网报告移至 `test-results/release-r2/website-before-r2-20261113/`，本次报告为 `test-results/branding-website/website-report.json`。

所有证据分别保存于 `test-results/release-r2/`、唯一 runtime 候选目录及对应 Actions artifacts；不覆盖原失败。Windows 冷包仍未签名，R2 清单签名不替代 Authenticode。测试使用确定性 localhost 模型，只证明数据保留与无重放，不证明模型质量。
