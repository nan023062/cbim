/**
 * 候选审阅入口仅由主运行装配，独立核验请求与回执；不增加成员自批准能力。
 * includeClosure 只读返回完整撤销预览；确认后提交返回清单，不静默扩大写入。未知结果附原 run/call 的统一只读核实地址。
 * 独立派发只接受自定义岗位；两种模式都由主 Agent 直接执行未配置自定义 Agent 的工作。
 * 恢复请求只指向最新未消费检查点，历史逐段只读；每段独立一次性预约并不等于已经执行。
 * 作用定位：把主调度的派发、查询、未启动撤销、依赖修订及检查点预约/明确放弃转换为内部工具，并组合目标工具。
 * 设计原因：模型明确提交发现所得 ownerSelection、角色、模块和 Workflow；不自动填默认角色。可靠失败/求助和已放弃检查点换边共用原协议；可信闭包固定身份，严格输入拒绝夹带授权，输出核同一份 wire，失败不回滚或重做已入队事实。
 * 职责边界：派发只是入队，续执行只是预约，撤销和依赖修订只记录调度事实，不算验收。本模块不装配成员递归派发、活动任务中止或手工结果工具。
 * 原命令报告是独立 read 入口；只接受原 run/call，不产生新的写命令，也不能清除旧未知结果。
 */
import {z} from 'zod';
import type {CandidateReviewTools} from './candidate-review-tools';
import {withToolReconciliation} from '../rules/outcome';
import {checkedClosurePreview} from './coordination-contracts';
import {coordinationPreviewSchema} from '../../tasks/rules/coordination-preview';
import {zodToJsonSchema} from 'zod-to-json-schema';
import {fail} from '../../../core/errors';
import {dispatchTaskFields,type DispatchTaskInput,type DispatchReceipt} from '../../tasks/rules/dispatch-commands';
import {validateWorkflowSelections} from '../../tasks/rules/workflow-selection';
import {cancelQueuedTasksInputSchema,type CancelQueuedTasksInput,type CancelQueuedTasksReceipt} from '../../tasks/rules/queued-task-cancel';
import {replaceQueuedDependencyInputSchema,type ReplaceQueuedDependencyInput,type ReplaceQueuedDependencyReceipt} from '../../tasks/rules/queued-dependency-replacement';
import {addQueuedDependencyInputSchema,type AddQueuedDependencyInput,type AddQueuedDependencyReceipt} from '../../tasks/rules/queued-dependency-addition';
import {reviseQueuedDependenciesInputSchema,type ReviseQueuedDependenciesInput,type ReviseQueuedDependenciesReceipt} from '../../tasks/rules/queued-dependency-revision';
import type {MainToolOutputBinding} from '../../tasks/rules/main-tool-output';
import {checkedMainToolResult,mainToolContract} from './main-tool-contracts';
import {commandReportContract,checkedCommandReportResult} from './command-report-contract';
import {commandReportToolInputSchema,type CommandReportToolInput,type CommandVerificationReport} from '../../tasks/rules/command-verification';
import type {OfficeHistoryTools} from './office-history-tools';
import type {GoalTools} from './goal-tools';
import {resumeMemberInputSchema,type ResumeMemberInput,type ResumeMemberReceipt} from '../../tasks/rules/queued-member-resume';
import {abandonCheckpointInputSchema,type AbandonCheckpointInput,type AbandonCheckpointReceipt} from '../../tasks/rules/checkpoint-handoff';

