/**
 * includeClosure 的 awaiting_user 分支只读生成保留清单；完整清单确认后的审阅仍走原写契约。
 * 未配置自定义 Agent 的模块分配给主 Agent；不再生成默认执行者兜底绑定。
 * memberPause 正式提交只接受 waiting 申请的全量清单；公开回包仍核实际原请求，不把保留任务解释为完成。
 * 作用定位：将主 Agent 当前用户目标、真实补充历史的读取及规划审阅端口注册为内部 Loop 工具。
 * 设计原因：岗位分工必须包含发现所得 ownerSelection，主会话直接执行以独立证据类型审阅；两者均保留 Workflow 选择。输出只序列化一次核 Schema 与本轮身份，坏回包不重做已发生决策。旧请求兼容只在服务原命令查询。
 * 职责边界：complete 只申请主轮次结算后的复核；人工项只能引用用户已保存且经专用入口消费的接受，模型不能签署或继续等待。工具层不执行成员或重造证据。
 */
import {z} from 'zod';
import {withToolReconciliation} from '../../core/tools/outcome';
import {checkedClosurePreview} from './coordination-contracts';
import {coordinationPreviewSchema} from '../../core/tasks/coordination-preview';
import {zodToJsonSchema} from 'zod-to-json-schema';
import {fail} from '../../core/foundation/errors';
import {goalPlanInputSchema,goalReviewInputSchema} from '../../core/tasks/scope-goal';
import type {MainToolOutputBinding} from '../../core/tasks/main-tool-output';
import {checkedMainToolResult,mainToolContract} from './main-tool-contracts';

const inspectInput=z.object({}).strict();
const ownerPlanInput=goalPlanInputSchema.superRefine((value,context)=>{if(value.assignments.some(assignment=>assignment.agentId!=='cbim:main'&&!assignment.ownerSelection))context.addIssue({code:'custom',message:'业务分工必须提供模块负责岗位的 ownerSelection'})});
const pausePreviewInput=z.object({decision:z.literal('awaiting_user'),memberPause:z.object({includeClosure:z.literal(true)}).strict()}).strict();
const reviewInput=goalReviewInputSchema.superRefine((value,context)=>{if(value.memberPause&&value.decision!=='awaiting_user')context.addIssue({code:'custom',message:'memberPause 只能随 awaiting_user 申请'})});
const definitions={
  cbim_goal_inspect:{
    description:'读取当前用户任务的原始 input、activeInputs 接收历史、continuations、目标版本、计划和审阅及本会话任务图。运行中插入后先读取 accepted 快照（可能含附件展开资料），按最新 inputRevision 重新规划并保留 human 条件；pending/unknown 不能重试发送、派工或宣称完成。先读取最新 revision 和真实候选再规划审阅；读取不推进执行、不代表验收，不轮询等待。',
    schema:inspectInput,effects:['read'] as const,
  },
  cbim_goal_plan:{
    description:'按 expectedRevision 保存目标、约束、验收项与模块分工。业务 assignments 必须使用 cbim_module_owner_inspect 的 execution.groups 中真实 ownerSelection，并明确对应 agentId；不同岗位拆分。workflowSelections 仅选本模块实际挂载流程。未指定自定义 Agent 的模块分配给 cbim:main 在当前会话直接执行，不填 ownerSelection 或成员专属 Workflow，不派发给自己。计划和派发保持同一岗位/流程，变化须重新规划新任务；旧成果按原岗位解释，保存计划不派发或授予权限。',
    schema:ownerPlanInput,effects:['maintenance'] as const,
  },
  cbim_goal_review:{
    description:'先传 {decision:awaiting_user,memberPause:{includeClosure:true}} 只读返回完整待保留清单及阻塞原因，不提交；确认后用返回 memberPause 原样随完整审阅提交。按 expectedRevision 审阅当前目标和真实执行证据。引用实际成员交付、本轮知识工具回执，或 {kind:main-execution,toolCallIds:[实际调用ID]} 引用主 Agent 本轮直接执行后的真实业务文件/命令回执，不能把文字、派发或审阅回执当作证据。awaiting_user 可带 memberPause:{version:1,expectedGraphCursor,tasks} 精确保留全部未完成工作：每项含 taskId/expectedRevision/expectedPlanRevision，kind=checkpoint 另含原 checkpointId，kind=unstarted 只能是这些检查点的未领取后继。至少一个可靠且未预约检查点；主轮安全结束后才持久等待，重启不启动，用户明确继续并重核后才可重规划和预约。human 项 satisfied 仅引用本输入实际消费的 {kind:human-decision,decisionId,continuationId}，模型不能签署或自动继续。拒绝/补证通过 superseded.humanDecision 引用，替代须是接续后新任务的真实候选。complete 仅申请结算后复核，不立即结束任务。',
    schema:z.union([reviewInput,pausePreviewInput]),effects:['maintenance'] as const,
  },
};
type GoalToolName=keyof typeof definitions;

