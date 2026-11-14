# 知识查询边界与局部测试隔离

> 导航维护说明（2026-11-14）：正文保留当时的路径、结论与验证边界；可点击源码链接已更新到当前归属，仅供导航，不作为历史版本证据。未留存的阶段入口另行注明，不伪造源码或制品归档。

日期：2026-11-11。来源：用户直接要求先优化单向依赖与分层，再按作用域测试，并继续开发。本片没有对应架构 Issue，不虚构或自动创建工单。

## 基线与范围

- 仓库：`nan023062/cbim`；基线 `7fad631e8692ff2b5845e899ed49915c72d0faa4`（已发布 0.1.6）；分支 `refactor/query-boundaries`。
- 2026-11-10 本轮查询开放 Issues 共 3 项，`--limit 50` 返回 #27、#28、#29，均无评论和优先级。#27 是知识治理状态/校验，#28 是业务与团队架构管理，#29 是自动化；本片只为前两项隔离查询与测试边界，不代表其功能已实施，不关闭工单。
- 主工作区 `develop` 的 `a5938170` 及已有未提交规范保持不动。本片在独立工作树实施，避免丢掉 0.1.6 修复或混入他人文档。
- `change_reason=边界治理`，C3 的一个有限迁移切片，认知等级 L2：跨域编排位置和内部端口改变，外部数据/权限/事务语义保持。覆盖 G01 的查询依赖、G02 的相关测试辅助、G03 的查询组合，不宣布 G01–G03 整项或全仓治理完成。

## 事实与调整

原 `core/knowledge/knowledge-queries.ts` 同时组合 Team、BusinessWorkspace 和刷新索引；领域视图反过来使用知识快照。文件无环不能阻止以后把领域模型与编排互相引用。原 `core-domains` 的“无需 main 实例”测试实际通过 helpers 创建 Application、工作区与完整存储后再停应用；规则测试也经过完整应用。

现在链路为：内部工具/任务准备 → Scheduler 的 KnowledgeQueries → Team/BusinessWorkspace → 知识快照契约 → Foundation。查询只暴露 `KnowledgeSnapshotReader`，刷新另由 `refreshKnowledgeIndexes` 消费 `KnowledgeRefreshWorkspace`；实际实例、锁、journal、事务、监听与恢复仍归 Main 的原 Workspace/KnowledgeStore。工具授权和输出校验保持原入口。

旧查询入口已删除，两个真实直接消费者（knowledge-tools、team-workflow）均迁移；源码/测试/脚本中旧路径和旧 refresh 方法检索为零，不保留 Core 指回 Scheduler 的兼容出口。公开工具及持久数据格式均未更名，无需历史数据迁移。

纯数据构造抽到 `tests/knowledge-data.ts`；`tests/knowledge-fixture.ts` 只建立真实 Rules、Schema 和临时源目录，保留真实 source 检查，不模拟掉领域规则。core-domains 和 rules 使用该环境。其他完整应用测试继续使用 helpers 的兼容重导出，未机械迁移所有消费者。

依赖检测器约束快照数据、读取辅助、两个领域视图、查询编排、Foundation 和两个测试辅助的出边，包含类型与重导出。其他 Core 子域的目录双向关系仍需后续按真实语义逐片治理；未为现有内部耦合增加豁免。

## 验证选择与结果

查询迁移影响域视图输出、工具装配及任务准备，刷新拆分影响原 journal/版本/提交顺序；辅助拆分影响规则/领域测试及既有 helpers 使用。因此选择以下 7 文件，不扩展到未修改的引擎、调度状态机或桌面测试：

```powershell
pnpm exec vitest run tests/core-domains.test.ts tests/rules.test.ts tests/knowledge-queries.test.ts tests/knowledge-refresh.test.ts tests/knowledge-tool-output.test.ts tests/team-workflow.test.ts tests/dependencies.test.ts -t '^(?!all maintained code)' --reporter=default --reporter=json --outputFile=test-results/query-boundaries.json
```

首轮 11.39 秒：35 通过、3 失败、1 未选中。3 个失败均为新增刷新测试的样本 instanceId 不符合原 UUID Schema，未进入目标分支；修正测试样本，没有放宽产品校验。只重跑失败用例：

