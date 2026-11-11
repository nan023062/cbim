/**
 * 未知提交附统一回执入口和可信 commandId，供模型只读核实，不换命令重做。
 * 作用定位：把本轮真实主运行的模块责任端口转换为发现、分类和执行一致的四工具。
 * 设计原因：先严格核原参数，再独立冻结核验依据；一次领域执行和一次 JSON wire，坏输出保留原命令，不自动重复提交。
 * 职责边界：责任是控制面登记，写入仍需知识治理权限；不是业务产物、派发或人工批准。
 */
import {z} from 'zod';
import {withToolReconciliation} from '../../core/tools/outcome';
import {isDeepStrictEqual} from 'node:util';
import {zodToJsonSchema} from 'zod-to-json-schema';
import {fail,Fault} from '../../core/foundation/errors';
import {checkedJsonToolResult} from '../../core/tools/results';
import type {RunToolDescriptor} from '../../core/policy/tool-policy';
import {moduleOwnershipMainCommandId} from '../../core/workspace/module-ownership-rules';
import {isModuleOwnershipSourceAdoption} from '../../core/workspace/module-ownership';
import {moduleOwnershipToolEffects,isModuleOwnershipToolName,type ModuleOwnershipToolName} from '../../core/workspace/module-ownership-tool-policy';
import {
  moduleOwnerInspectInputSchema,moduleOwnerPreviewInputSchema,moduleOwnerCommitInputSchema,moduleOwnerReceiptInputSchema,
  moduleOwnerInspectOutputSchema,moduleOwnerPreviewOutputSchema,moduleOwnerRecordedOutputSchema,moduleOwnerReceiptOutputSchema,
  moduleOwnerToolOutputLimit,type ModuleOwnerRunBinding,type ModuleOwnershipToolsPort,
} from '../../core/workspace/module-ownership-tools';

const inputs={cbim_module_owner_inspect:moduleOwnerInspectInputSchema,cbim_module_owner_change_preview:moduleOwnerPreviewInputSchema,cbim_module_owner_change_commit:moduleOwnerCommitInputSchema,cbim_module_owner_receipt:moduleOwnerReceiptInputSchema};
const outputs={cbim_module_owner_inspect:moduleOwnerInspectOutputSchema,cbim_module_owner_change_preview:moduleOwnerPreviewOutputSchema,cbim_module_owner_change_commit:moduleOwnerRecordedOutputSchema,cbim_module_owner_receipt:moduleOwnerReceiptOutputSchema};
const descriptions={
  cbim_module_owner_inspect:'用members:true分页发现岗位摘要；用moduleIds查询真实责任与execution.groups中的岗位执行选择或具体缺口；不同负责人须拆任务。自动解析显式和最近父级责任；都未配置时，主模型读取模块内容和团队能力后可传 matches:{knowledgeRevision,choices:[{moduleId,memberId,reason}]}，无匹配 memberId:null。匹配只影响新计划，不写责任登记；无跨版本缓存。selection是当前预期，业务goal和dispatch必须原样引用，实际领取仍重核。用memberId可反查责任；不发能力正文/凭据，不保证供应商可用。',
  cbim_module_owner_change_preview:'只读预览单模块设置、换人、解除责任或用 kind=adopt_source 明确采纳当前来源代次。adopt_source 保留原负责人且不传 nextOwner；先查询实际模块与岗位。预览不提交或改派旧任务，正式执行另经计划、岗位和领取门禁。',
  cbim_module_owner_change_commit:'按原 change 和预览依据提交一次责任变更，使用本轮知识写权限及真实审批。仅登记负责人，不改知识正文、不切换派发或执行模型；结果未知只查错误中的原 commandId，不能再次提交。',
  cbim_module_owner_receipt:'只读查询同一根会话主工具原 commandId 的不可变回执。可查旧周期；unknown不表示未受理，不由当前关系相同推断原命令成功，不重放提交。',
};

