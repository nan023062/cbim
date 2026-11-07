/**
 * 作用定位：在成员交付结算与主目标审阅时重算冻结 Workflow，并复核被验证文件的当前字节。
 * 设计原因：工具成功不等于结构验证通过；canonical 核验、原要求及当前文件共同约束出口。历史返工核实保留原证明，不能因文件已修改而抹掉过去的真实结果。
 * 职责边界：直接调用受限文件端口，不重入派发存储或执行脚本；仅观察选定文件，不签署业务验收或承诺跨文件原子快照。
 */
import {fail} from '../../core/foundation/errors';
import {sameGoalValue} from '../../core/tasks/scope-goal';
import {preparedWorkflowContracts,validatePreparedDispatchKnowledge} from '../../core/tasks/execution-context';
import {validateWorkflowEvidence,selectWorkflowValidations} from '../../core/tasks/workflow-evidence';
import {verifyValidationRecords} from '../../core/tasks/validation-evidence';
import {artifactFileCheckSchema,type ArtifactFileFact,type ArtifactFileCheck} from '../../core/tasks/artifact-baseline';
import type {RunSummary} from '../../core/brain/types';
import type {TaskNode} from '../../core/tasks/graph-types';
import type {DispatchRun} from '../../core/tasks/dispatch-execution';
import {memberPublicTask} from './member-events';

/** 仅可信平台注入，不能调用会重新读取本事务 store 的报告服务。 */
export interface WorkflowFileVerification {
  normalizePath(raw:string):string;
  checkFiles(files:readonly ArtifactFileFact[],signal:AbortSignal):Promise<ArtifactFileCheck[]>;
  signal?:AbortSignal;
}
/** 只核历史原始证明并返回应复核的文件；供明确返工保留过去事实，不作为新交付放行。 */
export function memberWorkflowFiles(task:TaskNode,run:DispatchRun,summary:RunSummary,root:string,normalizePath?:(raw:string)=>string):ArtifactFileFact[]{
  validatePreparedDispatchKnowledge(run.prepared);const bindings=preparedWorkflowContracts(run.prepared);if(!bindings.length)return [];
  const head=summary.events[0],tail=summary.events.at(-1),bounds=summary.events.filter(event=>event.type==='session.bound'),progress=summary.events.filter(event=>event.type==='task.updated').at(-1)?.data.progress;
  if(summary.logIntegrity?.partialTail!==false||summary.status!=='completed'||summary.unresolvedTools.length||summary.runId!==run.binding.runId||summary.conversationBinding||!sameGoalValue(summary.memberBinding,run.binding)||!sameGoalValue(summary.task,memberPublicTask(task,root))||!sameGoalValue(summary.taskProgress,progress)||head?.type!=='run.started'||!sameGoalValue(head.data.task,summary.task)||!sameGoalValue(head.data.memberBinding,run.binding)||!run.session.sessionFile||summary.sessionFile!==run.session.sessionFile||!bounds.length||bounds.some(event=>event.data.sessionId!==run.session.nativeSessionId||event.data.sessionFile!==run.session.sessionFile)||tail?.type!=='run.settled'||tail.data.status!=='completed')fail('WORKFLOW_EVIDENCE_INVALID','Workflow 交付缺少完整的本轮日志、原生通道和可信成员身份');
  const required=bindings.some(binding=>binding.contract.delivery?.requiredValidations?.length);
  if(required&&!normalizePath)fail('WORKFLOW_VALIDATION_UNAVAILABLE','本次未装配验证文件路径核实端口');
  const records=required?verifyValidationRecords(summary.events,run.binding,run.prepared.knowledgeRevision,bindings,normalizePath!):[];
  validateWorkflowEvidence(summary.events,{workspaceId:task.identity.workspaceId,taskId:task.taskId,goal:task.goal,acceptance:task.acceptance.map(item=>item.text)},bindings,records);
  if(!required)return [];
  const ids=new Set(summary.taskProgress!.steps.flatMap(step=>step.evidence));
  const selected=selectWorkflowValidations(bindings,(summary.toolReceipts??[]).filter(receipt=>ids.has(receipt.toolCallId)),{workspaceId:task.identity.workspaceId,taskId:task.taskId,runId:run.binding.runId},records);
  const files=new Map<string,ArtifactFileFact>();
  for(const {result} of selected){const key=normalizePath!(result.artifact.relativePath),old=files.get(key);if(old&&!sameGoalValue(old,result.artifact))fail('WORKFLOW_VALIDATION_STALE','同一文件的验证证明不一致');files.set(key,result.artifact)}
  return [...files.values()];
}

/** 有约定的新运行须有完整 canonical；只读旧无约定不新增 I/O，文件变化/无法核实均拒绝当前候选。 */
export async function validateMemberWorkflow(task:TaskNode,run:DispatchRun,summary:RunSummary,root:string,port?:WorkflowFileVerification):Promise<void>{
  const files=memberWorkflowFiles(task,run,summary,root,port?.normalizePath);if(!files.length)return;
  if(!port)fail('WORKFLOW_VALIDATION_UNAVAILABLE','本次未装配验证文件复核能力');
  const signal=port.signal??new AbortController().signal;signal.throwIfAborted();
  const checks=await port.checkFiles(files,signal);signal.throwIfAborted();
  if(!Array.isArray(checks)||checks.length!==files.length)fail('WORKFLOW_VALIDATION_STALE','验证产物未返回完整文件复核结果');
  for(let index=0;index<files.length;index++){
    const parsed=artifactFileCheckSchema.safeParse(checks[index]),file=files[index],expected={byteLength:file.byteLength,sha256:file.sha256};
    if(!parsed.success||parsed.data.relativePath!==file.relativePath||parsed.data.state!=='matches'||!sameGoalValue(parsed.data.expected,expected)||!sameGoalValue(parsed.data.observed,expected))fail('WORKFLOW_VALIDATION_STALE','验证后的文件已变化、缺失或无法核实，请重新执行验证');
  }
}