const {assigneeAgentId,...taskFields}=dispatchTaskFields.shape;
// 角色只核对岗位能力，不再作为默认路由；实际岗位预期来自模块负责人发现。
const taskInput=z.object({agentId:assigneeAgentId.refine(id=>id!=='cbim:main'&&id!=='cbim:executor','未配置自定义 Agent 时由主 Agent 在当前会话执行，不创建默认成员'),...taskFields}).strict().superRefine((value,context)=>{if(!value.ownerSelection)context.addIssue({code:'custom',message:'独立派发必须提供自定义负责岗位的 ownerSelection；未配置时由主 Agent 直接执行'});try{validateWorkflowSelections(value.moduleIds,value.workflowSelections)}catch{context.addIssue({code:'custom',message:'Workflow 选择必须属于本次任务模块'})}});
const cancelPreviewInput=cancelQueuedTasksInputSchema.extend({includeClosure:z.literal(true)}).strict();
const inspectInput=z.object({taskId:z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/).optional()}).strict();
const definitions={
  cbim_dispatch_revise_dependencies:{
    description:'一次原子增删当前未领取目标的多条前置。先读取目标和整图，传 expectedGraphCursor/expectedGoalRevision、target 任务/计划版本、remove 原边/版本、add 新来源任务/计划版本及 reason。各至多32条，至少一项；目标、被增删来源和全部启用后继均须未领取/执行且匹配当前岗位、知识、计划。按全部修改后的图判环，原边只退役，新边不预填结果；保留任务、角色、验收、实例和原信封。已执行来源不能删除以掩盖失败或未知；可靠失败替换走 replace_dependency。回执只证明修订，主轮结束后仍按真实结果和预算领取；未知回包查询原命令，不换调用重发。',
    schema:reviseQueuedDependenciesInputSchema,effects:['maintenance'] as const,
  },
  cbim_dispatch_command_report:{
    description:'只读核实同一主会话原 runId/toolCallId 的真实调用与原命令提交事实，支持目标计划/审阅、派发、撤销、加边、换边、恢复预约和检查点放弃。坏输出后先查原调用，不换调用重做。committed 仅表示原领域记录已提交，absent 不证明未执行或可重试；报告不会清除 unknown、恢复任务或通过业务验收，原生工具等无账本族明确未支持。',
    schema:commandReportToolInputSchema,effects:['read'] as const,
  },
  cbim_dispatch_abandon_checkpoint:{
    description:'明确放弃当前活动周期尚未消费的可靠检查点及可选恢复预约，供负责人变更后的交接。先读取原图与目标，提交 expectedGraphCursor、expectedGoalRevision、taskId、expectedRevision、expectedPlanRevision、checkpointId、expectedResumeRequestId（未预约明确 null）和 reason。只取消原待办并保存审计，不迁移原任务、不运行或回滚、不证明业务完成；当前知识/文件/模型变化不阻止历史处置，损坏或缺失原 canonical 则拒绝。旧后继仍阻塞，按需显式撤销完整未启动闭包，再按当前负责岗位重新规划/派发；complete 仍须真实新候选逐项 superseded。未知回包先查原任务 checkpointAbandonment，不换调用重做。',
    schema:abandonCheckpointInputSchema,effects:['maintenance'] as const,
  },
  cbim_dispatch_add_dependency:{
    description:'为当前目标内尚未领取的既有任务追加一条结果前置，可先创建 B/C 再创建 A，并把 A 设为 B 的前置。先读目标及任务图，传 expectedGraphCursor/expectedGoalRevision、source/target 的 taskId/expectedRevision/expectedPlanRevision 和 reason。两端及全部启用依赖后继必须均未领取、未运行且匹配当前计划、知识和 Workflow；自身、重复、成环或未确认输入都拒绝。仅增加这条边并令原目标等待，不改角色、任务目标、权限或信封，不删除旧前置。保存后结束本主轮，仍需真实来源结果和预算准入才会执行；回执不是业务证据，未知时先查原审计，不换调用重加。',
    schema:addQueuedDependencyInputSchema,effects:['maintenance'] as const,
  },
  cbim_dispatch_resume:{
    description:'为当前活动周期中已安全停泊的原成员任务预约一次续执行。先读取当前图与目标；传 expectedGraphCursor、expectedGoalRevision、taskId、expectedRevision、checkpointId、reason。每任务最多16个检查点，每段只允许一次续执行，只有最新未消费段可预约，原目标/模块/角色/权限/模型/知识/前置候选不得改变；旧求助、失败、取消、中断或已关闭实例不可恢复。成功只登记新待领取信封，结束本主轮后再核实文件和原生上下文、预算及名额，等待不消费检查点；不是已经运行或验收。',
    schema:resumeMemberInputSchema,effects:['maintenance'] as const,
  },
  cbim_dispatch_task:{
    description:'按当前目标计划向模块负责岗位派发任务。先用 cbim_module_owner_inspect 的 moduleIds 查询 execution.groups，明确 agentId、ownerSelection、goal、moduleIds、acceptance；不同负责人拆任务，无负责人或配置失效不能回退主模型或默认执行者。workflowSelections 只选对应模块实际挂载流程，与计划一致。成功仅表示排队，结束本轮让调度继续；不能指定实例、权限、知识正文或伪造维护人。',
    schema:taskInput,effects:['maintenance'] as const,
  },
  cbim_dispatch_inspect:{
    description:'只读查询当前主会话的派发图；可传本图 taskId 查看任务、状态及候选。候选尚未验收；不读取其他会话，不启动、重试或确认收件。',
    schema:inspectInput,effects:['read'] as const,
  },
  cbim_dispatch_cancel:{
    description:'可先在参数中加 includeClosure:true，只读返回完整待撤销/待保留清单及阻塞原因；确认后去掉 includeClosure，用返回 cancel 参数提交。预览不撤销、不停止。明确撤销当前目标周期尚未领取/启动的任务。先用 cbim_dispatch_inspect 读取图，expectedGraphCursor 仅传 streamId/seq，targets 列 taskId/expectedRevision 并填写 reason；必须一并列明尚未启动的依赖后继，缺项则整体拒绝且不自动扩展。不能撤销已经有运行、候选或求助的任务，不停止活动执行。记录和节点永久保留；撤销后重新审阅才能等待，完成目标仍须真实新任务候选替代，撤销不是成功证据。',
    schema:z.union([cancelQueuedTasksInputSchema,cancelPreviewInput]),effects:['maintenance'] as const,
  },
  cbim_dispatch_replace_dependency:{
    description:'将当前目标内尚未领取任务的一条明确失败、安全求助或已显式放弃的可靠检查点前置，替换为同周期后续任务的真实交付候选。先读取 cbim_goal_inspect 和 cbim_dispatch_inspect；提供 expectedGraphCursor/expectedGoalRevision、target 节点与计划版本、replace 旧边版本、with 新前置节点/计划/run/result 身份及 reason。B及全部依赖后继必须从未执行，知识和角色不能过期；A2须覆盖原前置模块并有可核实日志。检查点须先由 abandon_checkpoint 明确放弃，原日志/证明/处置和信封完整；普通取消、未消费检查点、已恢复或未知来源不能替换。不删除任意依赖，不恢复原执行、不修改权限或人工验收。成功仅将原待办重新交给本轮协调器，当前主轮结束后仍须按真实前置和运行门禁启动；最终审阅仍须明确原前置被新候选替代。',
    schema:replaceQueuedDependencyInputSchema,effects:['maintenance'] as const,
  },
};
type DispatchToolName=keyof typeof definitions;

