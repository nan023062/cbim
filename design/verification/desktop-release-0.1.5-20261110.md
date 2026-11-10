# CBIM Assistant 0.1.5 发布验收

## 授权、范围与基线

- 用户要求三项需求全部完成后提交 PR、合并并发布新版本。范围为主 Agent 默认执行、Claude Code 和 Codex 三引擎、Agent/岗位/主对话引擎与模型菜单。
- 沿用已确定的个人开发阶段未签名发行选择（发布指南记录的 2026-11-09 用户决定）；不替换历史附件，之后签名迁移使用更高版本。
- 仓库及登录身份：nan023062/cbim、nan023062；默认 develop，稳定分支 master。开始时双方同为 fcb7774a，远端没有其他分支或开放 PR。
- 真实上一公开桌面版 0.1.4，Release ID 439619815；旧 Python latest ID 327801733 / v1.0.2 必须保持。
- 功能提交 a4472ecb。三个需求共享配置、工具与调度契约，合并为一个完整功能提交；已有开发测试的实际命令与边界见 Claude/Codex 专项记录及开发日志。

## 发布准备与验证

- 更新版本为 0.1.5，新增内置版本日志。0.1.4 延续 0.1.3 自动更新交互，验收输入新增明确枚举并保留未知版本拒绝；候选和公开升级均指定 previous_version=0.1.4。
- 新增定向验收输入回归，检查 0.1.4 → 0.1.5、同版拒绝和未知旧版拒绝。`pnpm exec vitest run tests/desktop-acceptance-inputs.test.mjs --reporter=default --reporter=json --outputFile=test-results/desktop-0.1.5-20261110/acceptance-inputs.json`：21 项通过；`pnpm check:brand` 与正式域名 `pnpm build:website` 通过（公开数据仍保持 0.1.4）。
- 完整 Windows PR 四片、真实打包 EXE、多引擎桌面、候选安装、公开升级与官网分发尚未运行；未达到公开门槛前不标记发布完成。

## 当前接续

冻结干净源码并构建唯一候选；通过完整 CI 与隔离安装后合并及公开，随后验证真实上一版 UI 升级，再同步既有 GitHub Pages 和双分支。
