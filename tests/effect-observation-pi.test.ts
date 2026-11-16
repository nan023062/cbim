import {mainToolContractProvider} from './main-tool-contract-provider';
import {prepareRecursiveOriginal} from './recursive-original-fixture';
import {prepareRecursiveUnknownEffect} from './recursive-effect-fixture';
import {expect,it} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {Application} from '../src/bridge/server/application';
import {Paths} from '../src/logic/workspace/service/paths';
import {effectObservationReportSchema,effectDispositionReceiptSchema,effectDispositionListSchema,effectRelationsSchema,type EffectDispositionInput} from '../src/logic/tasks/rules/effect-observation';
import {recoveryReceiptSchema,type RecoveryRequest} from '../src/logic/tasks/rules/scope-recovery';
import {replanPreviewSchema,replanReceiptSchema,type ReplanRequest} from '../src/logic/tasks/rules/scope-replan';
import {fixture} from './helpers';
import {effectFixture as data,effectObservationProvider} from './effect-observation-provider';
import {assertOriginalEffectUnchanged,effectWait,effectRecords,effectLogBytes,effectRunBytes,effectRunEvidence,archiveEffectRuns} from './effect-observation-fixture';

const sha=(text:string)=>createHash('sha256').update(text).digest('hex');
const journal=(user:string,id:string)=>fs.readFile(path.join(user,id,'dispatch','dispatch.jsonl'));