/** 必须每个实际主 run 独立构造；不进入工作区共享的知识工具缓存。 */
export class ModuleOwnershipTools {
  private readonly binding:Readonly<ModuleOwnerRunBinding>;
  constructor(private readonly port:ModuleOwnershipToolsPort,binding:ModuleOwnerRunBinding){this.binding=Object.freeze({...binding})}
  has(name:string):name is ModuleOwnershipToolName{return isModuleOwnershipToolName(name)}
  list(){return (Object.keys(inputs) as ModuleOwnershipToolName[]).map(name=>({name,description:descriptions[name],version:1,effects:[moduleOwnershipToolEffects[name]],inputSchema:zodToJsonSchema(inputs[name]) as Record<string,unknown>,outputSchema:zodToJsonSchema(outputs[name]) as Record<string,unknown>,cancellation:{mode:'preflight_only' as const,description:'执行前与异步来源读取后复核停止；保存开始后不承诺中断或回滚。'},recovery:name==='cbim_module_owner_change_commit'?{mode:'inspect_before_retry' as const,queryTool:'cbim_module_owner_receipt',keyFields:['commandId'],description:'未确认结果只查询错误保留的原 commandId；不要换调用 ID 或重新提交。'}:name==='cbim_module_owner_change_preview'?{mode:'new_preview' as const,description:'可显式重新预览当前事实；新依据不证明原未知提交未发生。'}:{mode:'read_again' as const,description:'显式只读查询真实记录，不启动运行或重放写入。'}}))}
  private parse<S extends z.ZodTypeAny>(schema:S,raw:unknown):z.output<S>{const result=schema.safeParse(raw);if(!result.success)fail('OWNERSHIP_INPUT','负责人工具只接受业务选择与预览依据，不接收身份、命令、actor或权限');return result.data}
  describe(name:string,input:unknown):RunToolDescriptor{
    if(!this.has(name))fail('OWNERSHIP_TOOL_UNKNOWN','本轮未注册该负责人工具');this.parse(inputs[name],input);
    return {effects:[moduleOwnershipToolEffects[name]],native:false,scope:{kind:'knowledge',workspaceId:this.binding.workspaceId}};
  }
  /** 领域端口拿独立参数副本，避免返回值或端口变异同时修改预期依据。 */
  async call(name:string,raw:unknown,signal:AbortSignal,toolCallId?:string){
    if(!this.has(name))fail('OWNERSHIP_TOOL_UNKNOWN','本轮未注册该负责人工具');signal.throwIfAborted();
    let commandId:string|undefined;
    const bound=(value:{identity:{workspaceId:string;rootSessionId:string}})=>value.identity.workspaceId===this.binding.workspaceId&&value.identity.rootSessionId===this.binding.rootSessionId;
    try{
      let output:unknown,schema:z.ZodTypeAny;
      if(name==='cbim_module_owner_inspect'){
        const expected=this.parse(moduleOwnerInspectInputSchema,raw);output=await this.port.inspect(structuredClone(expected),signal);
        schema=moduleOwnerInspectOutputSchema.refine(value=>{
          if(!bound(value)||!isDeepStrictEqual(value.selection,expected))return false;
          if('members' in expected)return 'memberPage' in value&&value.memberPage.identity.workspaceId===this.binding.workspaceId&&value.memberPage.identity.instanceId===this.binding.instanceId&&value.memberPage.offset===(expected.offset??0)&&value.memberPage.items.length<=(expected.limit??20)&&(!expected.expectedRegistryCursor||isDeepStrictEqual(value.memberPage.registryCursor,expected.expectedRegistryCursor));
          if(!('page' in value)||value.page.identity.workspaceId!==this.binding.workspaceId||value.page.identity.instanceId!==this.binding.instanceId)return false;
          return 'moduleIds' in expected?'execution' in value&&value.execution.workspaceId===this.binding.workspaceId&&value.execution.instanceId===this.binding.instanceId&&isDeepStrictEqual(value.execution.moduleIds,expected.moduleIds)&&value.page.total===expected.moduleIds.length&&value.page.offset===0&&isDeepStrictEqual(value.page.items.map(item=>item.moduleId),expected.moduleIds):value.page.offset===(expected.offset??0)&&value.page.items.length<=(expected.limit??20)&&value.page.items.every(item=>item.binding?.ownerMemberId===expected.memberId)&&(!expected.expectedReadBasis||isDeepStrictEqual(value.page.basis,expected.expectedReadBasis));
        });
      }else if(name==='cbim_module_owner_change_preview'){
        const expected=this.parse(moduleOwnerPreviewInputSchema,raw);output=await this.port.preview(structuredClone(expected),signal);
        schema=moduleOwnerPreviewOutputSchema.refine(value=>bound(value)&&value.preview.identity.workspaceId===this.binding.workspaceId&&value.preview.identity.instanceId===this.binding.instanceId&&isDeepStrictEqual(value.preview.change,expected.change));
      }else if(name==='cbim_module_owner_change_commit'){
        const expected=this.parse(moduleOwnerCommitInputSchema,raw);if(!toolCallId)fail('OWNERSHIP_ACTOR','责任提交缺少真实工具调用身份');
        const {workspaceId,instanceId:_,...identity}=this.binding,actor={kind:'main_agent' as const,...identity,toolCallId,toolName:name};
        commandId=moduleOwnershipMainCommandId(workspaceId,actor);output=await this.port.commit(structuredClone(expected),toolCallId,signal);
        schema=moduleOwnerRecordedOutputSchema.refine(value=>bound(value)&&value.commandId===commandId&&value.receipt.commandId===commandId&&value.receipt.identity.workspaceId===workspaceId&&value.receipt.identity.instanceId===this.binding.instanceId&&isDeepStrictEqual(value.receipt.actor,actor)&&value.receipt.moduleId===expected.change.moduleId&&value.receipt.action===(isModuleOwnershipSourceAdoption(expected.change)?'adopt_source':!expected.change.nextOwner?'unassign':!expected.change.expectedBinding?.ownerMemberId?'assign':'replace')&&value.receipt.ownerMemberId===(isModuleOwnershipSourceAdoption(expected.change)?expected.change.expectedBinding!.ownerMemberId:expected.change.nextOwner?.memberId??null)&&value.receipt.previousOwnerMemberId===(expected.change.expectedBinding?.ownerMemberId??null)&&value.receipt.previousRevision===(expected.change.expectedBinding?.revision??0)&&(!expected.change.expectedBinding||value.receipt.bindingId===expected.change.expectedBinding.bindingId)&&value.receipt.basis===expected.expectedBasis&&value.receipt.ownershipCursor.seq===(expected.expectedOwnershipCursor?.seq??0)+1&&(!expected.expectedOwnershipCursor||value.receipt.ownershipCursor.streamId===expected.expectedOwnershipCursor.streamId));
      }else{
        const expected=this.parse(moduleOwnerReceiptInputSchema,raw);output=await this.port.receipt(structuredClone(expected),signal);
        schema=moduleOwnerReceiptOutputSchema.refine(value=>bound(value)&&value.commandId===expected.commandId&&(value.status==='unknown'||value.receipt.commandId===expected.commandId&&value.receipt.identity.workspaceId===this.binding.workspaceId&&value.receipt.actor.kind==='main_agent'&&value.receipt.actor.rootSessionId===this.binding.rootSessionId));
      }
      signal.throwIfAborted();const result=checkedJsonToolResult(name,output,schema);
      if(Buffer.byteLength(result.content[0].text,'utf8')>moduleOwnerToolOutputLimit)fail('TOOL_OUTPUT_INVALID','责任工具输出超过128KiB，未发送正文，请核实原记录');return result;
    }catch(error){if(commandId)throw withToolReconciliation(new Fault(error instanceof Fault?error.code:'OWNERSHIP_UNKNOWN',`责任提交结果未能交付；原 commandId=${commandId}。操作可能已经保存，请只查询原回执，不自动重试。`),{tool:'cbim_receipt_inspect',args:{target:'owner',input:{commandId}}});throw error}
  }
}
