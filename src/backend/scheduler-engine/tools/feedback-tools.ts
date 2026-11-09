/**
 * 作用定位：主会话的 GitHub 反馈提交与原提交核实工具，承接两项内置 Skill 的格式字段。
 * 设计原因：输入严格、目标来自可信端口，外部写单独分类；成功只返回最小提交事实，不向模型提供 Issue 链接或开发进度。
 */
import {zodToJsonSchema} from 'zod-to-json-schema';
import {fail} from '../../core/foundation/errors';
import {checkedJsonToolResult} from '../../core/tools/results';
import {githubFeedbackScopeSchema} from '../../core/tools/scope-schema';
import type {RunToolDescriptor} from '../../core/policy/tool-policy';
import {feedbackInputSchema,feedbackReceiptInputSchema,feedbackResultSchema,type FeedbackToolsPort} from '../../core/connectors/github-feedback';

/** 只由桌面主会话装配；没有账号设置、变更仓库或重新发送未知提交的模型入口。 */
export class FeedbackTools {
  readonly scope;
  constructor(private port:FeedbackToolsPort,workspaceId:string){
    this.scope=Object.freeze(githubFeedbackScopeSchema.parse(port.scope));
    if(this.scope.workspaceId!==workspaceId)fail('GITHUB_FEEDBACK_BINDING','反馈工具与本轮工作区不一致');
  }
  has(name:string){return name==='cbim_feedback_submit'||name==='cbim_feedback_receipt'}
  list(){return [
    {name:'cbim_feedback_submit',version:1,effects:['external-write'],description:'将用户按 BUG 反馈／需求许愿 Skill 填写的上下文直接创建 GitHub Issue。账号和目标已由设置授权；不读取整段会话或工程。成功后结束反馈流程，不追加结果消息。未知结果只能核实原提交。',inputSchema:zodToJsonSchema(feedbackInputSchema) as Record<string,unknown>},
    {name:'cbim_feedback_receipt',version:1,effects:['read'],description:'只核实当前工作区唯一待核实的 GitHub 原提交，或本会话最近提交；可在硬中断后的新会话核实。不查开发进度，不重发，不能把另一条原提交当作当前新反馈成功。成功后不追加结果消息；未找到仍未知。',inputSchema:zodToJsonSchema(feedbackReceiptInputSchema) as Record<string,unknown>},
  ]}
  private parse(name:string,input:unknown){
    if(!this.has(name))fail('GITHUB_TOOL','本轮没有该反馈工具');
    const parsed=(name==='cbim_feedback_submit'?feedbackInputSchema:feedbackReceiptInputSchema).safeParse(input);
    if(!parsed.success)fail('GITHUB_FEEDBACK_INPUT','请使用反馈 Skill 的完整格式；不接受地址、仓库、凭据或授权参数');return parsed.data;
  }
  describe(name:string,input:unknown):RunToolDescriptor{this.parse(name,input);return {effects:[name==='cbim_feedback_submit'?'external-write':'read'],native:false,contractVersion:1,scope:this.scope}}
  /** 仅调用一次端口；协议异常不重放外部写。返回 submitted 才允许静默结束。 */
  async call(name:string,input:unknown,signal:AbortSignal){
    this.parse(name,input);signal.throwIfAborted();
    const value=name==='cbim_feedback_submit'?await this.port.submit(feedbackInputSchema.parse(input),signal):await this.port.receipt(signal);
    return checkedJsonToolResult(name,value,feedbackResultSchema);
  }
}
