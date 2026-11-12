# C 0.1.15 / R2 发布记录

用户授权发布新版本并提交、推送本地全部改动。仓库和账号为 `nan023062/cbim` / `nan023062`；旧 Python latest 为 `327801733 / v1.0.2`。本次沿用已公开 C 0.1.15 和原 Ed25519 身份，只发布 R2，三个 E 不变，不重新签发或替换 Windows 安装包。

已提交本地清理、通用代码检查、有界返工及安全结果恢复为 `013eb98a`，合入已公开 0.1.15 修复为 `b3122016` 并推送 develop。冲突仅涉及文档记录和等价的 bootstrap 依赖测试规则；保留两侧成果。合并消费者 4 文件/11 项通过，类型、架构、品牌及官网构建通过。历史专项证据见[返工与恢复](automatic-rework-recovery-20261112.md)；发布仍须此次准确 head 的完整四片 CI。

新增 `runtime-acceptance.yml` 与 `runtime-release-acceptance.ts`：仅在无现有安装的隔离 GitHub Windows runner 安装真实 0.1.15。候选模式通过原公钥核对签名、暂存完整 R2、验证普通退出和真实冷壳激活及数据保留，失败分支使用实际候选和选择器验证，明确不是原生恢复窗口 UI；在线模式由真实旧客户端匿名下载、普通退出、UI 点击和真实新进程验证，不替换下载源。

验收脚本单独严格 TypeScript 检查通过；首次发现环境映射、IPC 多余字段和配置字面量类型问题，修正后通过。产品常规 tsconfig 不包含 scripts，不能用产品类型检查代替该项。以下仅记录已取得的回执，公开、在线和官网尚未完成。

## 冻结候选与隔离验收

- 冻结源码 `e5e7fc471af39c05dd856f7e8016f43df3b01b89`；唯一候选 `build/runtime/c0.1.15-r2-utN5mA`。冷包实际来自原 `unsigned-20261112-193123-7bd6a308/runtime`；C 指纹 `1bbb10bf276fad5bb811872d62f0f472bda0249a592db2a43c202a7c2a9cdc47`、公钥及三个 E 完全沿用。
- 清单 payload 摘要 `b0e0c5712a558dcad80190f2463da16cf0daf90114a7b9a74a62632af29bf123`；R ZIP 为 3,934,130 字节，SHA-256 `3e2da486b30edb71762435d908cb14590c49375d89832f99039b65519a63deee`。此大小仅为资源 ZIP，不包括清单、首次引擎下载或安装包。
- 唯一草稿 `runtime-c0.1.15-r2-candidate` / Release `443146945`，目标为冻结源码；R ZIP、`latest.json`、`runtime-cold.json` 已上传并核对。未公开此草稿，正式 `runtime-c0.1.15` 通道仍为 R1。
- 构建曾因本机配置 CRLF/LF 字节与旧冷包不一致而拒绝。核对 Git 规范化内容及编译启动器相同后，恢复原冷包的准确配置字节再构建，未改变指纹或放宽验证。首次远程 E 验证下载停滞，保留日志并停止本次进程；复制原候选中摘要相同的三个 E 后，完整 `pnpm verify:runtime build/runtime/c0.1.15-r2-utN5mA` 通过。
- [候选验收 43249744548](https://github.com/nan023062/cbim/actions/runs/43249744548) 首次失败于 Electron 主进程 evaluate 中没有 `require`；改用 `process.getBuiltinModule`。草稿 tag API 的 404 则改由有权限的分页列表定位既有 ID，没有重复创建 Release。
- [候选验收 43250200307](https://github.com/nan023062/cbim/actions/runs/43250200307) 通过，验证脚本 head `4ef4515da2c8650c79562babad032c48ce64f857`，artifact `13958013830`。真实 C 0.1.15 安装包 SHA-256 `b9a8ecbf29e2a285f2dd963fad5379f306f7c4fba9e11bc35ff9eeefee019a69`；真实冷壳激活 R2，工作区、知识、模型、同一已完成任务、文件和 localStorage 保留，模型请求恰为 1、页面错误为 0。加载前损坏隔离回退和数据访问后拒绝降级两项通过；后两项使用实际选择器，不冒充恢复窗口 UI。

## 全量 CI 暴露的旧测试消费者

- [PR #61](https://github.com/nan023062/cbim/pull/61) 的完整 [CI 43250212464](https://github.com/nan023062/cbim/actions/runs/43250212464)，head `4ef4515d`，四片合计 2,858 通过、8 失败、2 历史跳过。原失败报告逐片保存在 `test-results/release-r2/ci-43250212464/`，没有覆盖。
- 失败集中在 `scope-wait-pi`、`human-continuation-pi`、`queued-task-cancel-pi`、`active-goal-input-pi`、`goal-review-pi` 的负向路径。新系统允许缺少完成审阅时有限反馈；旧确定性供应商只接受原回合数，额外回合导致供应商错误，或滑入仅属于用户显式接续的脚本分支。修正测试供应商继续返回同样的无效结论，逐一验证两次无进展后失败、原权限/输入/人工条件不变、旧成员不重跑、队列不自动消费、重启不重放。
- 仅修改 9 个测试文件，未改产品、安全判定或候选。定向命令 `pnpm exec vitest run tests/scope-wait-pi.test.ts tests/human-continuation-pi.test.ts tests/queued-task-cancel-pi.test.ts --reporter=default --reporter=json --outputFile=test-results/release-r2/repair-consumers.json`：3 文件 / 14 项通过；`pnpm exec vitest run tests/goal-review-pi.test.ts tests/active-goal-input-pi.test.ts --reporter=default --reporter=json --outputFile=test-results/release-r2/repair-input-review.json`：2 文件 / 14 项通过。`git diff --check` 通过。仍须最新 PR head 的完整四片通过后才能公开。
- 冻结后差异仅为测试、验收脚本和发布记录，不改变产品、依赖、构建配置、品牌、内置更新日志或 Builtins 运行资料。`collectResources` 会复制整个 `design/`，因此候选仍保留冻结时的发布报告与开发记录；仓库后续回填不是候选中的资源字节，不声称两者逐字节相同，也不追改已冻结 ZIP。

所有证据分别保存于 `test-results/release-r2/`、唯一 runtime 候选目录及对应 Actions artifacts；不覆盖原失败。Windows 冷包仍未签名，R2 清单签名不替代 Authenticode。测试使用确定性 localhost 模型，只证明数据保留与无重放，不证明模型质量。
