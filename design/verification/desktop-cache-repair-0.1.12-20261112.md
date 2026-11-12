# 0.1.12 缓存修复候选（未公开）

日期：2026-11-12。A/B 已公开后的实际安装测试确认缓存目录衔接缺陷，详见 [调查](desktop-update-cache-diagnosis-20261112.md)。此候选供真实安装验证及后续发布确认，不代表 0.1.12 已进入公开通道。

- 修复提交：`8571ceb2b0ce41b01e2e169c52db8f6ec32e0788`。构建与核验统一采用 electron-builder AppInfo 的缓存目录；同一 package.name 的 NSIS 和 app-update.yml 不再各自写目录常量。
- 冻结源码：`1217c972a764c0fef59dc105d79b3981f06e1b02`。版本 0.1.12，未签名；真实主程序、应用 ID、EXE、用户数据和公开更新源保持不变。
- 候选：`build/c12/build/desktop-release/0.1.12/unsigned-20261112-124836-819e82e0/`；复制交付目录 `build/update-experience/C-0.1.12/` 的五个文件逐项核对一致。
- 安装器 391424689 字节，SHA-256 `05dc2de45eebfda36b4857dc40523d7e9e620a902a92741d304d9d2363d48e35`。
- blockmap SHA-256 `501dd4d80c50c039eb5122ae6613981c8514e6904fa33bb85d9b292c5ec7b17d`；latest.yml `0558351238af46208f50d94984b649b2bf20487f93588bbc66d7645a20d8c7fd`；SHA256SUMS.txt `2eb10cf4536604f8b484746c6104713ae157f488222e77bbb55b2a6f3eac618b`。
- 唯一草稿 Release ID `442510655`，target 为冻结源码，四附件均上传并核对 digest/size。未公开，未推送桌面标签，不影响当前公开最高版本 0.1.11，旧 Python latest 不变。

## 已完成的本机验证

真实 AppInfo 回归先在旧配置复现目录不一致，修复后 `pnpm exec vitest run tests/desktop-signing.test.mjs` 37 项通过；验收输入 36 项、网络汇总 3 项通过；依赖检查 1302 文件、6689 条依赖、零循环/违规。构建 `pnpm make:desktop --unsigned`、同一候选 `verify:desktop --unsigned` 通过。显式指定本包真实 EXE 的六项隔离场景通过：文件边界、禁网、超时、取消、非零退出、输出限制，全部自有资源回收。

## 隔离安装与正式检查的可追溯入口

[首轮候选安装 43157953215](https://github.com/nan023062/cbim/actions/runs/43157953215)，workflow `54bc29fb9508ee419f0ff414c76d0313595c09b9`，previous_version=0.1.11，source_commit 与摘要同上。全新安装及 B→候选覆盖安装、真实缓存目录/摘要、已有八项数据保留通过；复核报告发现验收器的旧版本列表未将 B 纳入主 Agent/自动化保留分支，这两项被错误标为不适用。已补齐该分支，新一轮完整验收与该原始报告分别保留，最终 run 结果在收尾 PR 汇总。

此轮在干净 Windows runner 检查全新安装、真实 B → 修复候选覆盖安装及原数据；新加门槛要求配置的缓存目录中 installer.exe 已由 NSIS 实际创建，且摘要与该安装器相同，不手动补缓存。正式四片 CI 通过与后续正常合并由收尾 PR 关联；仅本机通过不能代替这些门槛。

旧 B 升级到修复版仍由 B 的旧配置下载，可能继续全量回退。修复在新版安装后为下一次差分更新建立正确缓存前提；不能声称它倒过来修复了已公开 A→B 的传输，也没有发布额外目标版本来伪造在线差分通过。

原始证据在 `test-results/release-ab-20261112/`，包括构建/verify/隔离报告、先红后绿回归、草稿资产日志及云端报告。正式公开 0.1.12 需要用户确认，本轮不会覆盖 A/B。
