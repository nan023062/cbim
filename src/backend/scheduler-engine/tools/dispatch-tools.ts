/**
 * 作用定位：把主调度的派发、查询、未启动撤销、追加/替换依赖及一次检查点续执行预约转换为内部工具，并组合目标工具。
 * 设计原因：模型明确提交发现所得 ownerSelection、角色、模块和 Workflow；不自动填默认角色。可信闭包固定身份，严格输入拒绝夹带授权，输出核同一份 wire，失败不回滚或重做已入队事实。
 * 职责边界：派发只是入队，续执行只是预约，撤销和依赖修订只记录调度事实，不算验收。本模块不装配成员递归派发、活动任务中止或手工结果工具。
 */
import {z} from 'zod';
import {zodToJsonSchema} from 'zod-to-json-schema';
import {fail} from '../../core/foundation/errors';
import {dispatchTaskFields,type DispatchTaskInput,type DispatchReceipt} from '../../core/tasks/dispatch-commands';
import {validateWorkflowSelections} from '../../core/tasks/workflow-selection';
import {cancelQueuedTasksInputSchema,type CancelQueuedTasksInput,type CancelQueuedTasksReceipt} from '../../core/tasks/queued-task-cancel';
import {replaceQueuedDependencyInputSchema,type ReplaceQueuedDependencyInput,type ReplaceQueuedDependencyReceipt} from '../../core/tasks/queued-dependency-replacement';
import {addQueuedDependencyInputSchema,type AddQueuedDependencyInput,type AddQueuedDependencyReceipt} from '../../core/tasks/queued-dependency-addition';
import type {MainToolOutputBinding} from '../../core/tasks/main-tool-output';
import {checkedMainToolResult,mainToolContract} from './main-tool-contracts';
import type {GoalTools} from './goal-tools';
import {resumeMemberInputSchema,type ResumeMemberInput,type ResumeMemberReceipt} from '../../core/tasks/queued-member-resume';