it('observes an actual lost write result, records disposition, inspects fresh, then repairs with new evidence',async()=>{
 const f=await fixture(),provider=await effectObservationProvider({recursive:true});let app=f.app;
 try{
  const source=await prepareRecursiveUnknownEffect(app,f.user,f.a,provider),id=source.identity.workspaceId,selection={...source.identity,subject:source.subject};
  const observe=async()=>effectObservationReportSchema.parse(await app.dispatch('dispatch.effectObserve',selection));
  const before=await journal(f.user,id),first=await observe();
  expect(first).toMatchObject({consistency:'stable',dispositionRevision:0,readOnly:true,acceptance:'not_evaluated',source:{state:'verified',scopeStatus:'closed',unknownToolCount:1},calls:[{toolCallId:'effect-old-write',outcome:'unknown',coverage:'selected_files_now',file:{relativePath:data.file,state:'present',sha256:sha(data.oldText)}}]});
  expect((await observe()).basis).toBe(first.basis);expect(await journal(f.user,id)).toEqual(before);
  const request:EffectDispositionInput={...selection,commandId:randomUUID(),expectedBasis:first.basis,expectedRevision:0,decision:'inspect_more',reason:data.observation};
  const saved=effectDispositionReceiptSchema.parse(await app.dispatch('dispatch.effectDisposition',request));
  expect(saved.record.actor).toEqual({kind:'local_desktop',interaction:'explicit_submit'});
  const afterSave=await journal(f.user,id);expect(await app.dispatch('dispatch.effectDisposition',request)).toEqual(saved);expect(await journal(f.user,id)).toEqual(afterSave);
  expect(effectDispositionListSchema.parse(await app.dispatch('dispatch.effectDispositionList',selection)).revision).toBe(1);
  const recovery:RecoveryRequest={...source.identity,commandId:randomUUID(),source:{...source.subject,reportBasis:first.basis},operation:'inspect_effects',observation:{text:data.observation},input:{message:data.inspectGoal},options:{...source.seed.options,permission:'read'},dispositionId:request.commandId};
  const accepted=recoveryReceiptSchema.parse(await app.dispatch('loop.recoveryStart',recovery));
  await effectWait(async()=>{const r=await effectRecords(f.user,id);return r.scopes[1]?.status==='closed'&&app.runtime.snapshot().pressure.activeRuns===0},provider,'recursive read-only inspection');
  const inspected=await effectRecords(f.user,id),inspection=inspected.scopes[1],inspectionRun=(await app.workspace(id).dispatchStore.read()).agentBusinessRuns!.find(run=>run.scopeId===inspection.scopeId)!;
  expect(inspection.outcome).toBe('completed');expect(inspectionRun.permission).toBe('read');expect(provider.main).toHaveLength(4);expect(provider.member).toHaveLength(8);
  expect(effectRelationsSchema.parse(await app.dispatch('dispatch.effectRelations',{...source.identity,dispositionId:request.commandId})).links).toMatchObject([{kind:'inspection',scopeId:inspection.scopeId,status:'closed',taskIds:[inspectionRun.binding.taskId]}]);
  const current=await observe();expect(current.basis).toBe(first.basis);
  const repairDecision:EffectDispositionInput={...selection,commandId:randomUUID(),expectedBasis:current.basis,expectedRevision:current.dispositionRevision,decision:'repair_in_new_cycle',reason:'Fresh repair with actual evidence'};
  const repairSaved=effectDispositionReceiptSchema.parse(await app.dispatch('dispatch.effectDisposition',repairDecision));
  const preview=replanPreviewSchema.parse(await app.dispatch('dispatch.replans.preview',{...source.identity,inspectionScopeId:inspection.scopeId}));
  expect(preview.eligible,JSON.stringify(preview)).toBe(true);
  const replan:ReplanRequest={...source.identity,commandId:randomUUID(),source:{inspectionScopeId:inspection.scopeId,expectedBasis:preview.basis!},input:{message:data.repairGoal},options:source.seed.options,dispositionId:repairDecision.commandId};
  const repair=replanReceiptSchema.parse(await app.dispatch('loop.replanStart',replan));
  await effectWait(async()=>{const r=await effectRecords(f.user,id);return r.scopes[2]?.status==='closed'&&app.runtime.snapshot().pressure.activeRuns===0},provider,'recursive fresh repair');
  const final=await effectRecords(f.user,id),state=await app.workspace(id).dispatchStore.read(),repairRun=state.agentBusinessRuns!.find(run=>run.scopeId===repair.scopeId)!;
  expect(final.scopes[2].outcome).toBe('completed');expect(final.scopes.slice(0,2)).toEqual(inspected.scopes);expect(state.graphs[0].tasks).toEqual([]);
  expect(state.agentBusinessRuns!.find(run=>run.binding.runId===source.run.binding.runId)).toEqual(source.run);
  expect(new Set(state.agentBusinessRuns!.map(run=>run.binding.agentInstanceId)).size).toBe(3);
  expect(await fs.readFile(path.join(f.a,data.file),'utf8')).toBe(data.newText);await assertOriginalEffectUnchanged(source.original);
  expect(provider.main).toHaveLength(6);expect(provider.member).toHaveLength(15);expect(provider.errors).toEqual([]);
  expect(effectRelationsSchema.parse(await app.dispatch('dispatch.effectRelations',{...source.identity,dispositionId:repairDecision.commandId})).links).toMatchObject([{kind:'repair',scopeId:repair.scopeId,status:'closed',taskIds:[repairRun.binding.taskId]}]);
  const afterRepair=await observe();expect(afterRepair.calls[0]).toMatchObject({outcome:'unknown',file:{sha256:sha(data.newText)}});expect(afterRepair.basis).not.toBe(first.basis);
  const publicRepair=await app.dispatch('dispatch.sessionRead',{identity:source.identity,selectedScopeId:repair.scopeId});
  expect(publicRepair.detail.mode).toBe('updated');expect(JSON.stringify(publicRepair.detail)).not.toMatch(/"context"|nativeSessionId|sessionFile|excludedRunIds/);
  const finalJournal=await journal(f.user,id);
  await app.shutdown();app=new Application(new Paths(f.user,path.resolve('.')),path.resolve('assets'));await app.init();
  expect(await app.dispatch('dispatch.effectDisposition',request)).toEqual(saved);expect(await app.dispatch('dispatch.effectDisposition',repairDecision)).toEqual(repairSaved);
  expect((await app.dispatch('loop.recoveryStart',recovery)).recovery).toEqual(accepted.recovery);expect((await app.dispatch('loop.replanStart',replan)).replan).toEqual(repair.replan);
  expect(await journal(f.user,id)).toEqual(finalJournal);await assertOriginalEffectUnchanged(source.original);expect(provider.main).toHaveLength(6);expect(provider.member).toHaveLength(15);
 }catch(error){await fs.mkdir('test-results',{recursive:true});await fs.writeFile('test-results/recursive-effect-repair.json',JSON.stringify({error:String(error),main:provider.main,member:provider.member,errors:provider.errors},null,2));throw error}
 finally{await app.shutdown();await provider.close();await f.cleanup()}
},120000);

