/**
 * 作用定位：代码检查的可信事实、摘要和交付证明，连接冻结 Workflow 与原始运行日志。
 * 设计原因：成功工具回执只说明已检查；必须重算每项结果、原输入集合和交付 manifest 的同一性。
 * 职责边界：不执行进程、不读文件；当前集合复核由已有完整产物端口负责。
 */
import {z} from 'zod';
import {isDeepStrictEqual} from 'node:util';
import {hash} from '../../../core/platform/node/serialization';
import {fail} from '../../../core/errors';
import {codeCheckLimits,codeTestSummarySchema,type CodeCheckRequirement} from '../../workspace/rules/code-check';
import type {WorkflowContract} from '../../workspace/rules/workflow-contract';
import {preparedArtifactScopes} from '../../workspace/rules/artifact-scope';
import {outputManifestSnapshotSchema,type OutputManifestSnapshot,type OutputManifestProof} from './output-manifest';
import {outputManifestHash} from './output-manifest-evidence';
import {artifactSucceededCall,type ArtifactEvidenceEvent} from './artifact-evidence';
import type {ToolReceipt} from '../../tools/rules/types';

export const codeCheckToolName='cbim_code_check_run';
export const codeCheckInputSchema=z.object({}).strict();
const digest=z.string().regex(/^[a-f0-9]{64}$/);
export type CodeCheckBinding={moduleId:string;workflowId:string;workflowVersion:string;contract:WorkflowContract};
export type FrozenCodeCheck={moduleId:string;workflowId:string;workflowVersion:string;requirement:CodeCheckRequirement};
export function frozenCodeChecks(bindings:readonly CodeCheckBinding[]):FrozenCodeCheck[]{
  return bindings.flatMap(binding=>(binding.contract.delivery?.requiredCodeChecks??[]).map(requirement=>({moduleId:binding.moduleId,workflowId:binding.workflowId,workflowVersion:binding.workflowVersion,requirement})));
}
export function codeRequirementsHash(bindings:readonly CodeCheckBinding[]){return hash(JSON.stringify(frozenCodeChecks(bindings)))}
export const codeCommandResultSchema=z.object({
  moduleId:z.string().min(1),requirementId:z.string().min(1),resolvedProgram:z.string().min(1),
  exitCode:z.number().int().nullable(),signal:z.string().nullable(),durationMs:z.number().nonnegative(),
  failure:z.enum(['spawn','timeout','output_limit','exit','summary']).optional(),
  outputHash:digest,stdoutTail:z.string().max(codeCheckLimits.tailBytes),stderrTail:z.string().max(codeCheckLimits.tailBytes),
  summary:codeTestSummarySchema.optional(),
}).strict();
export type CodeCommandResult=z.infer<typeof codeCommandResultSchema>;
export const codeCheckExecutionSchema=z.object({snapshot:outputManifestSnapshotSchema,sourceChanged:z.boolean(),commands:z.array(codeCommandResultSchema).min(1).max(codeCheckLimits.checks)}).strict();
export type CodeCheckExecution=z.infer<typeof codeCheckExecutionSchema>;
const identity=z.object({workspaceId:z.string().min(1),taskId:z.string().min(1),runId:z.string().min(1)}).strict();
export type CodeCheckIdentity=z.infer<typeof identity>;
export const codeCheckRecordSchema=codeCheckExecutionSchema.extend({
  version:z.literal(1),identity,toolCallId:z.string().min(1).max(128),knowledgeRevision:z.string().min(1),
  requirementsHash:digest,snapshotHash:digest,checkedAt:z.string().datetime(),outcome:z.enum(['passed','rejected']),
}).strict();
export type CodeCheckRecord=z.infer<typeof codeCheckRecordSchema>;
export const codeCheckProofSchema=z.object({toolCallId:z.string().min(1).max(128),requirementsHash:digest,snapshotHash:digest}).strict();
export type CodeCheckProof=z.infer<typeof codeCheckProofSchema>;
export function codeCheckPassed(checks:readonly FrozenCodeCheck[],execution:CodeCheckExecution):boolean{
  return !execution.sourceChanged&&execution.commands.length===checks.length&&checks.every((check,index)=>{
    const value=execution.commands[index],rule=check.requirement;
    return value.moduleId===check.moduleId&&value.requirementId===rule.id&&!value.failure&&value.exitCode===0&&value.signal===null&&
      (rule.success.kind==='exit-code'?value.summary===undefined:!!value.summary&&value.summary.failed===0&&value.summary.passed>=rule.success.minPassed);
  });
}
/** 给模型返回有界诊断和集合摘要，不把全部源码目录条目再次塞进上下文。 */
export function codeCheckOutput(record:CodeCheckRecord){const {snapshot,...result}=record;return {...result,entryCount:snapshot.entries.length}}
function valid(value:unknown,message:string):asserts value{if(!value)fail('CODE_CHECK_EVIDENCE',message)}
/** 只有可信事件与真实成功工具回执、回包完全对应时才形成检查事实；rejected 仍保留。 */
export function verifyCodeChecks(events:readonly ArtifactEvidenceEvent[],bindings:readonly CodeCheckBinding[],owner:CodeCheckIdentity):CodeCheckRecord[]{
  const checks=frozenCodeChecks(bindings),records:CodeCheckRecord[]=[],seen=new Set<string>();
  for(const event of events.filter(event=>event.type==='code.validation_checked')){
    const record=codeCheckRecordSchema.parse(event.data.codeCheck);
    valid(isDeepStrictEqual(record.identity,owner)&&event.workspaceId===owner.workspaceId&&event.taskId===owner.taskId&&event.runId===owner.runId&&!seen.has(record.toolCallId),'代码检查来源或调用重复');seen.add(record.toolCallId);
    const end=events.find(item=>item.type==='tool.finished'&&item.data.id===record.toolCallId);
    if(!end||(end.data.receipt as ToolReceipt|undefined)?.outcome!=='succeeded')continue;
    const call=artifactSucceededCall(events,owner,record.toolCallId);
    valid(call.receipt.toolName===codeCheckToolName&&isDeepStrictEqual(call.receipt.effects,['command'])&&call.receipt.scope.kind==='unknown'&&codeCheckInputSchema.safeParse(call.allowed.data.input).success,'代码检查缺少真实命令授权');
    valid(call.allowed.seq<event.seq&&event.seq<call.finished.seq&&!events.some(item=>item.seq>call.allowed.seq&&item.seq<call.finished.seq&&['tool.allowed','task.updated','run.stop_requested','run.interrupted'].includes(item.type)),'代码检查期间发生并发操作、计划变化或停止');
    valid(!events.some(item=>item.type==='tool.allowed'&&item.seq<call.allowed.seq&&!events.some(end=>end.type==='tool.finished'&&end.data.id===item.data.id&&end.seq>item.seq&&end.seq<call.allowed.seq)),'代码检查前仍有未结算工具');
    valid(record.requirementsHash===codeRequirementsHash(bindings)&&isDeepStrictEqual(record.snapshot.scopes,preparedArtifactScopes(bindings))&&record.snapshotHash===outputManifestHash(record.snapshot),'检查命令或源码集合与冻结要求不符');
    valid(record.outcome===(codeCheckPassed(checks,record)?'passed':'rejected'),'检查结论不能由成功工具回执代替');
    const content=(call.finished.data.result as {content?:{type:string;text:string}[]})?.content;
    valid(content?.length===1&&content[0].type==='text','代码检查缺少唯一回包');
    valid(isDeepStrictEqual(JSON.parse(content[0].text),codeCheckOutput(record)),'代码检查原事件与回包不符');
    records.push(record);
  }
  for(const end of events.filter(event=>event.type==='tool.finished'&&event.data.name===codeCheckToolName&&(event.data.receipt as ToolReceipt|undefined)?.outcome==='succeeded'))valid(records.some(record=>record.toolCallId===end.data.id),'成功代码检查缺少可信事件');
  return records;
}
/** 代码检查后的完整清单必须具有相同集合指纹；新增文件、缺失文件及源码变更均不能沿用旧证明。 */
export function selectCodeCheck(bindings:readonly CodeCheckBinding[],receipts:readonly ToolReceipt[],owner:CodeCheckIdentity,records:readonly CodeCheckRecord[],manifest?:OutputManifestProof):CodeCheckProof|undefined{
  if(!frozenCodeChecks(bindings).length)return;
  const selected=records.filter(record=>receipts.some(receipt=>receipt.toolCallId===record.toolCallId&&receipt.toolName===codeCheckToolName&&receipt.outcome==='succeeded'&&isDeepStrictEqual(receipt.effects,['command'])&&receipt.scope.kind==='unknown'&&receipt.workspaceId===owner.workspaceId&&receipt.taskId===owner.taskId&&receipt.runId===owner.runId));
  valid(selected.length===1,'交付必须明确引用唯一的一组代码检查');
  const record=selected[0];
  valid(isDeepStrictEqual(record.identity,owner)&&record.requirementsHash===codeRequirementsHash(bindings)&&record.outcome==='passed'&&codeCheckPassed(frozenCodeChecks(bindings),record),'代码检查未通过或不属于当前任务');
  valid(manifest&&record.knowledgeRevision===manifest.knowledgeRevision&&record.snapshotHash===manifest.manifestHash&&record.snapshotHash===outputManifestHash(record.snapshot),'源码集合与通过检查时不同，请重新检查');
  return {toolCallId:record.toolCallId,requirementsHash:record.requirementsHash,snapshotHash:record.snapshotHash};
}
/** 平台执行拥有进程和快照；Core 只接受冻结命令与已登记工作区的真实结果。 */
export interface CodeCheckPort {run(checks:readonly FrozenCodeCheck[],scopes:OutputManifestSnapshot['scopes'],signal:AbortSignal):Promise<CodeCheckExecution>}