const {assigneeAgentId,...taskFields}=dispatchTaskFields.shape;
// 角色只核对岗位能力，不再作为默认路由；实际岗位预期来自模块负责人发现。
const taskInput=z.object({agentId:assigneeAgentId.refine(id=>id!=='cbim:main','主 Agent 只能调度，不能承担执行任务'),...taskFields}).strict().superRefine((value,context)=>{if(!value.ownerSelection)context.addIssue({code:'custom',message:'必须提供模块负责岗位的 ownerSelection'});try{validateWorkflowSelections(value.moduleIds,value.workflowSelections)}catch{context.addIssue({code:'custom',message:'Workflow 选择必须属于本次任务模块'})}});
const inspectInput=z.object({taskId:z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/).optional()}).strict();
const definitions={
  cbim_dispatch_add_dependency:{
    description:'为当前目标内尚未领取的既有任务追加一条结果前置，可先创建 B/C 再创建 A，并把 A 设为 B 的前置。先读目标及任务图，传 expectedGraphCursor/expectedGoalRevision、source/target 的 taskId/expectedRevision/expectedPlanRevision 和 reason。两端及全部启用依赖后继必须均未领取、未运行且匹配当前计划、知识和 Workflow；自身、重复、成环或未确认输入都拒绝。仅增加这条边并令原目标等待，不改角色、任务目标、权限或信封，不删除旧前置。保存后结束本主轮，仍需真实来源结果和预算准入才会执行；回执不是业务证据，未知时先查原审计，不换调用重加。',
    schema:addQueuedDependencyInputSchema,effects:['maintenance'] as const,
  },
  cbim_dispatch_resume:{
    description:'为当前活动周期中已安全停泊的原成员任务预约一次续执行。先读取当前图与目标；传 expectedGraphCursor、expectedGoalRevision、taskId、expectedRevision、checkpointId、reason。每任务最多一个检查点和一次续执行，原目标/模块/角色/权限/模型/知识/前置候选不得改变；旧求助、失败、取消、中断或已关闭实例不可恢复。成功只登记新待领取信封，结束本主轮后再核实文件和原生上下文、预算及名额，等待不消费检查点；不是已经运行或验收。',
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
    description:'明确撤销当前目标周期尚未领取/启动的任务。先用 cbim_dispatch_inspect 读取图，expectedGraphCursor 仅传 streamId/seq，targets 列 taskId/expectedRevision 并填写 reason；必须一并列明尚未启动的依赖后继，缺项则整体拒绝且不自动扩展。不能撤销已经有运行、候选或求助的任务，不停止活动执行。记录和节点永久保留；撤销后重新审阅才能等待，完成目标仍须真实新任务候选替代，撤销不是成功证据。',
    schema:cancelQueuedTasksInputSchema,effects:['maintenance'] as const,
  },
  cbim_dispatch_replace_dependency:{
    description:'将当前目标内尚未领取任务的一条失败或安全求助前置，替换为同周期后续任务的真实交付候选。先读取 cbim_goal_inspect 和 cbim_dispatch_inspect；提供 expectedGraphCursor/expectedGoalRevision、target 节点与计划版本、replace 旧边版本、with 新前置节点/计划/run/result 身份及 reason。B及全部依赖后继必须从未执行，知识和角色不能过期；A2须覆盖原前置模块并有可核实日志。不删除任意依赖，不恢复原执行、不修改权限或人工验收。成功仅将原待办重新交给本轮协调器，当前主轮结束后仍须按真实前置和运行门禁启动；最终审阅仍须明确原前置被新候选替代。',
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
  dispatch(task:DispatchTaskInput['task'],invocation:DispatchToolInvocation):Promise<DispatchReceipt>;
  inspect(taskId?:string):Promise<unknown>;
  /** 可选能力仅在真实服务装配后公开；身份/周期及命令键仍来自主运行，不能由模型提供。 */
  cancel?(input:CancelQueuedTasksInput,invocation:DispatchToolInvocation):Promise<CancelQueuedTasksReceipt>;
  /** 仅主调度装配；候选核实、停机屏障及原子审计由可信后端负责。 */
  replaceDependency?(input:ReplaceQueuedDependencyInput,invocation:DispatchToolInvocation):Promise<ReplaceQueuedDependencyReceipt>;
  /** 仅追加单边；真实闭包与知识核实在服务完成，当前主轮结束后才可按新依赖领取。 */
  addDependency?(input:AddQueuedDependencyInput,invocation:DispatchToolInvocation):Promise<AddQueuedDependencyReceipt>;
  /** 仅当前主轮预约，成员实际续执行在本主轮安全结束后另经领取门禁。 */
  resume?(input:ResumeMemberInput,invocation:DispatchToolInvocation):Promise<ResumeMemberReceipt>;
}

/** 工具解析在权限检查前和执行前各做一次，不默默剥离模型提供的额外字段。 */
export class DispatchTools {
  private readonly binding:MainToolOutputBinding;
  constructor(private readonly port:DispatchToolsPort,private readonly goals?:GoalTools){this.binding=Object.freeze(structuredClone(port.binding))}
  /** 只有装配了真实端口才构造本对象；返回值不包含未来工具占位。 */
  private available(name:string){return (name!=='cbim_dispatch_cancel'||!!this.port.cancel)&&(name!=='cbim_dispatch_replace_dependency'||!!this.port.replaceDependency)&&(name!=='cbim_dispatch_add_dependency'||!!this.port.addDependency)&&(name!=='cbim_dispatch_resume'||!!this.port.resume)}
  list(){return [...Object.entries(definitions).filter(([name])=>this.available(name)).map(([name,d])=>({name,description:d.description,effects:d.effects,inputSchema:zodToJsonSchema(d.schema) as Record<string,unknown>,...mainToolContract(name as DispatchToolName)})),...(this.goals?.list()??[])]}
  /** 名称检测不执行操作，供 Loop 在知识工具之前选择本适配器。 */
  has(name:string):boolean{return (Object.hasOwn(definitions,name)&&this.available(name))||!!this.goals?.has(name)}
  private parse(name:string,input:unknown){
    if(!Object.hasOwn(definitions,name)||!this.available(name))fail('TOOL_NOT_FOUND','当前运行没有此成员派发工具');
    const definition=definitions[name as DispatchToolName],parsed=definition.schema.safeParse(input);
    if(!parsed.success)fail('DISPATCH_TOOL_INPUT_INVALID','成员工具参数无效：'+parsed.error.issues.map(issue=>issue.path.join('.')+': '+issue.message).join('；'));
    return {name:name as DispatchToolName,args:parsed.data,effects:definition.effects};
  }
  /** 描述入队/读取副作用；成员业务工具仍独立经过其运行权限，不继承本次免询问批准。 */
  describe(name:string,input:unknown){if(this.goals?.has(name))return this.goals.describe(name,input);const parsed=this.parse(name,input);return {effects:parsed.effects,native:false}}
  /** gate 后由桥调用；可信 toolCallId 用于持久化幂等，缺失时拒绝，不随机造新操作。 */
  async call(name:string,input:unknown,signal:AbortSignal,toolCallId?:string){
    signal.throwIfAborted();
    if(this.goals?.has(name))return this.goals.call(name,input,signal,toolCallId);
    const parsed=this.parse(name,input);
    if(typeof toolCallId!=='string'||!toolCallId.trim()||toolCallId.length>512)fail('DISPATCH_CALL_ID_REQUIRED','成员工具缺少可信调用标识');
    // 领域端口不得通过修改传入对象改变回包核验依据；在首次 await 前独立冻结本次原请求。
    const expectedInput=structuredClone(parsed.args);
    let value:unknown;
    if(parsed.name==='cbim_dispatch_inspect')value=await this.port.inspect((parsed.args as z.infer<typeof inspectInput>).taskId);
    else if(parsed.name==='cbim_dispatch_cancel')value=await this.port.cancel!(parsed.args as CancelQueuedTasksInput,{toolCallId,signal});
    else if(parsed.name==='cbim_dispatch_replace_dependency')value=await this.port.replaceDependency!(parsed.args as ReplaceQueuedDependencyInput,{toolCallId,signal});
    else if(parsed.name==='cbim_dispatch_add_dependency')value=await this.port.addDependency!(parsed.args as AddQueuedDependencyInput,{toolCallId,signal});
    else if(parsed.name==='cbim_dispatch_resume')value=await this.port.resume!(parsed.args as ResumeMemberInput,{toolCallId,signal});
    else{const {agentId,...task}=parsed.args as z.infer<typeof taskInput>;value=await this.port.dispatch({...task,assigneeAgentId:agentId},{toolCallId,signal})}
    return checkedMainToolResult(parsed.name,value,this.binding,expectedInput,toolCallId);
  }
}