it.each(['changed','unsupported','edit']as const)('does not turn current files or unsupported effects into original success (%s)',async mode=>{
  const f=await fixture(),provider=await effectObservationProvider({unsupported:mode==='unsupported',edit:mode==='edit',recursive:true});let app=f.app,keep=false;
  try{
    const source=await prepareRecursiveUnknownEffect(app,f.user,f.a,provider,mode==='unsupported',mode==='edit'),id=source.identity.workspaceId,selection={...source.identity,subject:source.subject},read=async(input=selection)=>effectObservationReportSchema.parse(await app.dispatch('dispatch.effectObserve',input)),first=await read();
    expect(first.source.state).toBe('verified');expect(first.calls[0].coverage).toBe(mode==='unsupported'?'unsupported':'selected_files_now');expect(first.calls[0].outcome).toBe(mode==='changed'?'unknown':mode==='edit'?'succeeded':'failed');expect(first.calls[0].baselineChecks).toBeUndefined();if(mode==='unsupported')expect(first.calls[0].file).toBeUndefined();
    if(mode==='edit'){expect(first.calls[0]).toMatchObject({toolName:'edit',file:{relativePath:data.file,state:'present',sha256:sha(data.oldText),byteLength:Buffer.byteLength(data.oldText)}});expect(source.summary.events.find(event=>event.type==='tool.proposed'&&event.data.id==='effect-old-edit')?.data.input).toEqual({path:data.file,edits:[{oldText:'"before"',newText:'"partial"'},{oldText:'"count":0',newText:'"count":1'}]});expect(first.acceptance).toBe('not_evaluated')}
    const request:EffectDispositionInput={...selection,commandId:randomUUID(),expectedBasis:first.basis,expectedRevision:first.dispositionRevision,decision:'leave_unresolved',reason:'原影响仍未完全核实，本次只记录保持未知，不授权重试。'};
    let finalObservation=first;
    if(mode==='changed'){
      await fs.writeFile(path.join(f.a,data.file),data.externalText);const before=await journal(f.user,id);
      await expect(app.dispatch('dispatch.effectDisposition',request)).rejects.toMatchObject({code:'EFFECT_PREACCEPT_BASIS_STALE'});expect(await app.dispatch('dispatch.effectDispositionReceipt',{...source.identity,commandId:request.commandId})).toBeUndefined();expect(await journal(f.user,id)).toEqual(before);
      const changed=await read();expect(changed.basis).not.toBe(first.basis);expect(changed.calls[0].file?.sha256).toBe(sha(data.externalText));expect(changed.calls[0].outcome).toBe('unknown');
      await fs.unlink(path.join(f.a,data.file));finalObservation=await read();expect(finalObservation.calls[0].file).toMatchObject({state:'missing'});expect(finalObservation.calls[0].file).not.toHaveProperty('sha256');request.expectedBasis=finalObservation.basis;
    }
    const saved=effectDispositionReceiptSchema.parse(await app.dispatch('dispatch.effectDisposition',request));expect(effectRelationsSchema.parse(await app.dispatch('dispatch.effectRelations',{...source.identity,dispositionId:request.commandId})).links).toEqual([]);
    const other=await app.dispatch('loop.chat',{id,message:data.otherGoal,options:source.seed.options});await effectWait(async()=>{const records=await effectRecords(f.user,id);return records.scopes.length===2&&records.scopes.every(scope=>scope.status==='closed')&&app.runtime.snapshot().pressure.activeRuns===0},provider,'other root closed');
    const wrongRoot=await read({...selection,rootSessionId:other.taskId});expect(wrongRoot.source.state).toBe('unverifiable');expect(wrongRoot.calls[0].coverage).toBe('unsupported');expect(wrongRoot.calls[0].toolName).toBeUndefined();expect(wrongRoot.calls[0].file).toBeUndefined();
    const allRuns=await effectRunBytes(app,f.user,id,source.identity.rootSessionId),otherRuns=await effectRunBytes(app,f.user,id,other.taskId),logs=await effectLogBytes(f.user,id),records=await effectRecords(f.user,id),bytes=await journal(f.user,id);await assertOriginalEffectUnchanged(source.original);await archiveEffectRuns('test-results/effect-observation-'+mode+'-pi-bytes',f.user,id,[...allRuns,...otherRuns]);
    await app.shutdown();app=new Application(new Paths(f.user,path.resolve('.')),path.resolve('assets'));await app.init();
    expect(await app.dispatch('dispatch.effectDisposition',request)).toEqual(saved);expect((await read()).basis).toBe(finalObservation.basis);expect(await effectRecords(f.user,id)).toEqual(records);expect(await effectLogBytes(f.user,id)).toEqual(logs);expect(await journal(f.user,id)).toEqual(bytes);expect(await effectRunBytes(app,f.user,id,source.identity.rootSessionId)).toEqual(allRuns);expect(await effectRunBytes(app,f.user,id,other.taskId)).toEqual(otherRuns);expect([provider.main.length,provider.member.length,provider.other.length]).toEqual([2,3,1]);expect(provider.errors).toEqual([]);
    await fs.writeFile('test-results/effect-observation-'+mode+'-pi-evidence.json',JSON.stringify({mode,first,finalObservation,saved,wrongRoot,requests:{main:2,member:3,other:1},reopenNoReplay:true,originalBytesUnchanged:true,runs:effectRunEvidence([...allRuns,...otherRuns])},null,2));
  }catch(error){keep=true;await fs.writeFile('test-results/effect-observation-'+mode+'-pi-failure.json',JSON.stringify({temp:f.temp,error:String(error),stack:error instanceof Error?error.stack:undefined,requests:{main:provider.main.length,member:provider.member.length,other:provider.other.length},providerErrors:provider.errors},null,2));throw error}
  finally{await app.shutdown();await provider.close();if(!keep)await f.cleanup()}
},150000);

