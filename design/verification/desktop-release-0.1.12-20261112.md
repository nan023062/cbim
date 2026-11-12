# CBIM 0.1.12 正式发布与在线升级验收

日期：2026-11-12。用户明确授权公开此前保留的 0.1.12 修复候选。沿用已确认的 Windows x64 未签名个人开发发行；不替换 0.1.10 / 0.1.11 附件，不操作开发者正在使用的客户端。本轮开放 Issues 为空，没有新增业务开发。

## 制品、检查与公开

- [正式发布](https://github.com/nan023062/cbim/releases/tag/desktop-v0.1.12)，Release ID `442510655`，公开时间 `2026-11-12T06:02:02Z`。标签准确指向冻结源码 `1217c972a764c0fef59dc105d79b3981f06e1b02`，稳定公开、非草稿、非预发布。
- 唯一候选 `build/c12/build/desktop-release/0.1.12/unsigned-20261112-124836-819e82e0/`，本轮重新执行 `pnpm --dir build/c12 verify:desktop build/desktop-release/0.1.12/unsigned-20261112-124836-819e82e0 --unsigned` 通过；四附件 digest/size 与草稿时期一致。
- 已有同制品 [完整四片 CI 43158797740](https://github.com/nan023062/cbim/actions/runs/43158797740)：准确 head `a72a4f9f5f858c596720914fc3608d2618575959`，408 文件、2780 项，2778 通过、0 失败、2 跳过。两项为 owner-execution-legacy 和 knowledge-source-lifecycle-application 的固定历史 EXE 场景，非本轮新增跳过。
- [PR #53](https://github.com/nan023062/cbim/pull/53) 已正常合并，merge `21d26583e88217ff7df94c1922c62d9fb3fe7ebd`。再次逐项核对产品、依赖、打包配置、品牌、该版内置日志和 24 项 Builtins 内容，与冻结制品一致。
- Forge 复制的 design/docs/legal 包含冻结时维护资料；后续验收回填并不追补进原制品。因此只声明产品/构建输入和实际运行资料一致，不声明整个资源目录与后续仓库逐字节相同。包内版本日志保留“候选尚未公开”文字快照，公开状态以本次 Release 为准，没有为改字重打或替换附件。
- 已有实际打包 EXE 六项隔离验证通过；[完整候选安装 43158823971](https://github.com/nan023062/cbim/actions/runs/43158823971) 通过全新安装、真实 0.1.11 覆盖升级、十项数据保留和 NSIS 创建的实际缓存核验。首次候选 43157953215 遗漏两项保留分支的原始证据保留，不冒充完整验收。
- 旧 Python latest 仍为 `327801733 / v1.0.2`；匿名 latest.yml 和 SHA256SUMS.txt 与冻结文件一致，客户端无须 GitHub 登录。

| 附件 | Asset ID | 字节 | SHA-256 |
| --- | --- | --- | --- |
| CBIM-Setup-0.1.12-x64.exe | 738118325 | 391424689 | `05dc2de45eebfda36b4857dc40523d7e9e620a902a92741d304d9d2363d48e35` |
| CBIM-Setup-0.1.12-x64.exe.blockmap | 738120325 | 407748 | `501dd4d80c50c039eb5122ae6613981c8514e6904fa33bb85d9b292c5ec7b17d` |
| latest.yml | 738120465 | 348 | `0558351238af46208f50d94984b649b2bf20487f93588bbc66d7645a20d8c7fd` |
| SHA256SUMS.txt | 738120595 | 270 | `2eb10cf4536604f8b484746c6104713ae157f488222e77bbb55b2a6f3eac618b` |

## 本轮真实 0.1.11 → 0.1.12 在线升级

[在线安装验收 43165384460 attempt 2](https://github.com/nan023062/cbim/actions/runs/43165384460/attempts/2)，workflow SHA `21d26583e88217ff7df94c1922c62d9fb3fe7ebd`，mode=online，previous_version=0.1.11，source_commit=1217c972a764c0fef59dc105d79b3981f06e1b02，transfer_expectation=full-fallback。使用无原 CBIM 安装的独立 Windows runner；客户端环境不含 GitHub 凭据，未改公开请求、未手工补旧包缓存。

attempt 1 在旧版首次检查更新时失败，尚未下载或安装。原 failure.json、截图和运行记录保留；客户端只给出通用检查失败消息，底层 HTTP/网络原因没有证据，保持未知。本机匿名同地址探测返回 HTTP 200 且最高版本正确后，仅在新隔离 runner 有界重跑一次；未修改产品、制品、测试断言或使用凭据替代匿名更新请求。新结果不覆盖首次失败。

通过事实：旧安装版自动发现 0.1.12 并后台下载，完整包摘要正确；关闭弹窗可继续工作，普通退出仍为 0.1.11；重新启动复用有效完整包且没有重复安装包请求；实际界面点击“重启安装”后 NSIS 重启到 0.1.12，并携带原测试用户目录。最终 isPackaged=true、NotSigned，配置指向 cbim-assistant-updater，真实 installer.exe 摘要等于本次安装器。

十项保留全部通过：工作区、模型、已完成会话 task/run、localStorage、用户目录标记、知识与修订、业务文件、主 Agent 配置与修订、自动化定义、无业务重放。确定性模型仅请求 1 次，页面错误 0；该模型仅用于验证状态保留，不代表在线模型质量验收。

真实传输为 **1 次完整下载、391424689 字节、0 个 Range**。报告明确 differentialDownload=false。旧 B 自身仍读取旧缓存目录，本轮回退符合已知预期；它证明升级链和修复后缓存落盘，**不证明本轮节省流量，也不证明 0.1.12 → 下一版的真实差分已经通过**。

## 官网与收尾

官网 release.json 根据公开回执更新到 0.1.12，README、首页与下载页说明缓存修复和旧版全量升级边界。`pnpm check:brand`、携带真实 Pages 地址的 `pnpm build:website` 与 `node scripts/website-smoke.mjs` 通过：320/390/1280、深浅色和离线单页共 14 场景，无溢出、无页面错误，链接/摘要正确。先前无 canonical 的本地预览证据与最终带公开地址的构建分开保留。

本轮仅回填发布资料和官网，未修改产品源码、依赖或冻结版本日志，不涉及 src 注释/类图。官网收尾经 develop → master 的正常 PR 与完整检查；最终 PR、部署 run、六文件匿名核验和远端双主分支同步回执写入同一收尾 PR，避免为记录最终提交制造递归提交。主工作区已有并行架构改动与其它工作分支保留。

原始本轮证据：`test-results/release-012-20261112/`；先前候选、CI 和原始失败证据：`test-results/release-ab-20261112/`。历史 [缓存根因](desktop-update-cache-diagnosis-20261112.md) 与 [候选报告](desktop-cache-repair-0.1.12-20261112.md) 保留。
