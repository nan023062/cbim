/**
 * 目录归属：backend/core/evidence；产物与 Workflow 证据规则。
 * 完整模式从验证调用之前的原canonical清单派生文件事实与集合身份；旧baseline与完整manifest互斥，任何模式降级均拒绝。
 * 作用定位：从可信冻结 Workflow 与本轮日志核实 JSON/CSV/PNG 验证事实，供 Runtime、交付和主目标复核共同使用。
 * 设计原因：结果正文和 succeeded 回执都不能单独声明通过；要求、基线、真实调用、文件字节指纹及事件顺序必须一致。
 * 职责边界：不读文件，不判断当前字节；外层完整 canonical 身份/终态与异步文件重核仍不可省略。
 */
import {fail} from '../foundation/errors';
import {hash} from '../foundation/serialization';
import {workflowContractSchema,type WorkflowContract} from '../workspace/workflow-contract';
import {jsonValidationLimits} from '../workspace/json-validation-schema';
import {artifactSucceededCall,verifyArtifactBaselines,type ArtifactEvidenceEvent} from './artifact-evidence';
import {preparedArtifactScopes} from '../workspace/artifact-scope';
import {verifyOutputManifests} from './output-manifest-evidence';
import {completeOutputRequired,selectCompleteOutput,outputManifestIdentity} from './complete-output-evidence';
import type {ArtifactFileFact} from './artifact-baseline';
import {validationInputSchema,validationOutputSchema,validationResultSchema,validationRecordSchema,validationToolName,type ValidationBinding,type ValidationRecord} from './validation';
export interface ValidationWorkflowBinding {moduleId:string;workflowId:string;workflowVersion:string;contract:WorkflowContract}
function valid(value:unknown,message:string):asserts value{if(!value)fail('VALIDATION_EVIDENCE_INVALID',message)}
const ordered=(value:unknown):unknown=>Array.isArray(value)?value.map(ordered):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).filter(([,item])=>item!==undefined).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([key,item])=>[key,ordered(item)])):value;
const same=(a:unknown,b:unknown)=>JSON.stringify(ordered(a))===JSON.stringify(ordered(b));
const effect=(event:ArtifactEvidenceEvent)=>event.type==='tool.allowed'&&Array.isArray(event.data.effects)&&event.data.effects.some(value=>['business-write','knowledge-write','command'].includes(String(value)));
/** 模型只引用 module/condition ID；旧 JSON 哈希不变，CSV/PNG 将类型与参数共同签入，避免跨验证器解释旧证明。 */
export function validationRequirement(bindings:readonly ValidationWorkflowBinding[],moduleId:string,requirementId:string){
  const matches=bindings.filter(value=>value.moduleId===moduleId);valid(matches.length===1&&workflowContractSchema.safeParse(matches[0].contract).success,'不存在唯一有效的冻结验证模块');
  const binding=matches[0],requirements=binding.contract.delivery?.requiredValidations?.filter(value=>value.id===requirementId)??[];
  valid(requirements.length===1,'不存在唯一的冻结产物验证要求');const requirement=requirements[0];
  return {binding,requirement,schemaHash:hash(JSON.stringify(ordered(requirement.validator==='json-schema-v1'?requirement.schema:{validator:requirement.validator,schema:requirement.schema})))};
}
/** 运行中可省略无关消息，但顺序/身份仍严格；未结束或明确失败的暂存不成为记录，成功却缺事件则拒绝。 */
export function verifyValidationRecords(events:readonly ArtifactEvidenceEvent[],binding:ValidationBinding,knowledgeRevision:string,bindings:readonly ValidationWorkflowBinding[],normalizePath:(raw:string)=>string):ValidationRecord[]{
  let seq=0;for(const event of events){valid(Number.isSafeInteger(event.seq)&&event.seq>seq&&event.workspaceId===binding.workspaceId&&event.taskId===binding.taskId&&event.runId===binding.runId&&!!event.data&&typeof event.data==='object'&&!Array.isArray(event.data),'验证事件顺序或运行身份不一致');seq=event.seq;if(event.type==='run.started')valid(same(event.data.memberBinding,binding)&&!event.data.conversationBinding,'验证来源不是当前正式成员')}
  const records:ValidationRecord[]=[],seen=new Set<string>(),seenCalls=new Set<string>();
  for(const event of events.filter(value=>value.type==='validation.checked')){
    const raw=event.data.validation,parsed=validationResultSchema.safeParse(raw);valid(parsed.success&&same(parsed.data,raw),'验证事件结构无效或发生隐式改写');const result=parsed.data;
    valid(!seen.has(result.validationId)&&!seenCalls.has(result.toolCallId),'验证记录或调用身份重复');seen.add(result.validationId);seenCalls.add(result.toolCallId);
    const ends=events.filter(value=>value.type==='tool.finished'&&value.data.id===result.toolCallId);valid(ends.length<=1,'验证调用结束记录重复');
    if(!ends.length||(ends[0].data.receipt as {outcome?:unknown}|undefined)?.outcome!=='succeeded')continue;
    const own=artifactSucceededCall(events,binding,result.toolCallId),input=validationInputSchema.safeParse(own.allowed.data.input);
    valid(input.success&&own.receipt.toolName===validationToolName&&same(own.receipt.effects,['read'])&&own.receipt.scope.kind==='workspace','验证调用参数或可信效果不一致');
    const content=(own.finished.data.result as {content?:unknown[]}|undefined)?.content;valid(Array.isArray(content)&&content.length===1,'验证工具缺少唯一正文');
    const block=content[0] as {type?:unknown;text?:unknown};valid(block?.type==='text'&&typeof block.text==='string','验证工具缺少结构化文本');
    let body:unknown;try{body=JSON.parse(block.text)}catch{valid(false,'验证正文不是有效 JSON')}
    const output=validationOutputSchema.safeParse(body);valid(output.success&&same(output.data,body)&&same(output.data.validation,result),'验证事件与原回包不一致');
    const selected=validationRequirement(bindings,input.data.moduleId,input.data.requirementId);
    valid(result.validator===selected.requirement.validator&&same(result.binding,binding)&&result.knowledgeRevision===knowledgeRevision&&same(result.requirement,{moduleId:selected.binding.moduleId,workflowId:selected.binding.workflowId,workflowVersion:selected.binding.workflowVersion,requirementId:selected.requirement.id,schemaHash:selected.schemaHash})&&result.baselineId===input.data.baselineId&&result.manifest?.manifestId===input.data.manifestId&&result.taskProgressVersion===input.data.expectedTaskProgressVersion,'验证记录与原请求、知识或冻结要求不一致');
    const before=events.filter(value=>value.seq<own.allowed.seq);let sourceFiles:ArtifactFileFact[];
    if(completeOutputRequired(bindings)){
      valid(input.data.manifestId&&result.manifest&&!result.baselineId,'完整验证不能回退为选定文件基线');
      const manifest=selectCompleteOutput(verifyOutputManifests(before,binding,knowledgeRevision,preparedArtifactScopes(bindings)),bindings,input.data.manifestId,{...binding,knowledgeRevision,progressVersion:result.taskProgressVersion});
      valid(same(result.manifest,outputManifestIdentity(manifest.manifest)),'验证引用与原完整清单身份不一致');
      sourceFiles=manifest.manifest.snapshot.entries.flatMap(file=>file.kind==='file'?[{relativePath:file.relativePath,byteLength:file.byteLength,sha256:file.sha256}]:[]);
    }else{
      valid(input.data.baselineId&&!result.manifest,'旧文件验证不能补造完整出口');
      const baselines=verifyArtifactBaselines(before,binding,knowledgeRevision,normalizePath),base=baselines.records.find(value=>value.baseline.baselineId===result.baselineId),ref=baselines.refs.find(value=>value.baselineId===result.baselineId);
      valid(base&&ref&&!ref.invalidated&&base.baseline.progressVersion<=result.taskProgressVersion,'验证没有当前有效的同轮文件基线');sourceFiles=base.baseline.files;
    }
    const files=sourceFiles.filter(file=>normalizePath(file.relativePath)===normalizePath(selected.requirement.artifactPath));
    valid(files.length===1&&normalizePath(result.artifact.relativePath)===normalizePath(selected.requirement.artifactPath)&&same(result.artifact,{relativePath:files[0].relativePath,byteLength:files[0].byteLength,sha256:files[0].sha256}),'验证文件与要求和真实基线字节不一致');
    const progress=before.filter(value=>value.type==='task.updated').at(-1)?.data.progress as {version?:unknown}|undefined;
    valid(progress?.version===result.taskProgressVersion&&result.lastEffectSeq===(before.filter(effect).at(-1)?.seq??0),'验证进度或副作用界限不一致');
    valid(own.allowed.seq<event.seq&&event.seq<own.finished.seq,'验证事件不在真实调用中');
    valid(!events.some(value=>value.seq>own.allowed.seq&&value.seq<own.finished.seq&&['run.stop_requested','run.interrupted','tool.allowed','task.updated'].includes(value.type)),'验证期间存在停止、并发工具或计划变化');
    for(const allowed of before.filter(value=>value.type==='tool.allowed'))valid(before.some(value=>value.type==='tool.finished'&&value.data.id===allowed.data.id&&value.seq>allowed.seq),'验证发起时仍有未完成的工具');
    records.push(validationRecordSchema.parse({result,checkedSeq:event.seq,finishedSeq:own.finished.seq,receipt:own.receipt}));
  }
  valid(records.length<=jsonValidationLimits.records,'本轮验证记录超过上限');
  for(const end of events.filter(value=>value.type==='tool.finished'&&value.data.name===validationToolName&&(value.data.receipt as {outcome?:unknown}|undefined)?.outcome==='succeeded'))valid(records.some(record=>record.result.toolCallId===end.data.id),'成功验证调用缺少真实检查事件');
  return records;
}