it('observes a failed recursive parent response separately from actual child facts',async()=>{
 const f=await fixture(),provider=await mainToolContractProvider('lost-result',true);let app=f.app;
 try{
  const source=await prepareRecursiveOriginal(app,f.a,provider,'lost-result'),identity=source.identity,id=identity.workspaceId;
  const selection={...identity,subject:{kind:'main_run' as const,runId:source.started.runId,toolCallIds:['contract-call']}};
  const before=await journal(f.user,id),report=effectObservationReportSchema.parse(await app.dispatch('dispatch.effectObserve',selection));
  expect(report.source).toMatchObject({state:'verified',scopeStatus:'closed'});
  expect(report.calls[0]).toMatchObject({outcome:'failed',coverage:'unsupported'});expect(report.calls[0].file).toBeUndefined();expect(report.acceptance).toBe('not_evaluated');
  expect(await journal(f.user,id)).toEqual(before);
  const run=source.state.agentBusinessRuns![0],child=await app.dispatch('dispatch.executionReport',{...identity,taskId:run.binding.taskId,runId:run.binding.runId});
  expect(child.execution).toBe('settled');expect(child.log.state).toBe('verified');expect(provider.state.check).toMatchObject({state:'verified',acceptance:'not_evaluated'});
  const request:EffectDispositionInput={...selection,commandId:randomUUID(),expectedBasis:report.basis,expectedRevision:report.dispositionRevision,decision:'leave_unresolved',reason:'The failed parent acknowledgement does not rewrite the actual child facts.'};
  const receipt=effectDispositionReceiptSchema.parse(await app.dispatch('dispatch.effectDisposition',request));
  const bytes=await journal(f.user,id),runs=await effectRunBytes(app,f.user,id,identity.rootSessionId),counts=[provider.main.length,provider.member.length];
  await app.shutdown();app=new Application(new Paths(f.user,path.resolve('.')),path.resolve('assets'));await app.init();
  const restored=effectObservationReportSchema.parse(await app.dispatch('dispatch.effectObserve',selection));
  expect(restored.calls).toEqual(report.calls);expect(restored.basis).toEqual(report.basis);expect(await app.dispatch('dispatch.effectDisposition',request)).toEqual(receipt);
  expect(await effectRunBytes(app,f.user,id,identity.rootSessionId)).toEqual(runs);expect(await journal(f.user,id)).toEqual(bytes);expect([provider.main.length,provider.member.length]).toEqual(counts);expect(provider.errors).toEqual([]);
 }finally{await app.shutdown();await provider.close();await f.cleanup()}
},90000);
