# 废弃真人花名册：开发验证与维护交接

> 历史快照：正文中的目录、完成状态与验证数字保留记录日期的事实，不是当前实现清单。四层迁移后的现状请看 [源码契约](../../src/CONTRACT.md) 和 [Logic 边界](../../src/logic/BOUNDARIES.md)。

2026-11-10，按用户要求废弃真人花名册及独立真人维护声明。岗位 memberId、模块负责人、能力与模型、权限、知识版本、Workflow 和任务身份检查继续生效。

## 已实现

- 新工作区不创建 people.json；对象服务和桌面表单不再接受真人登记或维护确认。移除 cbim_people_list 和 people-schema 目录入口。
- Rules 和 Python 索引维护脚本不读取花名册或关联 authors 的组；authors 仍是无重复字符串数组。旧文件原字节保留，不自动迁移或清除。
- 模块 maintenance 只作历史对象，任务维护字段改为可选兼容字段。新派发不生成这些字段；旧任务准备比较有效模块与 Workflow 后复制原绑定，不改写旧记录。
- 导入、资源界面、主 Agent 指引、内置规范和当前契约清理旧门禁。历史冻结规范仍按原版本保护，不能借退役机制绕过来源或执行授权。

## 验证边界与结果

按实际调用链选取知识创建/查询、桌面事务、模块解析、岗位登记/派发、任务图/冻结上下文、自动执行、负责人门禁、资源包及工具发现的单元；未跑全仓测试、全套桌面、打包或安装升级。

1. `pnpm typecheck` 通过。
2. `pnpm exec vitest run tests/workspace.test.ts tests/rules.test.ts tests/object-crud.test.ts tests/architecture-service.test.ts tests/knowledge-tool-output.test.ts tests/dispatch-context.test.ts tests/member-dispatch.test.ts tests/member-execution-context.test.ts tests/automatic-execution.test.ts tests/workspace-packages.test.ts tests/dispatch-graph.test.ts tests/owner-execution-core.test.ts tests/workspace-member-service.test.ts --reporter=default --reporter=json --outputFile=test-results/retired-people-targeted-20261110-first.json`：首轮 88 项，84 通过、4 失败，保留原报告。失败来自旧默认花名册夹具、旧提示词、旧维护绑定拒绝断言。
3. `pnpm exec vitest run tests/dispatch-graph.test.ts tests/member-execution-context.test.ts tests/workspace-member-service.test.ts --reporter=default --reporter=json --outputFile=test-results/retired-people-recheck-20261110.json`：25 项通过。补充无维护字段和历史空维护字段恢复；以真正的 Workflow 变化继续验证拒绝执行，用 README 改动验证无关知识变化不影响岗位采纳依据。
4. 工具契约初次执行因旧数量断言及以人员文件制造无效知识的夹具不再成立而中止，未记为通过。改用链接器无效结构保留同样的诊断/取消/未知提交断言后，`pnpm exec vitest run tests/builtins.test.ts tests/knowledge-tool-contracts.test.ts tests/knowledge-contract-pi.test.ts --reporter=default --reporter=json --outputFile=test-results/retired-people-tool-contracts-20261110-fixed.json`：7 项通过，含实际 Pi 适配的提交、取消与提交后坏回包三场景。
5. Python 首次直接模块调用缺少本地 import 路径（`ModuleNotFoundError: ignore_rules`）；使用 `$env:PYTHONPATH='design/scripts'; python -m unittest discover -s design/scripts/tests -p test_maintain_registries.py` 后 26 项通过。
6. `pnpm check:architecture` 通过：1158 文件、6001 条依赖、0 环。最后补齐行为契约后重新生成，并用 `node scripts/source-architecture.mjs --check` 确认无差异；`git -c core.safecrlf=false diff --check` 通过。

累计受影响 TypeScript 测试覆盖 16 文件、97 项（重跑不重复计数），Python 26 项。单元结果不代表全量 CI、合并或发布；公开 0.1.3 未变。

## 维护入口与后续

知识规则和对象操作在 core/knowledge；冻结绑定兼容在 core/tasks 和 scheduler-engine/context；桌面入口在 main/workspace 与 frontend/knowledge；资源导入只保留旧文件，不继承真人状态。各受影响目录 CONTRACT/ARCHITECTURE、源码注释及运行规范同步更新。

空项目反馈中的对象字段 Schema、模块模板诊断、责任重复绑定提示、一次性派工缺口、反馈工具发现和实例重启提示仍需后续独立修复与提交。没有证据确认选择卡偶发 fetch failed 或实例重启的具体原因。
