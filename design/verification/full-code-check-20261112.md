# 通用代码检查后的全量回归（2026-11-12）

> 历史快照：正文中的目录、完成状态与验证数字保留记录日期的事实，不是当前实现清单。四层迁移后的现状请看 [源码契约](../../src/CONTRACT.md) 和 [Logic 边界](../../src/logic/BOUNDARIES.md)。

## 范围与最终结果

用户明确要求全量回归。基线为 `2187842f` 加当前本地通用代码检查、源码和文档清理改动；本轮没有修改产品源码。

按 `vitest.config.ts` 的 `tests/**/*.test.ts`、`tests/**/*.test.mjs` 清点 421 个文件。中断前已完成部分与续跑部分无重叠、无遗漏；唯一失败修正后定向复测通过。最终去重合计 **2839 项通过、0 项未解决失败、2 项跳过**，共 2841 项；文件结果为 420 个通过、1 个全跳过。

这是分段验证及修正后定向复测的汇总，不是一次未中断的全量执行。前段只有原始文本日志，未生成最终 JSON；续跑原始 JSON 保留当时的失败，不改写历史结果。

## 实际执行与证据

1. 前段运行 `pnpm exec vitest run --reporter=default --reporter=json --outputFile=test-results/full-code-check-20261112.json`，输出至 [原始日志](../../test-full-code-check.log)。进程中断前明确完成 54 个文件、313 项用例，全部通过；原计划的最终 JSON 未生成。
2. 核对没有存活的 Vitest 进程后，清点当前测试文件并从原日志提取已通过文件，保存[续跑清单](../../test-results/full-code-check-20261112-resume-manifest.json)。首次将剩余 367 个文件逐个传参，触发 Windows `The command line is too long.`，未执行测试；随后改用以下等价排除方式：

   ```powershell
   $manifest = Get-Content -Raw -Encoding utf8 test-results/full-code-check-20261112-resume-manifest.json | ConvertFrom-Json
   $vitestArgs = @('exec','vitest','run','--reporter=default','--reporter=json','--outputFile=test-results/full-code-check-20261112-resumed.json')
   foreach ($entry in $manifest.completed) { $vitestArgs += '--exclude=' + $entry.file }
   & pnpm @vitestArgs *> test-full-code-check-resumed.log
   ```

   续跑耗时 691.31 秒，退出码 1：365 文件通过、1 文件失败、1 文件跳过；2525 项通过、1 项失败、2 项跳过。[续跑日志](../../test-full-code-check-resumed.log)、[原始 JSON](../../test-results/full-code-check-20261112-resumed.json)。新机制 `tests/code-check.test.ts` 9 项全部通过。
3. 唯一失败为 `tests/layer-boundaries.test.ts` 报告 `src/backend/bootstrap/desktop.ts` 是未知源码边界。当前 HEAD 已包含冷壳源码，`scripts/check-dependencies.mjs` 也已允许冷壳依赖自身、updater 与 main，但测试内重复的规则表缺少冷壳条目。本轮仅同步该条目及说明，不放宽其他层的限制。
4. 修正后执行 `pnpm exec vitest run tests/layer-boundaries.test.ts --reporter=default --reporter=json --outputFile=test-results/full-code-check-20261112-boundaries-recheck.json`，退出码 0，2 项通过。[复测 JSON](../../test-results/full-code-check-20261112-boundaries-recheck.json)。仅测试规则变化，因此不重复其他已通过用例。
5. [汇总 JSON](../../test-results/full-code-check-20261112-summary.json) 核对 421 个文件全部覆盖、无重复选取、无遗漏，并将原失败逐项匹配至复测通过的断言。汇总不重复计入复测用例。

## 跳过与验证边界

两项用例沿用已有 `skipIf(!existsSync(...))`，缺少以下固定历史 EXE；本轮没有新增跳过条件：

- `knowledge-source-lifecycle-application.test.ts` 的旧版本记录迁移用例：`build/20261107-222611/CBIM Assistant-win32-x64/CBIM.exe`（可由 `CBIM_SOURCE_LEGACY_EXE` 指定）。
- `owner-execution-legacy.test.ts` 的旧负责人执行记录用例：`build/20261107-235854/CBIM Assistant-win32-x64/CBIM.exe`（可由 `CBIM_OWNER_LEGACY_EXE` 指定）。

本轮结果支持当前测试覆盖范围内未发现未解决的回归；不覆盖缺失历史 EXE 的两项场景。没有重复类型/架构检查，没有运行独立打包桌面冒烟、安装升级、在线模型自主质量验收或发布。测试规则与本记录保持本地未提交状态。
