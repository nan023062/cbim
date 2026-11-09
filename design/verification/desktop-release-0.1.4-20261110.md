# CBIM Desktop 0.1.4 发布记录

## 范围与基线

- 用户于 2026-11-10 授权“合并 发布”。沿用已明确选择的未签名个人开发发行，不更换应用身份、数据目录或更新通道，不操作真实用户安装。
- 仓库与账号核实：nan023062/cbim，actor nan023062，默认 develop。开始时 develop 为 d5644e3f668b5fca42875f6a2c2374a9498c8e45，master 为 5fe52e74f57f0363299381fd050e799d637723c9，无打开的 PR 或 0.1.4 草稿。
- 纳入四项独立提交：bbc6a40b（花名册退役）、e3de619a（Schema/模板）、953aab73（责任/缺口）、d5644e3f（实例提示）。开发证据见[反馈修复记录](empty-project-feedback-20261110.md)。未复现的反馈工具缺失、fetch failed 和重启原因保持已知限制。
- 上一公开桌面版为 desktop-v0.1.3；旧 Python latest 为 Release 327801733 / v1.0.2，保持不变。

## 当前阶段

准备中：版本与内置日志更新至 0.1.4，验收脚本适配真实 0.1.3 自动安装交互。尚未冻结制品、创建 PR、构建或公开。

本机只验证本次发布准备涉及的输入/脚本；原功能受影响测试沿用各自提交证据，完整四片测试由 master PR 的自动 CI 执行。草稿安装与公开升级分别在独立 Windows runner 完成，回填实际 SHA、摘要、Release、PR 和 run 回执。

## 准备验证

- 0.1.3 自动安装与 0.1.1/0.1.2 两步交互分别选择，未知旧版、同版、降级与错误制品身份继续拒绝。自动安装在真实 installing 两秒窗口内普通退出，随后独立下载并等待自动重启，不调用安装器代替线上路径。
- `pnpm exec vitest run tests/desktop-acceptance-inputs.test.mjs --reporter=default --reporter=json --outputFile=test-results/desktop-0.1.4-inputs.json`：19 项通过。验收脚本语法、发布资料三入口一致性与 diff 检查通过。
- `pnpm typecheck`、`pnpm check:architecture`、`pnpm check:brand` 和 `CBIM_WEBSITE_URL=https://nan023062.github.io/cbim/ pnpm build:website` 通过；1159 文件、6006 依赖、0 环。官网仍指向真实已公开 0.1.3，不提前改下载。
- 接续：冻结本提交、创建 PR，准确 head 完整 CI 与候选构建/安装验收。当前未公开 0.1.4。
