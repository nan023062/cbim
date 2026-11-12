import {expect,it} from 'vitest';
import {controlledFileWriteInputSchema,controlledFileWriteOutputSchema,controlledFileReportSchema,fileCompensationInputSchema,fileCompensationReceiptSchema,controlledFileLimits} from '../src/backend/core/file-operations/controlled-file-operation';
import {controlledFileChangeSchema,type ControlledFileChange} from '../src/backend/core/file-operations/controlled-file-event';
import {controlledFileOperation,controlledFileIntentHash,controlledFilePhaseCommand,controlledFilePhaseReceipt,controlledFileWriteApplied,summarizeControlledFileOperation,fileCompensationReceipt,fileCompensationRevision,controlledFileRequestFingerprint} from '../src/backend/core/file-operations/controlled-file-rules';
import {projectControlledFileMutation} from '../src/backend/core/file-operations/controlled-file-invariants';
import {baseState,writeIntent,phases,append,closedState,compensationIntent,fact,mutation} from './controlled-file-core-fixture';

it('输入保持 BOM/CRLF/空正文，拒绝伪来源、越界路径、坏Unicode及独立wire超限',()=>{
  const input={path:'out.json',expectedBefore:fact('old'),content:'\uFEFF新\r\n'};expect(controlledFileWriteInputSchema.parse(input)).toEqual(input);
  expect(controlledFileWriteInputSchema.safeParse({...input,content:''}).success).toBe(true);
  for(const path of ['../out','a/../out','a\\out','C:/out','/out','a//out','file:stream'])expect(controlledFileWriteInputSchema.safeParse({...input,path}).success).toBe(false);
  for(const content of ['\ud800','\udc00','中'.repeat(400000),'\u0000'.repeat(600000)])expect(controlledFileWriteInputSchema.safeParse({...input,content}).success).toBe(false);
  expect(controlledFileWriteInputSchema.safeParse({...input,permission:'execute'}).success).toBe(false);
  const state=baseState();expect(fileCompensationInputSchema.safeParse({...compensationIntent(closedState(phases(writeIntent(state)).reduce(append,state))).request,path:'other'}).success).toBe(false);
});
it('新协议hash经Schema解析和对象键重排保持一致，不改变原对象或原绑定',()=>{
  const intent=writeIntent(),saved=structuredClone(intent),reordered=JSON.parse(JSON.stringify(intent),(_k,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).reverse()):v);
  expect(controlledFileIntentHash(reordered)).toBe(controlledFileIntentHash(intent));expect(controlledFileRequestFingerprint(reordered.origin,reordered.request)).toBe(intent.requestFingerprint);expect(intent).toEqual(saved);
});
it('严格阶段prepared→executing→applied，公共投影不泄before正文/私有blob/owner/平台ID',()=>{
  let state=baseState();const intent=writeIntent(state),events=phases(intent);for(const e of events)state=append(state,e);
  const op=controlledFileOperation(state,intent.operationId)!,output={state:'applied',operation:controlledFileWriteApplied(op)},summary=summarizeControlledFileOperation(op);
  expect(controlledFileWriteOutputSchema.parse(output)).toEqual(output);expect(JSON.stringify(output)).not.toMatch(/blobId|fileIdentity|fileId|ownerBindingHash|workspaceInstanceId|content/);
  const report={version:1,identity:{workspaceId:intent.origin.binding.workspaceId,rootSessionId:'root',taskId:'task',runId:'run',toolCallId:intent.origin.toolCallId},checkedAt:intent.preparedAt,ledger:{state:'recorded',operation:summary,originalExecution:'in_flight',compensationRevision:0,compensations:[]},readOnly:true,acceptance:'not_evaluated'};
  expect(controlledFileReportSchema.safeParse(report).success).toBe(true);expect(controlledFileReportSchema.safeParse({...report,identity:{...report.identity,runId:'foreign'}}).success).toBe(false);
  expect(()=>append(state,events[2])).toThrow(/阶段/);
});
it('拒跳阶段、修改摘要、虚构零写、混合mutation、假receipt和跨调用/来源',()=>{
  const state=baseState(),intent=writeIntent(state),events=phases(intent),prepared=append(state,events[0]);
  expect(()=>append(state,events[1])).toThrow();expect(()=>append(prepared,events[2])).toThrow();
  const bads:ControlledFileChange[]=[{...events[0],intent:{...intent,operationId:'e'.repeat(64)}},...['ownerBindingHash','knowledgeRevision','inputHash'].slice(0,2).map(key=>({...events[0],intent:{...intent,origin:{...intent.origin,[key]:'f'.repeat(64)}}}) as ControlledFileChange),{...events[0],intent:{...intent,before:{...intent.before,sha256:'f'.repeat(64)}}}];
  for(const bad of bads)expect(()=>append(state,bad)).toThrow();
  expect(()=>projectControlledFileMutation(state,{...mutation(events[0]),scopes:[]},controlledFilePhaseCommand(events[0]))).toThrow(/夹|混/);
  expect(()=>projectControlledFileMutation(state,{...mutation(events[0]),receipt:{applied:true}},controlledFilePhaseCommand(events[0]))).toThrow(/回执/);
  expect(controlledFileChangeSchema.safeParse({...events[1],raw:'private'}).success).toBe(false);
  const wrong={...events[2],observedAfter:fact('wrong')} as ControlledFileChange;expect(()=>append(append(prepared,events[1]),wrong)).toThrow(/字节/);
});
it('not_applied仅两条可信未发写路径，unknown不可升格，terminal允许原run已经停止',()=>{
  const state=baseState(),intent=writeIntent(state),[prepared,executing]=phases(intent),first=append(state,prepared),second=append(first,executing),base={version:1 as const,operationId:intent.operationId,recordedAt:intent.preparedAt,intentHash:controlledFileIntentHash(intent)};
  for(const [from,revision,previousRevision] of [[first,2,1],[second,3,2]] as const){const e={...base,phase:'not_applied' as const,revision,previousRevision,reasonCode:'STOPPED',confirmation:'write_not_issued' as const};expect(append(closedState(from),e).controlledFileChanges!.at(-1)).toEqual(e)}
  const unknown:ControlledFileChange={...base,phase:'unknown',revision:3,previousRevision:2,reasonCode:'PARTIAL_WRITE'};const unknownState=append(closedState(second),unknown);
  expect(()=>append(unknownState,phases(intent)[2])).toThrow();expect(()=>controlledFileWriteApplied(controlledFileOperation(unknownState,intent.operationId)!)).toThrow();expect(()=>compensationIntent(unknownState)).toThrow();
  expect(()=>append(closedState(first),executing)).toThrow(/周期/);expect(()=>append(closedState(second),phases(intent)[2])).not.toThrow();
});
it('补偿只引用原applied与原blob，独立CAS和终态，不修改原write，不受后来岗位变化阻断',()=>{
  let state=baseState();const original=writeIntent(state);state=closedState(phases(original).reduce(append,state));const before=structuredClone(state.controlledFileChanges),intent=compensationIntent(state);
  state.workspaceMembers=[];state.moduleOwnerships=[];state.knowledgeSourceGenerations=[];
  for(const e of phases(intent))state=append(state,e);
  const op=controlledFileOperation(state,intent.operationId)!,receipt=fileCompensationReceipt(op);expect(fileCompensationReceiptSchema.parse(receipt)).toEqual(receipt);expect(receipt.before).toEqual(original.request.after);expect(receipt.after).toEqual(original.request.expectedBefore);expect(state.controlledFileChanges!.slice(0,3)).toEqual(before);expect(fileCompensationRevision(state,original.operationId)).toBe(1);
  expect(()=>append(state,phases(compensationIntent(state))[0])).toThrow(/成功或未决/);
});
it('补偿旧basis、换actor/路径/fileID/blob、未关闭来源均拒；明确not_applied后可创建新命令',()=>{
  let state=baseState();const source=writeIntent(state);state=phases(source).reduce(append,state);const closed=closedState(state),intent=compensationIntent(closed);
  expect(()=>append(state,phases(intent)[0])).toThrow(/在途/);
  for(const bad of [{...intent,relativePath:'elsewhere'},{...intent,fileIdentity:{...intent.fileIdentity,fileId:'replacement'}},{...intent,previewBasis:'a'.repeat(64)},{...intent,intendedAfter:{...intent.intendedAfter,blobId:intent.before.blobId}}])expect(()=>append(closed,phases(bad)[0])).toThrow();
  state=append(closed,phases(intent)[0]);state=append(state,{version:1,operationId:intent.operationId,recordedAt:intent.preparedAt,phase:'not_applied',revision:2,previousRevision:1,intentHash:controlledFileIntentHash(intent),reasonCode:'STOPPED',confirmation:'write_not_issued'});
  const next=compensationIntent(state);expect(next.request.expectedCompensationRevision).toBe(1);expect(()=>append(state,phases(next)[0])).not.toThrow();
});
it('旧缺省不补数组，原run第9个意图拒绝，附录预留终态空间且不删除历史',()=>{
  let state=baseState();expect(projectControlledFileMutation(state,{receipt:null},{commandId:'unrelated',fingerprint:'none'})).toEqual({});
  for(let n=0;n<controlledFileLimits.writesPerRun;n++){const i=writeIntent(state,'call-'+n);state=phases(i).reduce(append,state)}
  expect(()=>append(state,phases(writeIntent(state,'ninth'))[0])).toThrow(/上限/);expect(state.controlledFileChanges).toHaveLength(24);
});

it('授权seq和原blob不能转借另一调用，重复补偿尝试保持8次上限',()=>{
  let state=baseState();const original=writeIntent(state);state=phases(original).reduce(append,state);
  const next=writeIntent(state,'other');next.origin.allowedSeq=original.origin.allowedSeq;next.requestFingerprint=controlledFileRequestFingerprint(next.origin,next.request);expect(()=>append(state,phases(next)[0])).toThrow(/授权事件/);
  const reused=writeIntent(state,'reused');reused.before.blobId=original.before.blobId;expect(()=>append(state,phases(reused)[0])).toThrow(/备份引用/);
  state=closedState(state);
  for(let n=0;n<8;n++){const i=compensationIntent(state);state=append(state,phases(i)[0]);state=append(state,{version:1,operationId:i.operationId,recordedAt:i.preparedAt,phase:'not_applied',revision:2,previousRevision:1,intentHash:controlledFileIntentHash(i),reasonCode:'CANCELLED',confirmation:'write_not_issued'})}
  expect(()=>append(state,phases(compensationIntent(state))[0])).toThrow(/上限/);expect(state.controlledFileChanges).toHaveLength(19);
});
