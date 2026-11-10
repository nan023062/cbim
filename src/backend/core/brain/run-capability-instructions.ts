/**
 * 作用定位：由可信运行装配生成成员求助、停泊和产物验证的使用指引。
 * 设计原因：这些说明跟随业务能力变化；引擎传输只接受已装配说明，不依赖具体工具类或业务槽位。
 */
export function runCapabilityInstructions(capabilities:{help:boolean;checkpoint:boolean;validation:boolean}):string[]{
    const helpHint=capabilities.help?'\n作为执行成员，你不能再派发其它成员。遇到缺少信息、依赖、权限、能力或模块范围问题，先核实已有工具结果，再调用 cbim_task_help 向主调度提交结构化问题；可引用本轮已结束调用 ID。不要自己升级权限或请求恢复旧任务。求助成功只表示暂存，立即结束本轮，不能再调用工具、生成交付候选或声称完成；主调度会在本轮安全结束后重新安排新任务。':'';
    const checkpointHint=capabilities.checkpoint?'\n本轮可以申请一次 cbim_task_checkpoint 安全停泊，同任务最多16个检查点。仅支持全部已成功 read/write/edit 触达文件均有完整基线的任务；执行过命令、动态目录查询、额外知识查询或未知操作不能使用。检查点请求后立即正常结束本轮；主调度显式预约后才可能沿原任务与上下文续执行一次，不能自行恢复、提权或把停泊当交付。':'';
    const validationHint=capabilities.validation?'\n当前 Workflow 要求明确产物验证（JSON结构、CSV表格或PNG实际解码与尺寸/通道规则）。先读取文件并采集本轮基线，完整出口模式采集原完整清单，再通过 cbim_validation_run 选择冻结的 moduleId/requirementId 及 baselineId 或 manifestId；不能提供路径、Schema 或通过结论。rejected 表示验证实际执行但结构不合格，工具成功回执不等于验证通过。修改文件后必须重新读取、采集和验证；只有当前字节匹配且所需验证均 passed 才能准备交付。结构合格仍不是业务目标或人工验收通过。':'';
    return [helpHint,checkpointHint,validationHint].filter(Boolean);
}
