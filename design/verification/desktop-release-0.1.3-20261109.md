# CBIM Desktop 0.1.3 发布记录

本次用户授权：PR #23 全部 CI 通过后合入 master，并发布新版；继续使用此前明确的未签名个人开发发行。Windows x64，仓库／账号为 `nan023062/cbim`／`nan023062`，默认开发分支 develop。既有用户安装不作为测试目标。

## 范围与基线

- 功能提交：#14 `20cb43c`、#17 `b5b3916`、#18 `ce13fe1`、#19 `ecde044`、#20 `a6b724e`、#21 `db595f6`、#22 `74bfbd6`；发布 Skill `67224e6` 与开发验证流程 `3ed0d7e`。各自开发时的证据见开发记录，不当作本次完整发布验收。
- PR #23 起始 head `3ed0d7e9acc2c589a7da71d6e5fe6daba8928a8f`，base `1774026684dcab47e512e381f1761368a788cf39`；完整四片 run `42639651567` 正在运行，尚未合并。
- 真实上一公开桌面版为 0.1.2。独立旧 Python latest 的基线为 Release `327801733`／`v1.0.2`，不得改变。
- 更新验收输入明确 previous_version=0.1.2；当前脚本只支持 0.1.1／0.1.2 的两步升级界面和更高的未签名 0.x 目标。自动安装旧版、签名或 1.x 目标仍需适配。

## 准备验证

- `tests/desktop-acceptance-inputs.test.mjs`：1 文件、16 项通过，覆盖两模式、旧版缺失／不支持、同版／降级和制品身份拒绝；报告 `test-results/desktop-0.1.3-inputs.json`。
- `node --check scripts/desktop-release-acceptance.mjs`、工作流输入解析和 diff 检查通过。
- 依赖检查：1158 文件、6004 条依赖、0 环；发布 Skill 及受影响引用同步三个入口。
- 此时未运行本机全量回归、安装或发布。后续需记录唯一候选 source SHA、四附件、候选与线上升级 run、公开 ID、标签、官网及分支同步事实，不将受理状态当作验收通过。