/** 仅由一次性工具桥提供，不能从模型参数中取调用 ID。 */
export interface DispatchToolInvocation {toolCallId:string;signal:AbortSignal}
/**
 * 运行装配方绑定工作区、主会话、runId 及权限；不得给成员 Loop 注入本首版端口。
 * dispatch 保持调用幂等并可靠入队，inspect 必须限制在同一主会话；启动与结果续跑由调度器负责。
 */
export interface DispatchToolsPort {
  /** 本次主运行的可信身份；可选能力仍由真实端口存在决定，不从模型或输出猜测。 */
  readonly binding:MainToolOutputBinding;
  /** 只从当前可信周期复制；缺省为团队模式。 */
  readonly collaborationMode?:'auto'|'team';
  dispatch(task:DispatchTaskInput['task'],invocation:DispatchToolInvocation):Promise<DispatchReceipt>;
  inspect(taskId?:string):Promise<unknown>;
  /** 仅本主 root 的原调用；无写命令、无调度工作意图，停止只取消本次查询。 */
  commandReport?(input:CommandReportToolInput,invocation:DispatchToolInvocation):Promise<CommandVerificationReport>;
  /** 可选能力仅在真实服务装配后公开；身份/周期及命令键仍来自主运行，不能由模型提供。 */
  /** includeClosure 只读生成完整撤销清单，不扩大一次实际写入。 */
  previewCancel?(input:CancelQueuedTasksInput):Promise<unknown>;
  cancel?(input:CancelQueuedTasksInput,invocation:DispatchToolInvocation):Promise<CancelQueuedTasksReceipt>;
  /** 仅主调度装配；候选核实、停机屏障及原子审计由可信后端负责。 */
  replaceDependency?(input:ReplaceQueuedDependencyInput,invocation:DispatchToolInvocation):Promise<ReplaceQueuedDependencyReceipt>;
  /** 仅追加单边；真实闭包与知识核实在服务完成，当前主轮结束后才可按新依赖领取。 */
  addDependency?(input:AddQueuedDependencyInput,invocation:DispatchToolInvocation):Promise<AddQueuedDependencyReceipt>;
  /** 一个目标的多边增删同事务提交，固定原任务和信封；后继按新图重新跟踪。 */
  reviseDependencies?(input:ReviseQueuedDependenciesInput,invocation:DispatchToolInvocation):Promise<ReviseQueuedDependenciesReceipt>;
  /** 仅当前主轮预约，成员实际续执行在本主轮安全结束后另经领取门禁。 */
  resume?(input:ResumeMemberInput,invocation:DispatchToolInvocation):Promise<ResumeMemberReceipt>;
  /** 只终止未消费的旧待办；原运行与证明不变，历史读取和最终 CAS 由服务负责。 */
  abandonCheckpoint?(input:AbandonCheckpointInput,invocation:DispatchToolInvocation):Promise<AbandonCheckpointReceipt>;
}