```powershell
pnpm exec vitest run tests/knowledge-queries.test.ts -t '刷新先核|原成功请求|提交结果未知' --reporter=default --reporter=json --outputFile=test-results/query-boundaries-refresh-recheck.json
```

重测 0.484 秒，3 通过，2 已通过查询用例未重复运行。两份原报告分别保留；最终 38 个不同用例通过。唯一全仓导入扫描用例由后面的 check:architecture 执行同一审计，未在 Vitest 重复运行。检测器样例覆盖合法依赖、无文件环的反向类型引用、越过公共端口、长环、自环、别名和动态加载等既有边界。

- `pnpm typecheck`：通过，核对收窄端口和全部编译期消费者。
- `node scripts/source-architecture.mjs`：仅 8 份内容发生变化的类图更新，未手改生成附录。
- `pnpm check:architecture`：通过，55 个目录/605 个代码及样式文件、0 文档差异；1196 文件/6145 条含类型依赖、0 循环，无未解析/未审核加载/边界违规。
- `git diff --check`：通过。实际调用授权、版本冲突、取消、原刷新幂等和工具输出沿既有应用测试验证。
- 未运行：全仓行为回归、全套桌面交互、真实供应商、打包、安装/升级、发布。没有修改 CI 或绕过合并/发布检查。局部单元通过不等于业务 Issue 验收、人工 review、合并或发布。

## Review 与后续修改入口

完整改动通过 `git diff 7fad631e..refactor/query-boundaries` 或本片提交查看，包括所有源码、测试、检测器与资料。建议依次阅读：

1. [知识边界矩阵与状态归属](../../src/logic/knowledge/rules/CONTRACT.md#固定快照读取的逻辑边界与公共入口)、[snapshot.ts](../../src/logic/knowledge/rules/read-models/snapshot.ts)、[ports.ts](../../src/logic/knowledge/rules/ports.ts)。
2. [查询编排](../../src/logic/knowledge/rules/knowledge-queries.ts) 与 [索引刷新](../../src/logic/knowledge/rules/knowledge-refresh.ts)：确认读写分离，原提交顺序未改。
3. [工具装配](../../src/logic/tools/runtime/knowledge-tools.ts)、[任务准备](../../src/logic/execution/context/team-workflow.ts)：确认真实消费者和原版本/权限门禁。
4. [依赖规则](../../scripts/check-dependencies.mjs)、[领域环境](../../tests/knowledge-fixture.ts)、[查询/刷新回归](../../tests/knowledge-queries.test.ts)。

同步注释：snapshot、ports、Team/BusinessWorkspace、两个新增用例入口、tools 与 team-workflow。同步知识、团队、工作区、Context、Tools 五份 CONTRACT，以及 backend、core、knowledge、team、workspace、scheduler-engine、context、tools 八份 ARCHITECTURE。

- Q1：保护知识 DTO、固定快照语义、结构校验、原子知识事务和原工具授权/恢复；不把尚未完成的其他 Core 边界称为稳定系统。
- Q2：只读业务变化留在所属视图及 Scheduler 组合，索引写入规则留在知识领域；完整应用生命周期不再是纯领域测试的前提。
- Q3：外部协议未变，实际迁移的是查询调用、刷新委托和辅助环境；上述领域/工具/任务准备覆盖这些消费者，静态检查核所有类型/导入。不因共享模块变化自动扩成全仓行为测试。
- Q4：例如 #28 增加树节点查询信息，先改对应视图/输出协议和领域用例；涉及知识提交、权限或跨查询版本语义时才扩大到相应真实协作测试。不改引擎或事务以适应纯展示需求。
- Q5：无新增通用规则候选。本片落实已要求的依赖单向和按影响验证，没有把复杂度或行数阈值擅自升级为规则。

回退条件：若后续集成发现外部查询或刷新协议不兼容，整片回退即可恢复原内部装配；本片无磁盘数据迁移。当前仅完成代码自查、资料交付与上述验证，未获得人工接受结论。
