import {expect,it,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {baseState,closedState,writeIntent,phases} from './controlled-file-core-fixture';
import {controlledFileOperation,summarizeControlledFileOperation} from '../src/backend/core/file-operations/controlled-file-rules';
import {controlledFileReportSchema,type ControlledFileReport,type ControlledFilePhase} from '../src/backend/core/file-operations/controlled-file-operation';
import type {DispatchStore} from '../src/backend/core/dispatch/dispatch-storage';
import type {RunSummary,EngineEvent} from '../src/backend/core/execution/types';
import {EffectObservationService} from '../src/backend/scheduler-engine/evidence/effect-observation-service';
import {CommandVerificationService} from '../src/backend/scheduler-engine/evidence/command-verification-service';
import {memberPublicTask} from '../src/backend/scheduler-engine/runtime/member-events';
import {effectObservationReportSchema} from '../src/backend/core/tasks/effect-observation';
import {effectObservationBasis} from '../src/backend/core/tasks/effect-observation-rules';
import {effectReport} from './effect-core-fixture';

function fixture(phase:ControlledFilePhase='applied'){
 const state=closedState(baseState()),run=state.runs![0],b=run.binding,scope=state.scopes![0],intent=writeIntent(state),owner={entry:{id:b.workspaceId,path:'/workspace'},assert:vi.fn()},task=memberPublicTask(state.graphs[0].tasks[0],owner.entry.path);
 const original={path:'output.json',expectedBefore:{byteLength:intent.before.byteLength,sha256:intent.before.sha256},content:'new\r\n'};
 const query={workspaceId:b.workspaceId,rootSessionId:b.rootSessionId,taskId:b.taskId,runId:b.runId,toolCallId:intent.origin.toolCallId},selection={workspaceId:b.workspaceId,rootSessionId:b.rootSessionId,subject:{kind:'member_run' as const,taskId:b.taskId,runId:b.runId,toolCallIds:[query.toolCallId]}};
 const events:EngineEvent[]=[{type:'run.started',data:{task,memberBinding:b}},...(run.session.sessionFile?[{type:'session.bound' as const,data:{sessionId:run.session.nativeSessionId,sessionFile:run.session.sessionFile}}]:[]),{type:'tool.proposed',data:{id:query.toolCallId,name:'cbim_file_write_controlled',input:original}},{type:'tool.allowed',data:{id:query.toolCallId,name:'cbim_file_write_controlled',input:original,effects:['business-write'],scope:{kind:'workspace',workspaceId:b.workspaceId}}},{type:'run.settled',data:{status:'cancelled'}}];
 const summary:RunSummary={task,runId:b.runId,status:'cancelled',acceptance:'not_evaluated',memberBinding:b,sessionFile:run.session.sessionFile,unresolvedTools:[query.toolCallId],logIntegrity:{partialTail:false},events:events.map((e,i)=>({...e,seq:i+1,version:1,time:scope.createdAt,workspaceId:b.workspaceId,taskId:b.taskId,runId:b.runId}))};
 const op=summarizeControlledFileOperation(controlledFileOperation({controlledFileChanges:phases(intent)},intent.operationId)!);op.phase=phase;op.revision=phase==='prepared'?1:phase==='executing'?2:3;
 const report:ControlledFileReport={version:1,identity:query,checkedAt:new Date().toISOString(),ledger:{state:'recorded',operation:op,originalExecution:'settled',compensationRevision:0,compensations:[]},readOnly:true,acceptance:'not_evaluated'};
 const observeControlled=vi.fn(async(_input:typeof query,_signal?:AbortSignal)=>({...structuredClone(report),checkedAt:new Date().toISOString()})),observeFiles=vi.fn(),acquireRead=vi.fn(),transact=vi.fn(),store={read:async()=>structuredClone(state),commandReceipt:vi.fn(),transact} as unknown as DispatchStore;
 const inspectMember=vi.fn(async()=>structuredClone(summary)),service=new EffectObservationService(owner,store,{} as CommandVerificationService,{inspectMember,normalizePath:v=>v,observeFiles,acquireRead,observeControlled});
 return {state,summary,query,selection,report,service,observeControlled,observeFiles,acquireRead,transact,inspectMember};
}
it.each(['prepared','executing','applied','not_applied','unknown'] as const)('原 %s 阶段保留，时钟不变依据，无文件读取或写入',async phase=>{
 const f=fixture(phase),before=structuredClone(f.summary),result=await f.service.observe(f.selection);
 expect(result.source.state).toBe('verified');expect(result.calls[0]).toMatchObject({outcome:'unknown',coverage:'controlled_file',controlled:{state:'recorded',operation:{phase}}});expect(f.observeControlled).toHaveBeenCalledTimes(2);expect(f.observeControlled.mock.calls[0][0]).toEqual(f.query);expect(f.observeFiles).not.toHaveBeenCalled();expect(f.acquireRead).not.toHaveBeenCalled();expect(f.transact).not.toHaveBeenCalled();expect(f.summary).toEqual(before);expect(result.consistency).toBe('stable');expect(effectObservationBasis(effectObservationReportSchema.parse(result))).toBe(result.basis);expect((await f.service.observe(f.selection)).basis).toBe(result.basis);expect(JSON.stringify(result)).not.toContain('blobId');expect(JSON.stringify(result)).not.toContain('new\\r\\n');
});
it.each(['authorization','scope','effects','input','tail','binding'] as const)('原 %s 不可信时不查询受控记录',async mode=>{
 const f=fixture(),allowed=f.summary.events.find(e=>e.type==='tool.allowed')!,proposed=f.summary.events.find(e=>e.type==='tool.proposed')!;
 if(mode==='authorization')f.summary.events=f.summary.events.filter(e=>e.type!=='tool.allowed').map((e,i)=>({...e,seq:i+1}));if(mode==='scope')allowed.data.scope={kind:'knowledge',workspaceId:f.query.workspaceId};if(mode==='effects')allowed.data.effects=['read'];if(mode==='input'){proposed.data.input={path:'../outside',expectedBefore:{},content:'x'};allowed.data.input=proposed.data.input}if(mode==='tail')f.summary.logIntegrity={partialTail:true};if(mode==='binding')f.summary.memberBinding={...f.summary.memberBinding!,agentSessionId:'other'};
 expect((await f.service.observe(f.selection)).calls[0].coverage).toBe('unsupported');expect(f.observeControlled).not.toHaveBeenCalled();
});
it('错回执身份、成员/周期/操作、原路径与前后字节及补偿序列均拒绝',async()=>{
 for(const mode of ['root','binding','scope','operation','path','before','after','compensation','private','error']){
  const f=fixture();if(f.report.ledger.state!=='recorded')throw Error('fixture');const op=f.report.ledger.operation;
  if(mode==='root')f.report.identity.rootSessionId='other';if(mode==='binding')op.binding.leaseEpoch++;if(mode==='scope')op.scopeId='other';if(mode==='operation')op.operationId='0'.repeat(64);if(mode==='path')op.relativePath='other.txt';if(mode==='before')op.before.sha256='0'.repeat(64);if(mode==='after')op.intendedAfter.byteLength++;if(mode==='compensation')f.report.ledger.compensationRevision=1;if(mode==='private')Object.assign(f.report.ledger,{blobPath:'PRIVATE_BLOB_PATH'});if(mode==='error')f.observeControlled.mockRejectedValue(Error('PRIVATE_PLATFORM_PATH'));
  const result=await f.service.observe(f.selection);expect(result.calls[0].controlled,mode).toMatchObject({state:'unverifiable'});expect(JSON.stringify(result)).not.toContain('PRIVATE_');
 }
});
it('原缺记录不当作未执行，新增补偿使旧处置依据失效；停止和旧报告保持',async()=>{
 const f=fixture(),original=await f.service.observe(f.selection);f.observeControlled.mockResolvedValueOnce({...f.report,ledger:{state:'absent',issues:[]}});expect((await f.service.observe(f.selection)).consistency).toBe('changed_during_read');
 if(f.report.ledger.state!=='recorded')throw Error('fixture');f.report.ledger.compensationRevision=1;f.report.ledger.compensations=[{compensationId:'a'.repeat(64),commandId:randomUUID(),revision:3,phase:'applied',preparedAt:f.report.checkedAt,updatedAt:f.report.checkedAt}];const next=await f.service.observe(f.selection);expect(next.basis).not.toBe(original.basis);expect(next.calls[0].controlled).toMatchObject({operation:{phase:'applied'},compensations:[{phase:'applied'}]});
 await expect(f.service.record({...f.selection,commandId:randomUUID(),expectedBasis:original.basis,expectedRevision:0,decision:'inspect_more',reason:'核实原受控阶段'},{kind:'local_desktop',interaction:'explicit_submit'})).rejects.toMatchObject({code:'EFFECT_PREACCEPT_BASIS_STALE'});expect(f.transact).not.toHaveBeenCalled();
 f.observeControlled.mockResolvedValue({...f.report,ledger:{state:'absent',issues:[]}});const absent=await f.service.observe(f.selection);expect(absent.calls[0].controlled).toEqual({state:'absent',issues:[]});expect(absent.calls[0].limitations.join('')).toContain('不等于没有写入');
 const stopped=new AbortController();stopped.abort(Error('explicit stop'));const count=f.observeControlled.mock.calls.length;await expect(f.service.observe(f.selection,stopped.signal)).rejects.toThrow('explicit stop');expect(f.observeControlled).toHaveBeenCalledTimes(count);
 const old=effectReport();expect(effectObservationReportSchema.parse(old)).toEqual(old);expect(effectObservationBasis(old)).toBe(old.basis);expect(old.calls[0]).not.toHaveProperty('controlled');expect(controlledFileReportSchema.parse(f.report)).toEqual(f.report);
 const wrong=structuredClone(next);wrong.identity.subject={kind:'main_run',runId:f.query.runId,toolCallIds:[f.query.toolCallId]};expect(effectObservationReportSchema.safeParse(wrong).success).toBe(false);
});
