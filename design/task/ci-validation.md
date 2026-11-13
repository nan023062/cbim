# CI 验证范围与测试分片

本说明对应 `.github/workflows/validate.yml`，维护入口为 #68。只优化开发验证，不改变客户端更新、产品执行超时或已公开制品。

## 变更分流

- PR 使用 base/head 的 merge-base 差异；`git diff --name-status -z` 保留完整路径，重命名/复制同时检查新旧路径。
- 轻量白名单：根 README.md、design/development-log.md、design/verification 下直接的 Markdown 报告、website 下直接的 html/css/json 文件。仅这些路径改变时，运行差异空白与新增本地 Markdown 链接检查；包含官网时还运行品牌校验、网站构建与原有 14 个浏览器场景。
- 空差异、未知路径、代码、依赖、构建/CI 配置、品牌源及内置业务资料均为完整路径。不把 design/** 或所有 Markdown 统一排除；改动检测失败会失败，不假定成轻量。
- 手动 full 强制完整路径；runtime-diagnostic 仍用独立名称，不能冒充正式完整检查。

## 完整路径

`scope` 完成后，`static` 与四个 `windows` 分片并行。类型、架构/依赖和品牌/官网构建仅在 static 执行一次；官网构建本身已含品牌校验。涉及网站输入时，static 额外运行原 14 场景。测试分片各自保留锁定依赖的独立复制安装、Electron 单链接身份和规范临时路径检查；这些检查依赖各 runner 的真实环境，不能移至另一 runner 代验。

不改变 testTimeout/hookTimeout、不增加测试自动重试、不打开 fileParallelism。依赖下载仍只允许原有三次有界安装尝试。

## 按耗时分片与覆盖证明

`CiTestSequencer` 接收 Vitest 实际发现的测试全集，`balancedShards` 使用最长任务优先的确定性分配；同权重以路径排序、同负载按分片编号。`ci-test-timings.json` 的毫秒权重来自成功 run 43386158632、43390467062，每文件取两轮最大实测耗时加 1000 ms 开销，内含完整来源和单位。后续可用成功报告的 testResults startTime/endTime 更新权重；历史权重不作为测试白名单，已删除条目不产生运行，新增/改名文件按 30000 ms 默认值纳入。

每片输出 `ci-shard-plan-N.json`，包含发现全集、集合摘要、本片分配和预估耗时。`result` 下载四片产物，核对：四个唯一分片、发现全集相同、分配并集等于全集且无重复、每片实际 Vitest 报告正好覆盖本片分配。检查失败不能把四个 job 的成功状态当作完整覆盖。原有条件跳过仍如实计数，不把跳过变成通过。

## 统一结果与观察范围

`CBIM validation` 始终汇总本次选择的路径。完整路径要求 static/windows 成功且 light 为预期跳过；轻量路径要求 light 成功且 static/windows 为预期跳过；scope 失败、取消、缺结果或意外跳过都会阻止成功。手动诊断汇总仍叫 `CBIM diagnostic result`。

仓库分支保护不在本次变更范围，新增汇总名称本身不代表 GitHub 已强制执行。正式发布前仍核对精确源码的完整产品 CI 与候选/在线升级；发布后的纯官网/记录收尾 PR 允许走轻量路径，不再次以产品全量测试阻塞记录更新。

相关回归为 tests/ci-validation.test.mjs。修改分流时重点 review 白名单、重命名旧路径和未知路径；修改分片时重点 review 全集来源、确定性及产物覆盖校验。真实耗时和 CI 回执追加到 #68/对应 PR，不为回填结果重复触发完整 CI。