/** 由工具桥提供实际调用 ID 和取消信号，不从模型输入提取或随机补造。 */
export interface GoalToolInvocation {toolCallId:string;signal:AbortSignal}
/**
 * 工作区、主会话、scope 和 run 由可信装配绑定；这里只接收 Core 计划/审阅协议。
 * inspect 返回当前真实状态；写入口负责幂等、版本和证据核验，失败不能被工具层改写为成功。
 */
export interface GoalToolsPort {
  /** 可信主运行固定身份，不能取自模型输入或服务返回；构造时复制，避免运行中换绑。 */
  readonly binding:MainToolOutputBinding;
  /** 可信周期模式，不能由工具输入或返回值决定。 */
  readonly collaborationMode?:'auto'|'team';
  inspect():Promise<unknown>;
  /** 只读生成待保留完整清单；不提交审阅或停泊。 */
  previewPause?():Promise<unknown>;
  plan(input:z.infer<typeof goalPlanInputSchema>,invocation:GoalToolInvocation):Promise<unknown>;
  review(input:z.infer<typeof goalReviewInputSchema>,invocation:GoalToolInvocation):Promise<unknown>;
}

/** 仅在主调度装配真实目标服务时注册；成员执行 Loop 不获得规划整轮用户目标的入口。 */
export class GoalTools {
  private readonly binding:MainToolOutputBinding;
  constructor(private readonly port:GoalToolsPort){this.binding=Object.freeze(structuredClone(port.binding))}
  /** 工具表只公布已绑定端口，不包含未来人工确认或完成按钮的占位。 */
  list(){return Object.entries(definitions).map(([name,definition])=>{const d=this.definition(name as GoalToolName);return ({name,description:d.description,effects:d.effects,inputSchema:zodToJsonSchema(d.schema) as Record<string,unknown>,...mainToolContract(name as GoalToolName),...(name==='cbim_goal_review'&&this.port.previewPause?{version:2,outputSchema:{anyOf:[mainToolContract('cbim_goal_review').outputSchema,zodToJsonSchema(coordinationPreviewSchema)]}}:{})})})}
  /** 精确匹配已实现名称，不按 cbim_goal_ 前缀放行未知操作。 */
  has(name:string):name is GoalToolName{return Object.hasOwn(definitions,name)}
  private definition(name:GoalToolName){const definition=definitions[name];return name==='cbim_goal_review'&&!this.port.previewPause?{...definition,schema:reviewInput}:definition}
  private parse(name:string,input:unknown){
    if(!this.has(name))fail('TOOL_NOT_FOUND','当前运行没有此目标规划工具');
    const definition=this.definition(name),parsed=definition.schema.safeParse(input);
    if(!parsed.success)fail('GOAL_TOOL_INPUT_INVALID','目标工具参数无效：'+parsed.error.issues.map(issue=>issue.path.join('.')+': '+issue.message).join('；'));
    const preview=name==='cbim_goal_review'&&pausePreviewInput.safeParse(input).success;
    if(preview&&!this.port.previewPause)fail('TOOL_NOT_FOUND','当前运行未提供等待清单预览');
    return {name,args:parsed.data,effects:preview?['preview'] as const:definition.effects};
  }
  /** 规划和审阅仅维护调度记录；不能因此放行主 Agent 的业务写入或签发人工批准。 */
  describe(name:string,input:unknown){const parsed=this.parse(name,input);return {effects:parsed.effects,native:false}}
  /** gate 放行后调用；服务保持真实结果，complete 的完成门禁仍在可信主运行结算阶段。 */
  async call(name:string,input:unknown,signal:AbortSignal,toolCallId?:string){
    signal.throwIfAborted();
    const parsed=this.parse(name,input);
    if(typeof toolCallId!=='string'||!toolCallId.trim()||toolCallId.length>512)fail('GOAL_CALL_ID_REQUIRED','目标工具缺少可信调用标识');
    if(parsed.name==='cbim_goal_review'&&pausePreviewInput.safeParse(parsed.args).success){
      const value=await this.port.previewPause!();signal.throwIfAborted();
      return checkedClosurePreview(parsed.name,value,this.binding);
    }
    const invocation={toolCallId,signal};
    try{
    const value=parsed.name==='cbim_goal_inspect'?await this.port.inspect():parsed.name==='cbim_goal_plan'
      ?await this.port.plan(parsed.args as z.infer<typeof goalPlanInputSchema>,invocation)
      :await this.port.review(parsed.args as z.infer<typeof goalReviewInputSchema>,invocation);
    return checkedMainToolResult(parsed.name,value,this.binding,parsed.args,toolCallId);
    }catch(error){
      if(error instanceof Error&&parsed.name!=='cbim_goal_inspect')throw withToolReconciliation(error,{tool:'cbim_receipt_inspect',args:{target:'dispatch',input:{runId:this.binding.runId,toolCallId}}});
      throw error;
    }
  }
}
