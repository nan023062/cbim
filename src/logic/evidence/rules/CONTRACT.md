# 代码检查与交付

对象排序机制由 utility.orderJsonValue 提供，各证据适配保留原字段与指纹规则：artifact-evidence 使用 localeCompare，workflow-evidence/validation-evidence 使用字符序且省略 undefined，output-manifest-identity 使用字符序并保留属性。最终 JSON 序列化、Schema 复核、证据来源和验收均留在本目录，未升级历史摘要或统一排序策略。

Workflow 的 `delivery.requiredCodeChecks` 冻结检查 ID、目的、program、args、cwd、timeoutMs 和 success。必须同时声明 `artifactScope` 和 `requireCompleteManifest`，暂不支持 `executionScope` 混用。旧 Workflow 无此字段时行为不变。

`cbim_code_check_run` 只接受空对象，运行时经 command 权限执行整组检查并保存 `code.validation_checked`。同一组绑定同一份输入快照；非零退出、超时、输出超限、源码在检查期间变化均拒绝通过。test-summary-json 要求 stdout 唯一一行 `CBIM_TEST_SUMMARY {"passed":1,"failed":0,"skipped":0}`，通过数不得低于 minPassed；摘要由项目测试适配脚本输出，其真实性取决于冻结脚本，系统不推断测试覆盖了全部需求。

检查后重新 inspect 进度、用检查调用 ID 更新步骤，再采集完整清单并准备交付。交付证明绑定命令要求摘要、源码集合摘要和知识版本；历史结算从授权、可信事件和完成回包重算，当前源码由已有完整清单机制复核。

范围必须显式包含相关源码、测试、构建配置和锁文件；未声明的依赖、环境和外部服务不在证明范围。沿用完整清单上限：16 个根、512 条目、单文件 8 MiB、总计 32 MiB。构建输出应放在输入范围之外。每组最多 8 项，每项最长 5 分钟，输出最多 256 KiB。平台执行是宿主进程，不提供沙箱隔离。

阅读顺序：logic/workspace/rules/code-check.ts 定义要求，logic/evidence/rules/code-check.ts 核验事实，logic/execution/rules/capabilities/run-code-check.ts 管理生命周期，logic/file-operations/platform/files/code-check-runner.ts 执行真实进程。新增项目检查优先修改 Workflow 和项目适配脚本；新增成功判据才修改契约与平台解析，并补充失败回归。
