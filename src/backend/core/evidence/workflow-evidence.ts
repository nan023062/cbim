/**
 * 目录归属：backend/core/evidence；产物与 Workflow 证据规则。
 * Workflow 证据核对原 fallbackBinding；相同模块但不同兜底配置的日志不能互相借用。
 * 范围读取、固定Node和受控写按各自实际read/command/business-write效果核证，不把命令事实等同专业验收。
 * 完整模式核显式原清单、全部冻结范围与同身份JSON记录；历史重算还核采集结束早于交付授权，不退回文件子集。
 * 证据边界：交付只核步骤实际引用的业务证据，提问、取消、原命令报告及模块负责人控制面不能作证；未引用的查询不使整轮失效，真实知识写仍参与副作用时序。
 * 作用定位：核实可选 Workflow 的计划前置、工具回执及精确 必验文件结构出口，供运行时与调度结算共用。
 * 设计原因：工具调用事实必须与固定模块约定、当前运行及最后副作用的真实结束边界一致；并发早读不能替代写入后的验证，不能相信模型自报 pass 或只检查内存状态。
 * 职责边界：仅作确定性记录校验；选定 必验文件的当前字节另由平台端口复核，不执行脚本、不签发权限或宣称覆盖整个模块。
 * 机制边界：对象递归排序由 utility 提供，本模块保留历史比较器、字段省略和业务指纹规则。
 */
import {orderJsonValue} from '../../../core/utility';
import {selectCodeCheck,verifyCodeChecks,type CodeCheckRecord} from './code-check';
import {fail} from '../foundation/errors';
import {hash} from '../foundation/serialization';
import {workflowContractSchema} from '../workspace/workflow-contract';
import type {WorkflowContractBinding} from '../tasks/execution-context';
import type {TaskProgress,WorkflowEvidenceProof} from './progress';
import type {TaskSpec} from '../tasks/types';
import type {ToolReceipt,ToolEffect} from '../tools/types';
import {nativeToolDescriptor} from '../tools/native-tools';
import {questionToolName} from '../tools/questions';
import {commandReportToolName} from '../tasks/command-verification';
import {artifactSucceededCall,type ArtifactEvidenceEvent} from './artifact-evidence';
import {validationRecordSchema,validationToolName,type ValidationRecord,type WorkflowValidationCheck} from './validation';
import {validationRequirement} from './validation-evidence';
import {jsonValidationLimits} from '../workspace/json-validation-schema';
import {completeOutputRequired,outputManifestIdentity} from './complete-output-evidence';
import {outputManifestProofSchema,type OutputManifestProof} from './output-manifest';
import {outputManifestScopeHash} from './output-manifest-evidence';
import {preparedArtifactScopes} from '../workspace/artifact-scope';

