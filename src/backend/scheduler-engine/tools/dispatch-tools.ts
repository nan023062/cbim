/**
 * 作用定位：把主调度会话的成员派发、本图查询、未启动任务撤销及单条依赖替换端口转换为内部 Loop 工具，并组合用户目标工具。
 * 设计原因：模型只表达责任角色、模块与目标，运行身份和权限由装配方闭包注入；严格 Schema 拒绝夹带授权或跨会话身份。
 * 职责边界：派发只是入队，撤销和依赖替换只记录调度事实，不算验收。本模块不装配成员递归派发、活动任务中止或手工结果工具。
 */
import {z} from 'zod';
import {zodToJsonSchema} from 'zod-to-json-schema';
import {fail} from '../../core/foundation/errors';
import {dispatchTaskInput,type DispatchTaskInput,type DispatchReceipt} from '../../core/tasks/dispatch-commands';
import {cancelQueuedTasksInputSchema,type CancelQueuedTasksInput,type CancelQueuedTasksReceipt} from '../../core/tasks/queued-task-cancel';
import {replaceQueuedDependencyInputSchema,type ReplaceQueuedDependencyInput,type ReplaceQueuedDependencyReceipt} from '../../core/tasks/queued-dependency-replacement';
import {jsonToolResult} from '../../core/tools/results';
import type {GoalTools} from './goal-tools';

const {assigneeAgentId,...taskFields}=dispatchTaskInput.shape.task.shape;
// 未选定专业执行角色时使用内置静态默认执行者；主角色永远不能被派为执行者。
const taskInput=z.object({agentId:assigneeAgentId.default('cbim:executor').refine(id=>id!=='cbim:main','主 Agent 只能调度，不能承担执行任务'),...taskFields}).strict();
const inspectInput=z.object({taskId:z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/).optional()}).strict();
const definitions={
  cbim_dispatch_task:{
    description:'将任务交给当前主会话的执行 Agent。先查询 Team 与模块，明确 goal、moduleIds 和 acceptance；没有可选的专业 Agent 时省略 agentId 或使用 cbim:executor，由内置默认执行者承担。主 Agent 只调度，不能选择 cbim:main。成功仅表示排队，本轮调度器启动执行并将结果返回；不要轮询等待，不宣称已完成。不能指定实例、权限或伪造维护人。',
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
  dispatch(task:DispatchTaskInput['task'],invocation:DispatchToolInvocation):Promise<DispatchReceipt>;
  inspect(taskId?:string):Promise<unknown>;
  /** 可选能力仅在真实服务装配后公开；身份/周期及命令键仍来自主运行，不能由模型提供。 */
  cancel?(input:CancelQueuedTasksInput,invocation:DispatchToolInvocation):Promise<CancelQueuedTasksReceipt>;
  /** 仅主调度装配；候选核实、停机屏障及原子审计由可信后端负责。 */
  replaceDependency?(input:ReplaceQueuedDependencyInput,invocation:DispatchToolInvocation):Promise<ReplaceQueuedDependencyReceipt>;
}

/** 工具解析在权限检查前和执行前各做一次，不默默剥离模型提供的额外字段。 */
export class DispatchTools {
  constructor(private readonly port:DispatchToolsPort,private readonly goals?:GoalTools){}
  /** 只有装配了真实端口才构造本对象；返回值不包含未来工具占位。 */
  private available(name:string){return (name!=='cbim_dispatch_cancel'||!!this.port.cancel)&&(name!=='cbim_dispatch_replace_dependency'||!!this.port.replaceDependency)}
  list(){return [...Object.entries(definitions).filter(([name])=>this.available(name)).map(([name,d])=>({name,version:1 as const,description:d.description,effects:d.effects,inputSchema:zodToJsonSchema(d.schema) as Record<string,unknown>})),...(this.goals?.list()??[])]}
  /** 名称检测不执行操作，供 Loop 在知识工具之前选择本适配器。 */
  has(name:string):boolean{return (Object.hasOwn(definitions,name)&&this.available(name))||!!this.goals?.has(name)}
  private parse(name:string,input:unknown){
    if(!Object.hasOwn(definitions,name)||!this.available(name))fail('TOOL_NOT_FOUND','当前运行没有此成员派发工具');
    const definition=definitions[name as DispatchToolName],parsed=definition.schema.safeParse(input);
    if(!parsed.success)fail('DISPATCH_TOOL_INPUT_INVALID','成员工具参数无效：'+parsed.error.issues.map(issue=>issue.path.join('.')+': '+issue.message).join('；'));
    return {name,args:parsed.data,effects:definition.effects};
  }
  /** 描述入队/读取副作用；成员业务工具仍独立经过其运行权限，不继承本次免询问批准。 */
  describe(name:string,input:unknown){if(this.goals?.has(name))return this.goals.describe(name,input);const parsed=this.parse(name,input);return {effects:parsed.effects,native:false}}
  /** gate 后由桥调用；可信 toolCallId 用于持久化幂等，缺失时拒绝，不随机造新操作。 */
  async call(name:string,input:unknown,signal:AbortSignal,toolCallId?:string){
    signal.throwIfAborted();
    if(this.goals?.has(name))return this.goals.call(name,input,signal,toolCallId);
    const parsed=this.parse(name,input);
    if(typeof toolCallId!=='string'||!toolCallId.trim()||toolCallId.length>512)fail('DISPATCH_CALL_ID_REQUIRED','成员工具缺少可信调用标识');
    if(parsed.name==='cbim_dispatch_inspect')return jsonToolResult(name,await this.port.inspect((parsed.args as z.infer<typeof inspectInput>).taskId));
    if(parsed.name==='cbim_dispatch_cancel')return jsonToolResult(name,await this.port.cancel!(parsed.args as CancelQueuedTasksInput,{toolCallId,signal}));
    if(parsed.name==='cbim_dispatch_replace_dependency')return jsonToolResult(name,await this.port.replaceDependency!(parsed.args as ReplaceQueuedDependencyInput,{toolCallId,signal}));
    const {agentId,...task}=parsed.args as z.infer<typeof taskInput>;
    return jsonToolResult(name,await this.port.dispatch({...task,assigneeAgentId:agentId},{toolCallId,signal}));
  }
}
