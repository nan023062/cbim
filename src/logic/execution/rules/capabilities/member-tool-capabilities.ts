/**
 * 目录归属：logic/execution/rules/execution/capabilities；成员运行能力与短期门闩。
 * 作用定位：把本轮真实任务、产物、验证及受控执行能力适配为引擎统一端口。
 * 设计原因：具体工具类型、调用参数差异和业务指引属于能力装配，公共上下文与各引擎无需增加业务专用字段。
 * 职责边界：不签发权限、不保存事件；授权、身份及排空仍由运行时和各能力的原生命周期负责。
 */
import type {EngineCapability} from '../engine-tools';
export interface MemberToolPorts {
  codeCheckTools?:Pick<import('./run-code-check').RunCodeCheck,'list'|'call'>;
  taskTools?:Pick<import('../../../evidence/rules/progress-tools').TaskProgressTools,'list'|'call'>;
  memberHelpTools?:Pick<import('../../../tasks/rules/member-help-tools').MemberHelpTools,'list'|'call'>;
  artifactTools?:Pick<import('../../../evidence/rules/artifact-tools').ArtifactTools,'list'|'call'>;
  manifestTools?:Pick<import('../../../evidence/rules/output-manifest-tools').OutputManifestTools,'list'|'call'>;
  memberCheckpointTools?:Pick<import('../../../tasks/rules/member-checkpoint-tools').MemberCheckpointTools,'list'|'call'>;
  validationTools?:Pick<import('../../../evidence/rules/validation-tools').ValidationTools,'list'|'call'>;
  controlledFileTools?:Pick<import('./run-controlled-file').RunControlledFile,'list'|'call'>;
  artifactTransitionTools?:import('../../../file-operations/rules/artifact-transition').ArtifactTransitionToolPort;
  scopedExecutionTools?:Pick<import('./run-scoped-execution').RunScopedExecution,'list'|'call'>;
}
/** 只注册本轮已装配的能力；保留原调用 ID 和取消信号，不提供原始平台端口。 */
export function memberToolCapabilities(ports:MemberToolPorts):EngineCapability[] {
  const capabilities:EngineCapability[]=[];
  if(ports.codeCheckTools){const port=ports.codeCheckTools;capabilities.push({id:'code-check',tools:{list:()=>port.list(),call:(name,args,_signal,id)=>port.call(name,args,id!)}})}
  if(ports.taskTools){const port=ports.taskTools;capabilities.push({id:'task-progress',tools:{list:()=>port.list(),call:(name,args)=>port.call(name,args)}})}
  if(ports.memberHelpTools){const port=ports.memberHelpTools;capabilities.push({id:'member-help',tools:{list:()=>port.list(),call:(name,args,_signal,id)=>port.call(name,args,id!)},instructions:['\n作为执行成员，你不能再派发其它成员。遇到缺少信息、依赖、权限、能力或模块范围问题，先核实已有工具结果，再调用 cbim_task_help 向主调度提交结构化问题；可引用本轮已结束调用 ID。不要自己升级权限或请求恢复旧任务。求助成功只表示暂存，立即结束本轮，不能再调用工具、生成交付候选或声称完成；主调度会在本轮安全结束后重新安排新任务。']})}
  if(ports.artifactTools){const port=ports.artifactTools;capabilities.push({id:'artifacts',tools:{list:()=>port.list(),call:(name,args,_signal,id)=>port.call(name,args,id!)}})}
  if(ports.manifestTools){const port=ports.manifestTools;capabilities.push({id:'manifests',tools:{list:()=>port.list(),call:(name,args,_signal,id)=>port.call(name,args,id!)}})}
  if(ports.memberCheckpointTools){const port=ports.memberCheckpointTools;capabilities.push({id:'member-checkpoint',tools:{list:()=>port.list(),call:(name,args,_signal,id)=>port.call(name,args,id!)},instructions:['\n本轮可以申请一次 cbim_task_checkpoint 安全停泊，同任务最多16个检查点。仅支持全部已成功 read/write/edit 触达文件均有完整基线的任务；执行过命令、动态目录查询、额外知识查询或未知操作不能使用。检查点请求后立即正常结束本轮；主调度显式预约后才可能沿原任务与上下文续执行一次，不能自行恢复、提权或把停泊当交付。']})}
  if(ports.validationTools){const port=ports.validationTools;capabilities.push({id:'validation',tools:{list:()=>port.list(),call:(name,args,_signal,id)=>port.call(name,args,id!)},instructions:['\n当前 Workflow 要求明确产物验证（JSON结构、CSV表格或PNG实际解码与尺寸/通道规则）。先读取文件并采集本轮基线，完整出口模式采集原完整清单，再通过 cbim_validation_run 选择冻结的 moduleId/requirementId 及 baselineId 或 manifestId；不能提供路径、Schema 或通过结论。rejected 表示验证实际执行但结构不合格，工具成功回执不等于验证通过。修改文件后必须重新读取、采集和验证；只有当前字节匹配且所需验证均 passed 才能准备交付。结构合格仍不是业务目标或人工验收通过。']})}
  if(ports.controlledFileTools){const port=ports.controlledFileTools;capabilities.push({id:'controlled-files',tools:{list:()=>port.list(),call:(name,args,signal,id)=>port.call(name,args,id!,signal)}})}
  if(ports.artifactTransitionTools){const port=ports.artifactTransitionTools;capabilities.push({id:'artifact-transitions',tools:{list:()=>port.list(),call:(name,args,signal,id)=>port.call(name,args,id!,signal)}})}
  if(ports.scopedExecutionTools){const port=ports.scopedExecutionTools;capabilities.push({id:'scoped-execution',tools:{list:()=>port.list(),call:(name,args,signal,id)=>port.call(name,args,id!,signal)},instructions:['\n本轮按冻结范围执行，所有原生read/write/edit/bash/grep/find/ls均不可用。完整读取用cbim_scoped_read；修改已有文件用cbim_file_write_controlled；固定Node执行用cbim_scoped_node。仅能访问冻结路径，不能请求扩大权限或换工具绕过。隔离输出不会自动回写工程，非零/取消/超时不代表成功；专业验收仍须明确验证。'],disableNativeTools:true})}
  return capabilities;
}