export interface WorkflowRunIdentity {workspaceId:string;taskId:string;runId:string}
/** 只能由本轮装配提供；任务要求不可由模型在创建局部计划时扩大或删减。 */
export interface WorkflowProgressContext {bindings:WorkflowContractBinding[];task:Pick<TaskSpec,'goal'|'acceptance'>;identity:WorkflowRunIdentity}
function valid(value:unknown,code:string,message:string):asserts value{if(!value)fail(code,message)}
/** 保留本模块历史键排序与 undefined 规则；utility 只提供递归复制机制。 */
const ordered=(value:unknown):unknown=>orderJsonValue(value,{compareKeys:(a,b)=>a<b?-1:a>b?1:0,omitUndefinedProperties:true});
const same=(a:unknown,b:unknown)=>JSON.stringify(ordered(a))===JSON.stringify(ordered(b));
const hex=(value:unknown)=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
/** 单次操作的分类由真实注册端口提供；本函数不从模型参数猜测副作用。 */
export function workflowHasEffects(effects:readonly ToolEffect[]){return effects.some(effect=>effect==='business-write'||effect==='command')}
function checkedBindings(bindings:readonly WorkflowContractBinding[]){
  valid(bindings.length<=100&&new Set(bindings.map(item=>item.moduleId)).size===bindings.length,'WORKFLOW_CONTEXT_INVALID','Workflow 模块约定数量或归属重复');
  for(const item of bindings)valid(item.moduleId&&item.workflowId&&item.workflowVersion&&workflowContractSchema.safeParse(item.contract).success,'WORKFLOW_CONTEXT_INVALID','冻结的 Workflow 约定无效');
  valid(bindings.reduce((count,item)=>count+(item.contract.delivery?.requiredValidations?.length??0),0)<=jsonValidationLimits.records,'WORKFLOW_CONTEXT_INVALID','一次成员执行最多包含 16 项 产物验证要求');
  return [...bindings].sort((a,b)=>a.moduleId<b.moduleId?-1:a.moduleId>b.moduleId?1:0);
}
/** 执行业务副作用前核对当前计划；没有声明 requirePlan 时不新增该门禁。 */
export function assertWorkflowPlan(bindings:readonly WorkflowContractBinding[],plan:TaskProgress|undefined,task:Pick<TaskSpec,'goal'|'acceptance'>):number|undefined{
  if(!checkedBindings(bindings).some(item=>item.contract.beforeEffects?.requirePlan))return;
  valid(plan&&Number.isSafeInteger(plan.version)&&plan.version>0&&plan.steps.length&&plan.goal===task.goal&&same(plan.acceptance,task.acceptance),'WORKFLOW_PLAN_REQUIRED','本模块 Workflow 要求先保存与本任务目标及验收要求一致的执行计划');
  return plan.version;
}
/** 只评价调用方已核实且实际列入步骤的当前代次回执，不自动挑选未引用的其他工具。 */
export function evaluateWorkflowDelivery(bindings:readonly WorkflowContractBinding[],receipts:readonly ToolReceipt[],identity:WorkflowRunIdentity,validations:readonly ValidationRecord[]=[],manifest?:OutputManifestProof,codeChecks:readonly CodeCheckRecord[]=[]):WorkflowEvidenceProof{
  const values=checkedBindings(bindings),unique=new Map<string,ToolReceipt>();
  for(const receipt of receipts){
    valid(receipt.toolName!==questionToolName,'WORKFLOW_EVIDENCE_INVALID','问题回答与取消只表示交互事实，不能作为 Workflow 交付证据');
    valid(receipt.toolName!==commandReportToolName,'WORKFLOW_EVIDENCE_INVALID','原命令核实只报告控制面事实，不能作为 Workflow 交付证据');
    valid(receipt.workspaceId===identity.workspaceId&&receipt.taskId===identity.taskId&&receipt.runId===identity.runId&&receipt.scope.workspaceId===identity.workspaceId&&receipt.scope.kind!=='repository'&&!receipt.toolName.startsWith('cbim_repository_')&&!receipt.toolName.startsWith('cbim_governance_')&&!receipt.toolName.startsWith('cbim_module_owner_')&&receipt.outcome==='succeeded'&&hex(receipt.inputHash)&&hex(receipt.resultHash),'WORKFLOW_EVIDENCE_INVALID','Workflow 交付回执必须是本任务本轮的真实业务成功结果，外部资料与治理记录不能作交付证据');
    valid(!unique.has(receipt.toolCallId)||same(unique.get(receipt.toolCallId),receipt),'WORKFLOW_EVIDENCE_INVALID','同一工具 ID 的 Workflow 证据不一致');unique.set(receipt.toolCallId,receipt);
  }
  const checks:WorkflowEvidenceProof['checks']=[];
  for(const binding of values)for(const requirement of binding.contract.delivery?.requiredToolEvidence??[]){
    const ids=[...unique.values()].filter(receipt=>receipt.toolName===requirement.toolName&&receipt.scope.kind===(['bash','cbim_scoped_node'].includes(requirement.toolName)?'unknown':'workspace')&&receipt.effects.includes(['bash','cbim_scoped_node'].includes(requirement.toolName)?'command':['write','edit','cbim_file_write_controlled'].includes(requirement.toolName)?'business-write':'read')).map(receipt=>receipt.toolCallId).sort();
    valid(ids.length,'WORKFLOW_EVIDENCE_REQUIRED',`模块 ${binding.moduleId} 的 Workflow 条件 ${requirement.id} 缺少当前步骤引用的 ${requirement.toolName} 成功回执`);
    checks.push({moduleId:binding.moduleId,workflowId:binding.workflowId,workflowVersion:binding.workflowVersion,requirementId:requirement.id,toolName:requirement.toolName,toolCallIds:ids});
  }
  const selected=selectWorkflowValidations(values,receipts,identity,validations),validationChecks:WorkflowValidationCheck[]=selected.map(({result})=>({...result.requirement,validator:result.validator,validationId:result.validationId,toolCallId:result.toolCallId,...(result.manifest?{manifest:structuredClone(result.manifest)}:{baselineId:result.baselineId!}),artifact:structuredClone(result.artifact)}));
  if(completeOutputRequired(values)){
    valid(manifest&&outputManifestProofSchema.safeParse(manifest).success&&same(manifest.scopes,preparedArtifactScopes(values))&&manifest.scopeHash===outputManifestScopeHash(manifest.scopes),'MANIFEST_REQUIRED','完整交付缺少原冻结范围的唯一清单证明');
    valid(selected.every(record=>same(record.result.manifest,outputManifestIdentity(manifest))),'MANIFEST_VALIDATION_MISMATCH','产物验证与交付必须引用同一完整清单，不能混用旧文件基线或其它集合');
  }else valid(!manifest&&selected.every(record=>!record.result.manifest),'MANIFEST_UNDECLARED','本轮未声明完整交付要求，不能补造完整出口证明');
  const codeCheck=selectCodeCheck(values,receipts,identity,codeChecks,manifest);
  return {...(codeCheck?{codeCheck}:{}),version:1,bindingsHash:hash(JSON.stringify(ordered(values))),checks,...(validationChecks.length?{validationChecks}:{}),...(manifest?{manifest:structuredClone(manifest)}:{})};
}
/** 从步骤实际引用中选唯一 passed 记录；rejected 的成功回执只证明执行过检查，不能满足此出口。 */
export function selectWorkflowValidations(bindings:readonly WorkflowContractBinding[],receipts:readonly ToolReceipt[],identity:WorkflowRunIdentity,records:readonly ValidationRecord[]):ValidationRecord[]{
  const selected:ValidationRecord[]=[];
  for(const binding of checkedBindings(bindings))for(const requirement of binding.contract.delivery?.requiredValidations??[]){
    const expected=validationRequirement(bindings,binding.moduleId,requirement.id),matches=records.filter(record=>record.result.requirement.moduleId===binding.moduleId&&record.result.requirement.requirementId===requirement.id&&record.result.outcome==='passed'&&receipts.some(receipt=>receipt.toolCallId===record.result.toolCallId));
    valid(matches.length===1,'WORKFLOW_VALIDATION_REQUIRED',`模块 ${binding.moduleId} 的产物条件 ${requirement.id} 缺少唯一、明确引用的通过记录`);
    const record=matches[0],r=record.result,receipt=receipts.find(value=>value.toolCallId===r.toolCallId)!;
    valid(r.validator===requirement.validator&&validationRecordSchema.safeParse(record).success&&same(receipt,record.receipt)&&receipt.toolName===validationToolName&&receipt.outcome==='succeeded'&&same(receipt.effects,['read'])&&receipt.scope.kind==='workspace'&&receipt.scope.workspaceId===identity.workspaceId&&receipt.workspaceId===identity.workspaceId&&receipt.taskId===identity.taskId&&receipt.runId===identity.runId&&r.binding.workspaceId===identity.workspaceId&&r.binding.taskId===identity.taskId&&r.binding.runId===identity.runId&&same(r.requirement,{moduleId:binding.moduleId,workflowId:binding.workflowId,workflowVersion:binding.workflowVersion,requirementId:requirement.id,schemaHash:expected.schemaHash})&&r.artifact.relativePath===requirement.artifactPath,'WORKFLOW_VALIDATION_INVALID','验证器、调用归属、冻结要求或文件不一致');
    selected.push(record);
  }
  return selected;
}
function progressResult(event:ArtifactEvidenceEvent):TaskProgress{
  const content=(event.data.result as {content?:unknown[]}|undefined)?.content;
  valid(Array.isArray(content)&&content.length===1,'WORKFLOW_LOG_INVALID','任务工具缺少唯一结构化返回');const block=content[0] as {type?:unknown;text?:unknown};valid(block.type==='text'&&typeof block.text==='string','WORKFLOW_LOG_INVALID','任务工具缺少正文');
  try{return JSON.parse(block.text) as TaskProgress}catch{fail('WORKFLOW_LOG_INVALID','任务工具结果无法解析')}
}
/** 失败的副作用也可能已经改过文件；核实结束边界但不将失败回执作为完成证据。 */
function effectFinished(events:readonly ArtifactEvidenceEvent[],identity:WorkflowRunIdentity,allowed:ArtifactEvidenceEvent):ArtifactEvidenceEvent{
  const id=String(allowed.data.id),calls=events.filter(event=>['tool.proposed','tool.allowed','tool.denied','tool.finished'].includes(event.type)&&event.data.id===id),finished=calls.filter(event=>event.type==='tool.finished');
  valid(finished.length===1,'WORKFLOW_EVIDENCE_INVALID','Workflow 副作用缺少唯一的实际结束记录');const end=finished[0],receipt=end.data.receipt as ToolReceipt|undefined;
  if(receipt?.outcome==='succeeded')return artifactSucceededCall(events,identity,id).finished;
  const proposed=calls.filter(event=>event.type==='tool.proposed');
  valid(proposed.length===1&&calls.filter(event=>event.type==='tool.allowed').length===1&&!calls.some(event=>event.type==='tool.denied')&&proposed[0].seq<allowed.seq&&allowed.seq<end.seq,'WORKFLOW_EVIDENCE_INVALID','Workflow 副作用结束链不完整');
  valid(receipt?.version===1&&receipt.outcome==='failed'&&receipt.workspaceId===identity.workspaceId&&receipt.taskId===identity.taskId&&receipt.runId===identity.runId&&receipt.toolCallId===id&&receipt.toolName===allowed.data.name&&end.data.name===allowed.data.name&&proposed[0].data.name===allowed.data.name&&same(proposed[0].data.input,allowed.data.input)&&receipt.inputHash===hash(JSON.stringify(allowed.data.input))&&same(receipt.effects,allowed.data.effects)&&same(receipt.scope,allowed.data.scope)&&end.data.isError===true&&receipt.resultHash===(end.data.result===undefined?undefined:hash(JSON.stringify(end.data.result))),'WORKFLOW_EVIDENCE_INVALID','Workflow 副作用必须有完整的已确认终态，未知或损坏记录不能用于交付');
  return end;
}
/**
 * 在成员结算和主目标核验时重算完整 canonical，而非信任 taskProgress 的命中字段。
 * 有约定的新运行必须保留自己的计划和成功交付调用；续执行也须建立本轮计划，旧轮次回执不会继承。
 */