/** 工具解析在权限检查前和执行前各做一次，不默默剥离模型提供的额外字段。 */
export class DispatchTools {
  private readonly binding:MainToolOutputBinding;
  constructor(private readonly port:DispatchToolsPort,private readonly goals?:GoalTools,private readonly reviews?:CandidateReviewTools,private readonly history?:OfficeHistoryTools){this.binding=Object.freeze(structuredClone(port.binding))}
  /** 只有装配了真实端口才构造本对象；返回值不包含未来工具占位。 */
  get collaborationMode(){return this.port.collaborationMode??'team'}
  private definition(name:DispatchToolName){const definition=definitions[name];return name==='cbim_dispatch_cancel'&&!this.port.previewCancel?{...definition,schema:cancelQueuedTasksInputSchema}:definition}
  private available(name:string){return (name!=='cbim_dispatch_command_report'||!!this.port.commandReport)&&(name!=='cbim_dispatch_cancel'||!!this.port.cancel)&&(name!=='cbim_dispatch_replace_dependency'||!!this.port.replaceDependency)&&(name!=='cbim_dispatch_add_dependency'||!!this.port.addDependency)&&(name!=='cbim_dispatch_revise_dependencies'||!!this.port.reviseDependencies)&&(name!=='cbim_dispatch_resume'||!!this.port.resume)&&(name!=='cbim_dispatch_abandon_checkpoint'||!!this.port.abandonCheckpoint)}
  list(){return [...Object.entries(definitions).filter(([name])=>this.available(name)).map(([name])=>{const d=this.definition(name as DispatchToolName);return ({name,description:d.description,effects:d.effects,inputSchema:zodToJsonSchema(d.schema) as Record<string,unknown>,...(name==='cbim_dispatch_command_report'?commandReportContract():mainToolContract(name as Exclude<DispatchToolName,'cbim_dispatch_command_report'>)),...(name==='cbim_dispatch_cancel'&&this.port.previewCancel?{version:2,outputSchema:{anyOf:[mainToolContract('cbim_dispatch_cancel').outputSchema,zodToJsonSchema(coordinationPreviewSchema)]}}:{})})}),...(this.goals?.list()??[]),...(this.reviews?.list()??[]),...(this.history?.list()??[])]}
  /** 名称检测不执行操作，供 Loop 在知识工具之前选择本适配器。 */
  has(name:string):boolean{return (Object.hasOwn(definitions,name)&&this.available(name))||!!this.goals?.has(name)||!!this.reviews?.has(name)||!!this.history?.has(name)}
  private parse(name:string,input:unknown){
    if(!Object.hasOwn(definitions,name)||!this.available(name))fail('TOOL_NOT_FOUND','当前运行没有此成员派发工具');
    const definition=this.definition(name as DispatchToolName),parsed=definition.schema.safeParse(input);
    if(!parsed.success)fail('DISPATCH_TOOL_INPUT_INVALID','成员工具参数无效：'+parsed.error.issues.map(issue=>issue.path.join('.')+': '+issue.message).join('；'));
    const preview=name==='cbim_dispatch_cancel'&&cancelPreviewInput.safeParse(input).success;
    if(preview&&!this.port.previewCancel)fail('TOOL_NOT_FOUND','当前运行未提供撤销清单预览');
    return {name:name as DispatchToolName,args:parsed.data,effects:preview?['preview'] as const:definition.effects};
  }
  /** 描述入队/读取副作用；成员业务工具仍独立经过其运行权限，不继承本次免询问批准。 */
  describe(name:string,input:unknown){if(this.history?.has(name))return this.history.describe(name,input);if(this.reviews?.has(name))return this.reviews.describe(name,input);if(this.goals?.has(name))return this.goals.describe(name,input);const parsed=this.parse(name,input);return {effects:parsed.effects,native:false}}
  /** gate 后由桥调用；可信 toolCallId 用于持久化幂等，缺失时拒绝，不随机造新操作。 */
  async call(name:string,input:unknown,signal:AbortSignal,toolCallId?:string){
    signal.throwIfAborted();
    if(this.history?.has(name))return this.history.call(name,input,signal);
    if(this.reviews?.has(name))return this.reviews.call(name,input,signal,toolCallId);
    if(this.goals?.has(name))return this.goals.call(name,input,signal,toolCallId);
    const parsed=this.parse(name,input);
    if(typeof toolCallId!=='string'||!toolCallId.trim()||toolCallId.length>512)fail('DISPATCH_CALL_ID_REQUIRED','成员工具缺少可信调用标识');
    // 领域端口不得通过修改传入对象改变回包核验依据；在首次 await 前独立冻结本次原请求。
    const expectedInput=structuredClone(parsed.args);
    if(parsed.name==='cbim_dispatch_cancel'&&cancelPreviewInput.safeParse(parsed.args).success){
      const {includeClosure:_,...input}=cancelPreviewInput.parse(parsed.args);
      const value=await this.port.previewCancel!(input);signal.throwIfAborted();
      return checkedClosurePreview(parsed.name,value,this.binding,input);
    }
    if(parsed.name==='cbim_dispatch_command_report'){
      const value=await this.port.commandReport!(parsed.args as CommandReportToolInput,{toolCallId,signal});
      signal.throwIfAborted();
      return checkedCommandReportResult(value,{workspaceId:this.binding.workspaceId,rootSessionId:this.binding.rootSessionId,...expectedInput as CommandReportToolInput});
    }
    try{
    let value:unknown;
    if(parsed.name==='cbim_dispatch_inspect')value=await this.port.inspect((parsed.args as z.infer<typeof inspectInput>).taskId);
    else if(parsed.name==='cbim_dispatch_cancel')value=await this.port.cancel!(parsed.args as CancelQueuedTasksInput,{toolCallId,signal});
    else if(parsed.name==='cbim_dispatch_replace_dependency')value=await this.port.replaceDependency!(parsed.args as ReplaceQueuedDependencyInput,{toolCallId,signal});
    else if(parsed.name==='cbim_dispatch_add_dependency')value=await this.port.addDependency!(parsed.args as AddQueuedDependencyInput,{toolCallId,signal});
    else if(parsed.name==='cbim_dispatch_revise_dependencies')value=await this.port.reviseDependencies!(parsed.args as ReviseQueuedDependenciesInput,{toolCallId,signal});
    else if(parsed.name==='cbim_dispatch_resume')value=await this.port.resume!(parsed.args as ResumeMemberInput,{toolCallId,signal});
    else if(parsed.name==='cbim_dispatch_abandon_checkpoint')value=await this.port.abandonCheckpoint!(parsed.args as AbandonCheckpointInput,{toolCallId,signal});
    else{const {agentId,...task}=parsed.args as z.infer<typeof taskInput>;value=await this.port.dispatch({...task,assigneeAgentId:agentId},{toolCallId,signal})}
    return checkedMainToolResult(parsed.name,value,this.binding,expectedInput,toolCallId);
    }catch(error){
      if(error instanceof Error&&parsed.name!=='cbim_dispatch_inspect')throw withToolReconciliation(error,{tool:'cbim_receipt_inspect',args:{target:'dispatch',input:{runId:this.binding.runId,toolCallId}}});
      throw error;
    }
  }
}
