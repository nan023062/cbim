/**
 * 作用定位：将主 Agent 当前用户目标的读取、规划和审阅端口注册为内部 Loop 工具。
 * 设计原因：输入复用 Core 的严格协议，周期、运行及命令身份由可信装配闭包决定；模型只提交计划和有引用的判断，不能自行指定目标所属会话或签发验收。
 * 职责边界：complete 只申请主轮次结算后的复核；人工项只能引用用户已保存且经专用入口消费的接受，模型不能签署或继续等待。工具层不执行成员或重造证据。
 */
import {z} from 'zod';
import {zodToJsonSchema} from 'zod-to-json-schema';
import {fail} from '../../core/foundation/errors';
import {goalPlanInputSchema,goalReviewInputSchema} from '../../core/tasks/scope-goal';
import {jsonToolResult} from '../../core/tools/results';

const inspectInput=z.object({}).strict();
const definitions={
  cbim_goal_inspect:{
    description:'读取当前用户任务的原始输入、目标版本、计划和审阅状态，以及装配端提供的本会话任务图。先读取最新 revision 和真实候选再规划或审阅；读取不推进执行、不代表验收，不轮询等待。',
    schema:inspectInput,effects:['read'] as const,
  },
  cbim_goal_plan:{
    description:'按 expectedRevision 保存当前用户目标的结构化计划：目标、约束、验收项与模块/执行 Agent 分工。先查询真实业务图和团队图；不能改写原始用户输入、缩减用户要求或伪造模块/角色。保存计划不派发任务、不授予业务写权限。',
    schema:goalPlanInputSchema,effects:['maintenance'] as const,
  },
  cbim_goal_review:{
    description:'按 expectedRevision 审阅当前目标和真实执行证据。引用实际成员交付或本轮知识工具回执，不能把文字、派发或审阅回执当作证据。human 项 satisfied 仅能引用本输入实际消费的 {kind:human-decision,decisionId,continuationId} 接受，原业务主体和候选必须未变；模型不能签署、选择历史接受或自动继续等待。拒绝/补证通过 superseded.humanDecision 引用，替代必须是接续后新任务的真实候选，旧结果保留；仍需人工意见时提供真实 member-result 并等待新的决定。complete 仅申请主轮可靠结算后的再次复核，不立即结束任务。',
    schema:goalReviewInputSchema,effects:['maintenance'] as const,
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
  inspect():Promise<unknown>;
  plan(input:z.infer<typeof goalPlanInputSchema>,invocation:GoalToolInvocation):Promise<unknown>;
  review(input:z.infer<typeof goalReviewInputSchema>,invocation:GoalToolInvocation):Promise<unknown>;
}

/** 仅在主调度装配真实目标服务时注册；成员执行 Loop 不获得规划整轮用户目标的入口。 */
export class GoalTools {
  constructor(private readonly port:GoalToolsPort){}
  /** 工具表只公布已绑定端口，不包含未来人工确认或完成按钮的占位。 */
  list(){return Object.entries(definitions).map(([name,d])=>({name,version:1 as const,description:d.description,effects:d.effects,inputSchema:zodToJsonSchema(d.schema) as Record<string,unknown>}))}
  /** 精确匹配已实现名称，不按 cbim_goal_ 前缀放行未知操作。 */
  has(name:string):name is GoalToolName{return Object.hasOwn(definitions,name)}
  private parse(name:string,input:unknown){
    if(!this.has(name))fail('TOOL_NOT_FOUND','当前运行没有此目标规划工具');
    const definition=definitions[name],parsed=definition.schema.safeParse(input);
    if(!parsed.success)fail('GOAL_TOOL_INPUT_INVALID','目标工具参数无效：'+parsed.error.issues.map(issue=>issue.path.join('.')+': '+issue.message).join('；'));
    return {name,args:parsed.data,effects:definition.effects};
  }
  /** 规划和审阅仅维护调度记录；不能因此放行主 Agent 的业务写入或签发人工批准。 */
  describe(name:string,input:unknown){const parsed=this.parse(name,input);return {effects:parsed.effects,native:false}}
  /** gate 放行后调用；服务保持真实结果，complete 的完成门禁仍在可信主运行结算阶段。 */
  async call(name:string,input:unknown,signal:AbortSignal,toolCallId?:string){
    signal.throwIfAborted();
    const parsed=this.parse(name,input);
    if(typeof toolCallId!=='string'||!toolCallId.trim()||toolCallId.length>512)fail('GOAL_CALL_ID_REQUIRED','目标工具缺少可信调用标识');
    const invocation={toolCallId,signal};
    if(parsed.name==='cbim_goal_inspect')return jsonToolResult(name,await this.port.inspect());
    if(parsed.name==='cbim_goal_plan')return jsonToolResult(name,await this.port.plan(parsed.args as z.infer<typeof goalPlanInputSchema>,invocation));
    return jsonToolResult(name,await this.port.review(parsed.args as z.infer<typeof goalReviewInputSchema>,invocation));
  }
}
