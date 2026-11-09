# CBIM Desktop 0.1.4 发布记录

## 范围与基线

- 用户于 2026-11-10 授权“合并 发布”。沿用已明确选择的未签名个人开发发行，不更换应用身份、数据目录或更新通道，不操作真实用户安装。
- 仓库与账号核实：nan023062/cbim，actor nan023062，默认 develop。开始时 develop 为 d5644e3f668b5fca42875f6a2c2374a9498c8e45，master 为 5fe52e74f57f0363299381fd050e799d637723c9，无打开的 PR 或 0.1.4 草稿。
- 纳入四项独立提交：bbc6a40b（花名册退役）、e3de619a（Schema/模板）、953aab73（责任/缺口）、d5644e3f（实例提示）。开发证据见[反馈修复记录](empty-project-feedback-20261110.md)。未复现的反馈工具缺失、fetch failed 和重启原因保持已知限制。
- 上一公开桌面版为 desktop-v0.1.3；旧 Python latest 为 Release 327801733 / v1.0.2，保持不变。

## 当前阶段

候选已冻结并通过构建/校验，PR #25 的首轮完整 CI 暴露旧测试输入；正在修正，尚未合并或公开。草稿安装验收已派发。

本机只验证本次发布准备涉及的输入/脚本；原功能受影响测试沿用各自提交证据，完整四片测试由 master PR 的自动 CI 执行。草稿安装与公开升级分别在独立 Windows runner 完成，回填实际 SHA、摘要、Release、PR 和 run 回执。

## 准备验证

- 0.1.3 自动安装与 0.1.1/0.1.2 两步交互分别选择，未知旧版、同版、降级与错误制品身份继续拒绝。自动安装在真实 installing 两秒窗口内普通退出，随后独立下载并等待自动重启，不调用安装器代替线上路径。
- `pnpm exec vitest run tests/desktop-acceptance-inputs.test.mjs --reporter=default --reporter=json --outputFile=test-results/desktop-0.1.4-inputs.json`：19 项通过。验收脚本语法、发布资料三入口一致性与 diff 检查通过。
- `pnpm typecheck`、`pnpm check:architecture`、`pnpm check:brand` 和 `CBIM_WEBSITE_URL=https://nan023062.github.io/cbim/ pnpm build:website` 通过；1159 文件、6006 依赖、0 环。官网仍指向真实已公开 0.1.3，不提前改下载。
- 接续：冻结本提交、创建 PR，准确 head 完整 CI 与候选构建/安装验收。当前未公开 0.1.4。

## 冻结候选与首轮 CI

- 源码 `6ba2d64f0b3f13ba203a0250de314f3fc99f7cf5`，候选 `build/desktop-release/0.1.4/unsigned-20261110-043738-09b95377`；`pnpm make:desktop --unsigned`、`pnpm verify:desktop <候选> --unsigned` 通过。14 个 PE payload，主 EXE 摘要 `2bf2a061067c906246d06b569948c0aba521505271f2c2abd3b8547ff29d6588`，具体资源与附件以 build-receipt.json 为准。
- 显式指定本候选 EXE 执行 `pnpm exec tsx scripts/isolated-node-smoke.mts` 六场景通过，报告 `test-results/desktop-0.1.4-isolation-6ba2d64f.json`；未操作真实用户安装。
- 唯一草稿 Release `439619815`，四附件摘要/大小与本地一致；创建后首次列表未及时返回，按同一 ID 核实后继续，没有重建。`staged-publish-journal.jsonl` 保存意图与回执。[候选安装 42695642991](https://github.com/nan023062/cbim/actions/runs/42695642991) 使用同一 workflow SHA、source SHA 和实际上一版 0.1.3。
- [PR #25](https://github.com/nan023062/cbim/pull/25) 初始 base `5fe52e74f57f0363299381fd050e799d637723c9`、head 为上述源码。[首轮 CI 42694782113](https://github.com/nan023062/cbim/actions/runs/42694782113) 第三片两项失败源于来源测试夹具还提交 peopleUpserts/maintenance，第二片工具断言遗漏新增 OWNER_MODEL_UNRESOLVED。原失败日志和 run 保留，完整结论待回填。
- 来源夹具当前输入与历史 EXE 输入显式分开，移除无差异的维护字段清理事务，保留真实来源代次/采纳/恢复断言；定向 8 通过、2 历史 EXE 缺失跳过，类型通过。仅测试和开发文档变化，不影响既有制品；完整新 head CI 仍需通过。
- 责任主工具和 Application 同时断言未绑定及模型待核实缺口，分别 9/2 项通过。第一片还发现统一工具权限测试遗漏 object preview v2，另行修正；不通过回退产品契约来迁就旧断言。候选安装 run 已成功，完整安装报告仍需核对。
