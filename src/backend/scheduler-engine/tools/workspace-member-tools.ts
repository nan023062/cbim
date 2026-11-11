/**
 * 未知提交附统一回执入口和可信 commandId，供模型只读核实，不换命令重做。
 * 作用定位：将主运行岗位端口注册为查询、预览、提交与原回执四项工具。
 * 设计原因：工具分类与调用使用同一严格协议；主写入只执行一次，回包异常保留稳定命令供核实，不能冒充桌面选型。
 */
import {z} from 'zod';
import {withToolReconciliation} from '../../core/tools/outcome';
import {zodToJsonSchema} from 'zod-to-json-schema';
import {isDeepStrictEqual} from 'node:util';
import {fail,Fault} from '../../core/foundation/errors';
import {checkedJsonToolResult} from '../../core/tools/results';
import type {RunToolDescriptor} from '../../core/policy/tool-policy';
import {workspaceMemberMainCommandId} from '../../core/team/workspace-member-rules';
import {memberToolEffects,memberToolInputs,memberToolOutputs,memberToolCommitSchema,memberToolPreviewSchema,memberToolReceiptSchema,type MemberToolName,type MemberToolBinding,type WorkspaceMemberToolsPort} from '../../core/team/workspace-member-tools';

const descriptions:Record<MemberToolName,string>={
 cbim_member_inspect:'查询岗位列表；传 memberId 返回版本、当前/已采纳能力和配置哈希及修复入口。能力失配仍返回差异；不读取凭据、不派工。',
 cbim_member_change_preview:'预览 register/update/state 或 adopt target=capability。登记继承静态 Agent 已配置模型；模型选型/凭据仍需人工。能力变更用此采纳，模块来源变更才用 owner adopt_source。',
 cbim_member_change_commit:'按原 change、basis 和 registryCursor 提交一次岗位变更，经本轮知识写权限。不会改派历史任务或代签验收；结果未知只查原 commandId，不换调用重做。',
 cbim_member_receipt:'只读核实本根会话主工具原 commandId；unknown 不表示未执行，不授权重放。',
};
export class WorkspaceMemberTools {
 constructor(private readonly port:WorkspaceMemberToolsPort,private readonly binding:MemberToolBinding){}
 has(name:string):name is MemberToolName{return Object.hasOwn(memberToolInputs,name)}
 list(){return (Object.keys(memberToolInputs) as MemberToolName[]).map(name=>({name,version:1,description:descriptions[name],effects:[memberToolEffects[name]],inputSchema:zodToJsonSchema(memberToolInputs[name]),outputSchema:zodToJsonSchema(memberToolOutputs[name]),cancellation:{mode:'preflight_only',description:'保存前复核停止，保存后不承诺回滚。'},recovery:name==='cbim_member_change_commit'?{mode:'inspect_before_retry',queryTool:'cbim_member_receipt',keyFields:['commandId'],description:'保留原命令，未知不得自动重放。'}:{mode:'read_again',description:'只读核实当前事实，不启动执行。'}}))}
 describe(name:string,raw:unknown):RunToolDescriptor{
  if(!this.has(name))fail('MEMBER_TOOL_UNKNOWN','本轮未提供此岗位工具');memberToolInputs[name].parse(raw);
  return {effects:[memberToolEffects[name]],native:false,scope:{kind:'knowledge',workspaceId:this.binding.workspaceId}};
 }
 async call(name:string,raw:unknown,signal:AbortSignal,toolCallId?:string){
  if(!this.has(name))fail('MEMBER_TOOL_UNKNOWN','本轮未提供此岗位工具');signal.throwIfAborted();
  const input=memberToolInputs[name].parse(raw);let commandId:string|undefined;
  if(name==='cbim_member_change_commit'){
   if(!toolCallId)fail('MEMBER_ACTOR','岗位提交缺少真实调用身份');
   const {workspaceId,instanceId:_,...source}=this.binding;
   commandId=workspaceMemberMainCommandId(workspaceId,{kind:'main_agent',...source,toolCallId,toolName:name});
  }
  try{
   const output=await this.port.call(name,structuredClone(input),signal,toolCallId);signal.throwIfAborted();
   const base:z.ZodType<z.infer<(typeof memberToolOutputs)[MemberToolName]>>=memberToolOutputs[name];
   const schema=base.refine(value=>{
    if(value.identity.workspaceId!==this.binding.workspaceId||value.identity.instanceId!==this.binding.instanceId)return false;
    if(name==='cbim_member_change_preview')return 'change' in value&&isDeepStrictEqual(value.change,memberToolPreviewSchema.parse(input).change);
    if(name==='cbim_member_change_commit'){
     const expected=memberToolCommitSchema.parse(input);
     return 'status' in value&&value.status==='recorded'&&value.commandId===commandId&&value.receipt.commandId===commandId&&isDeepStrictEqual(value.receipt.identity,value.identity)&&value.receipt.basis===expected.expectedBasis&&value.receipt.action===expected.change.kind&&value.receipt.registryCursor.seq===(expected.expectedRegistryCursor?.seq??0)+1&&(!expected.expectedRegistryCursor||value.receipt.registryCursor.streamId===expected.expectedRegistryCursor.streamId)&&(expected.change.kind==='register'||value.receipt.memberId===expected.change.memberId&&value.receipt.previousRevision===expected.change.expectedRevision);
    }
    if(name==='cbim_member_receipt')return 'commandId' in value&&value.commandId===memberToolReceiptSchema.parse(input).commandId&&(value.status==='unknown'||value.receipt.commandId===value.commandId&&value.receipt.identity.workspaceId===this.binding.workspaceId);
    if('memberId' in input)return 'detail' in value&&value.detail.memberId===input.memberId;
    return 'page' in value&&isDeepStrictEqual(value.page.identity,value.identity)&&value.page.offset===('offset' in input?input.offset??0:0)&&value.page.items.length<=('limit' in input?input.limit??20:20)&&(!('expectedRegistryCursor' in input)||!input.expectedRegistryCursor||isDeepStrictEqual(value.page.registryCursor,input.expectedRegistryCursor));
   });
   const result=checkedJsonToolResult(name,output,schema);
   if(Buffer.byteLength(result.content[0].text,'utf8')>128*1024)fail('TOOL_OUTPUT_INVALID','岗位工具输出过大，请缩小查询范围');return result;
  }catch(error){
   if(commandId)throw withToolReconciliation(new Fault(error instanceof Fault?error.code:'MEMBER_UNKNOWN',`岗位提交结果未能交付；原 commandId=${commandId}。请用 cbim_member_receipt 核实，不能自动重试。`),{tool:'cbim_receipt_inspect',args:{target:'member',input:{commandId}}});
   throw error;
  }
 }
}
