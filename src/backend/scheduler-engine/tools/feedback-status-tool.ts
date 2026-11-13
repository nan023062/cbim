/**
 * 作用定位：主会话的反馈可用性只读诊断，区分本轮装配事实与当前本机连接事实。
 * 设计原因：未连接时提交／核实仍不注册；独立诊断入口避免把任何工具缺失都归因为未登录。它不授予写权、不刷新已捕获范围、不读取提交结果。
 */
import {zodToJsonSchema} from 'zod-to-json-schema';
import {fail} from '../../core/foundation/errors';
import {checkedJsonToolResult} from '../../core/tools/results';
import type {RunToolDescriptor} from '../../core/tools/policy/tool-policy';
import {feedbackAvailabilitySchema,feedbackConnectionCheckSchema,feedbackReceiptInputSchema,type FeedbackAvailability,type FeedbackConnectionCheck} from '../../../logic/feedback';

const messages:Record<FeedbackAvailability['code'],string>={
  FEEDBACK_READY:'本轮已装配反馈提交与核实工具；实际提交仍需通过会话权限、连接和 GitHub 核验。',
  FEEDBACK_TOOL_NOT_LOADED:'本轮未装配反馈连接诊断服务。请检查 CBIM 版本或重启应用后查看运行日志；不能据此判断账号未连接。',
  FEEDBACK_NEW_TURN_REQUIRED:'GitHub 已连接，但本轮没有提交与核实工具。请发送一条新消息开启新一轮并沿用已填上下文；若仍缺失，请检查版本和运行日志，不要反复登录。',
  GITHUB_NOT_CONNECTED:'本机尚未保存 GitHub 连接。请到设置 → GitHub 反馈连接账号，再发送新消息继续。',
  GITHUB_AUTH_PENDING:'本机仍在等待 GitHub 授权结果。请回到设置 → GitHub 反馈，保持页面打开直到显示已连接；网页授权后无需重复授权。',
  GITHUB_CONNECTION_CHANGED:'本机 GitHub 连接已变化，本轮仍绑定原连接。请发送新消息开启新一轮；原未知提交仍需核实，不能自动重发。',
  GITHUB_EXPIRED:'GitHub 登录已过期。请在设置中重新连接，再发送新消息继续。',
  GITHUB_SECRET_STORAGE:'本机安全存储不可用。请检查系统安全存储后继续。',
  GITHUB_SETTINGS:'无法核实本机 GitHub 设置。请查看设置页和本机日志；不能据此判断账号未连接。',
};

/** registered 由本轮实际 FeedbackTools 实例确定；check 由桌面服务注入，模型不能提供状态、仓库或凭据。 */
export class FeedbackStatusTool {
  constructor(private workspaceId:string,private registered:boolean,private check?:()=>Promise<FeedbackConnectionCheck>){}
  has(name:string){return name==='cbim_feedback_status'}
  list(){return [{name:'cbim_feedback_status',version:1,effects:['read'] as const,description:'只读核实当前反馈连接与本轮提交／核实工具可用性。反馈工具缺失或连接后仍不可用时先调用；不查询 Issue 或处理进度、不连接账号、不提交或重发。knowledge 工具目录不包含本入口或反馈提交工具。',inputSchema:zodToJsonSchema(feedbackReceiptInputSchema) as Record<string,unknown>,outputSchema:zodToJsonSchema(feedbackAvailabilitySchema) as Record<string,unknown>}]}
  private parse(name:string,input:unknown){if(!this.has(name)||!feedbackReceiptInputSchema.safeParse(input).success)fail('GITHUB_FEEDBACK_INPUT','反馈状态查询不接受身份、仓库、凭据或授权参数')}
  /** 精确只读分类，使用工作区范围，不借用或创建 GitHub 写授权。 */
  describe(name:string,input:unknown):RunToolDescriptor{this.parse(name,input);return {effects:['read'],native:false,contractVersion:1,scope:{kind:'workspace',workspaceId:this.workspaceId}}}
  /** 本轮装配不随登录中途变化；已登录但未装配时要求新一轮。连接状态不证明原 Issue 是否提交。 */
  async snapshot():Promise<FeedbackAvailability>{
    if(!this.check)return {code:'FEEDBACK_TOOL_NOT_LOADED',submitAvailable:this.registered,receiptAvailable:this.registered,message:messages.FEEDBACK_TOOL_NOT_LOADED};
    let connection:FeedbackConnectionCheck;
    try{connection=feedbackConnectionCheckSchema.parse(await this.check())}catch{connection={code:'GITHUB_SETTINGS'}}
    const code=connection.code==='GITHUB_CONNECTED'?(this.registered?'FEEDBACK_READY':'FEEDBACK_NEW_TURN_REQUIRED'):connection.code;
    return {code,submitAvailable:this.registered,receiptAvailable:this.registered,...(connection.repository?{repository:connection.repository}:{}),message:messages[code]};
  }
  async call(name:string,input:unknown,signal:AbortSignal){this.parse(name,input);signal.throwIfAborted();const result=await this.snapshot();signal.throwIfAborted();return checkedJsonToolResult(name,result,feedbackAvailabilitySchema)}
}
