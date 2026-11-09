# 指定 JSON 产物的结构验证

状态：2026-11-07，Step22 已完成，承接 `0107b86`。最终 33 文件 242 项回归、13 项边界、类型/架构检查通过；Windows EXE `20261107-164948` 四场真机通过，见[验收报告](../verification/json-artifact-validation-20261107.md)。本片接通一种有明确专业含义的文件结构验证，不将 JSON 结构合格解释为业务目标正确。

## 本片交付

冻结 Workflow 的 `delivery` 增加可选 `requiredValidations`，每项为 `{id, validator: 'json-schema-v1', artifactPath, schema}`。`requiredToolEvidence` 与新数组至少有一项非空，两类要求 ID 在模块内唯一；旧声明保持原行为及 proof 形状。文件路径固定在工作区内，拒绝 `.cbim/`、链接和越界。

只在存在相应冻结要求的正式执行成员装配 `cbim_validation_run`，输入为 `{moduleId, requirementId, baselineId, expectedTaskProgressVersion}`；模型不能传路径、Schema、哈希、passed 或运行身份。要求来自真实执行知识，基线来自本轮成功采集。

单个 JSON 文件最多 1 MiB；同一次安全读取取得的字节用于 SHA-256、严格 UTF-8/JSON 解析与结构校验。Schema 使用有界白名单，禁止远程/本地引用、脚本、pattern、format、自定义关键字以及转换、补值和删字段。保留现有路径、句柄和读前后变化检查，明确外部并发修改不是原子快照保证。

验证结果 `ValidationResult` 保存 version/validationId/toolCallId、完整成员 binding、validator、requirement（moduleId/workflowId/workflowVersion/requirementId/schemaHash）、knowledgeRevision、taskProgressVersion、baselineId、artifact（实际路径/字节数/哈希）、lastEffectSeq、checkedAt、outcome（passed/rejected）及无原值诊断。先持久 `validation.checked`，真实工具完成后从原事件派生带 checkedSeq/finishedSeq/receipt 的 `ValidationRecord`，不预造回执序号。

工具成功完成与验证通过分别表达：rejected 是真实已执行事实，可由步骤引用，但不能满足 requiredValidations。Workflow proof 新增可选 validationChecks（精确要求、validationId/toolCallId/baselineId/文件指纹）；只选步骤明确引用的 passed 记录，旧无验证要求不补空字段。

Progress 新增可选验证端口 `records()` 与 `verifyCurrent(records)`；保存前冻结依据并重算原 wire 证明，延续副作用代次及并发限制。文件验证使用短门闩，实际工具结束释放；停止、版本变化、知识变化、基线不匹配不得生成有效 passed。成员结算及主目标审阅/完成再次通过可信文件端口核对被选记录，不能在派发事务中递归调用同一 store 的报告服务。

## 模块边界

- Core/workspace：冻结要求及受限 Schema；Core/tasks：验证 DTO、工具、纯事实核验、Workflow/Progress 出口。
- Core/brain：本轮短门闩、可信持久事件、停止与当前版本检查。
- Main/platform：实际同字节有界读取；Main 与 Scheduler 以端口装配，保持单向依赖。
- Scheduler：实际能力预检、canonical 候选与主目标复核；Frontend 只展示真实验证事实及其范围，不新增自动执行入口。

每个源码改动同步中文注释和受影响 CONTRACT/ARCHITECTURE，最终统一生成类图。方案不扩展成员检查点恢复白名单，也不接远端验证服务、任意脚本、全工作区原子快照或认证人工验收。

## Workflow 声明示例

在模块已挂载的 Workflow 唯一 `cbim-workflow` 块中，`delivery` 可以声明以下结构要求；模型执行时只能引用这里的要求 ID。完整 Workflow 的其他字段仍遵循已有契约。

```json
{
  "requiredValidations": [
    {
      "id": "config-shape",
      "validator": "json-schema-v1",
      "artifactPath": "src/config.json",
      "schema": {
        "type": "object",
        "properties": {
          "name": {"type": "string", "minLength": 1},
          "count": {"type": "integer", "minimum": 1}
        },
        "required": ["name", "count"],
        "additionalProperties": false
      }
    }
  ]
}
```

一次成员运行跨模块合计最多 16 项条件，准备时即拒绝超过此数的要求；最多保存 16 次检查事实，失败回包后已保存事实也占用额度，达到上限需由主调度安排新任务。Schema 最多 32 KiB、16 层、512 节点；数据最多 64 层、100000 节点；诊断最多 32 项且不回传原值。文件变化后须重新读取、采集基线和验证，原 rejected/passed 保留为历史事实。

## 验收

单元覆盖 Schema 白名单与容量、同字节哈希、非法/重复 JSON 字段、路径与链接、错模块/Schema/run、伪造 passed、坏回包、并发读写/停止、过期基线及旧 Workflow 兼容。

真实 Pi 和最终 Windows EXE 使用隔离本地确定性供应商：写不符合结构的 JSON → rejected → 交付被拒 → 修改并重新采集/验证 → 真实候选与主目标完成；另验验证后文件变化和停止/重开无重放。保存每次真实结果，完成后更新路线图、开发记录并单独提交。