export function validateWorkflowEvidence(events:readonly ArtifactEvidenceEvent[],task:Pick<TaskSpec,'workspaceId'|'taskId'|'goal'|'acceptance'|'ownerBinding'|'fallbackBinding'>,bindings:readonly WorkflowContractBinding[],validations:readonly ValidationRecord[]=[],manifest?:OutputManifestProof):WorkflowEvidenceProof|undefined{
  if(!bindings.length)return;checkedBindings(bindings);
  const first=events[0],last=events.at(-1),identity={workspaceId:task.workspaceId,taskId:task.taskId,runId:first?.runId};
  valid(first?.type==='run.started'&&first.runId&&same(first.data.workflowContracts,bindings)&&last?.type==='run.settled'&&last.data.status==='completed','WORKFLOW_LOG_INVALID','Workflow 运行缺少完整来源、冻结约定或正常终态');
  valid(events.every((event,index)=>event.seq===index+1&&event.workspaceId===identity.workspaceId&&event.taskId===identity.taskId&&event.runId===identity.runId),'WORKFLOW_LOG_INVALID','Workflow 日志身份或连续顺序不完整');
  const taskData=first.data.task as Partial<TaskSpec>|undefined;valid(taskData?.workspaceId===task.workspaceId&&taskData.taskId===task.taskId&&taskData.goal===task.goal&&same(taskData.acceptance,task.acceptance)&&same(taskData.fallbackBinding,task.fallbackBinding)&&same(taskData.ownerBinding,task.ownerBinding),'WORKFLOW_LOG_INVALID','Workflow 运行来源与真实任务及冻结岗位不一致');
  const candidateEvent=events.filter(event=>event.type==='task.updated').at(-1),candidate=candidateEvent?.data.progress as TaskProgress|undefined;
  valid(candidateEvent&&candidate?.state==='awaiting_review'&&candidate.delivery&&candidate.steps.length&&candidate.goal===task.goal&&same(candidate.acceptance,task.acceptance),'WORKFLOW_LOG_INVALID','Workflow 缺少当前任务的待审阅交付记录');
  const deliveries=events.filter(event=>event.type==='tool.finished'&&event.data.name==='cbim_delivery_prepare'&&event.seq>candidateEvent.seq&&(event.data.receipt as ToolReceipt|undefined)?.outcome==='succeeded'&&same(progressResult(event),candidate));
  valid(deliveries.length===1,'WORKFLOW_LOG_INVALID','Workflow 候选没有唯一的成功交付调用');
  const delivery=artifactSucceededCall(events,identity,String(deliveries[0].data.id)),delivered=progressResult(delivery.finished);
  valid(delivery.allowed.seq<candidateEvent.seq&&same(delivered,candidate)&&Number(delivery.allowed.data.input&&((delivery.allowed.data.input as Record<string,unknown>).expectedVersion))===candidate.version-1,'WORKFLOW_LOG_INVALID','Workflow 交付事件、版本与成功回执不一致');
  const manifestId=(delivery.allowed.data.input as Record<string,unknown>).manifestId;
  valid(manifest?manifestId===manifest.manifestId&&manifest.finishedSeq<delivery.allowed.seq&&manifest.progressVersion<candidate.version:manifestId===undefined,'MANIFEST_IDENTITY','交付参数、采集顺序或原完整清单不一致');
  const planCalls=events.filter(event=>event.type==='tool.finished'&&event.data.name==='cbim_task_plan'&&(event.data.receipt as ToolReceipt|undefined)?.outcome==='succeeded').map(event=>{
    const call=artifactSucceededCall(events,identity,String(event.data.id)),progress=progressResult(call.finished);
    const saved=events.filter(item=>item.type==='task.updated'&&item.seq>call.allowed.seq&&item.seq<call.finished.seq&&same(item.data.progress,progress));
    valid(saved.length===1,'WORKFLOW_LOG_INVALID','Workflow 计划缺少匹配的持久化记录');return {...call,progress,savedSeq:saved[0].seq};
  });
  const plan=planCalls.filter(call=>call.savedSeq<candidateEvent.seq).at(-1);valid(plan&&plan.progress.goal===task.goal&&same(plan.progress.acceptance,task.acceptance),'WORKFLOW_PLAN_REQUIRED','Workflow 交付必须使用本轮已保存的原目标计划');
  const allowed=events.filter(event=>event.type==='tool.allowed');
  for(const event of allowed){
    const effects=event.data.effects,scope=event.data.scope as {kind?:unknown;workspaceId?:unknown}|undefined,native=nativeToolDescriptor(String(event.data.name));
    valid(Array.isArray(effects)&&effects.length&&effects.every(effect=>['read','preview','maintenance','business-write','knowledge-write','command'].includes(String(effect)))&&scope?.workspaceId===identity.workspaceId&&scope.kind===(effects.includes('command')?'unknown':effects.includes('knowledge-write')?'knowledge':'workspace'),'WORKFLOW_LOG_INVALID','Workflow 操作缺少可信副作用分类或范围身份');
    valid(!native||same(effects,native.effects),'WORKFLOW_LOG_INVALID','原生工具与真实注册的副作用分类不一致');
  }
  const effects=allowed.filter(event=>(event.data.effects as ToolEffect[]).some(effect=>['business-write','knowledge-write','command'].includes(effect)));
  if(bindings.some(binding=>binding.contract.beforeEffects?.requirePlan))for(const effect of effects.filter(event=>workflowHasEffects(event.data.effects as ToolEffect[]))){const before=planCalls.filter(call=>call.savedSeq<effect.seq).at(-1);valid(before&&before.progress.goal===task.goal&&same(before.progress.acceptance,task.acceptance),'WORKFLOW_PLAN_REQUIRED','Workflow 发现计划之前或错误目标下的业务操作')}
  const effectEnds=effects.map(effect=>({allowed:effect,finished:effectFinished(events,identity,effect)})),lastEffect=effects.at(-1)?.seq??0,lastEffectEnd=Math.max(0,...effectEnds.map(effect=>effect.finished.seq));
  valid(lastEffectEnd<delivery.allowed.seq,'WORKFLOW_EVIDENCE_INVALID','交付时仍有未结束或后续副作用，原 Workflow 证据已失效');
  valid(candidate.steps.every(step=>step.state==='reported_done'&&step.evidence.length),'WORKFLOW_EVIDENCE_INVALID','Workflow 交付仍有未完成或无证据步骤');
  const ids=[...new Set(candidate.steps.flatMap(step=>step.evidence))],receipts=ids.map(id=>{
    const call=artifactSucceededCall(events,identity,id),ownEffect=effectEnds.some(effect=>effect.allowed.data.id===id);valid(call.allowed.seq>plan.savedSeq&&call.allowed.seq>=lastEffect&&call.finished.seq<delivery.allowed.seq&&(ownEffect||call.allowed.seq>lastEffectEnd),'WORKFLOW_EVIDENCE_INVALID','Workflow 证据必须在当前计划内，读取验证不得与尚未结束的副作用重叠');return call.receipt;
  });
  const proof=evaluateWorkflowDelivery(bindings,receipts,identity,validations,manifest,verifyCodeChecks(events,bindings,identity));valid(same(proof,candidate.delivery.workflow),'WORKFLOW_EVIDENCE_INVALID','Workflow 交付条件与真实日志重算结果不一致');return proof;
}
