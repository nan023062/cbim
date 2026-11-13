import {expect,it} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {fixture} from './helpers';
import {Application} from '../src/bridge/server/application';
import {Paths} from '../src/logic/workspace/service/paths';
import {effectObservationReportSchema,effectDispositionReceiptSchema} from '../src/logic/tasks/rules/effect-observation';
import {originalPersistentWrite,persistentWriteIdentity} from '../src/logic/tasks/rules/persistent-write-input';
import {observePersistentWrite} from '../src/logic/evidence/service/persistent-effect-reader';
import {preparePersistentEffect,verifyPersistentEffectOriginal} from './persistent-effect-fixture';
import {hash} from '../src/core/platform/node/serialization';

it.each(['observe','propose','ownership'] as const)('真实 Pi %s 保存后丢回包：原失败保留、原命令可核实，处置和重开不重放',async mode=>{
 const f=await fixture();let app=f.app,source:Awaited<ReturnType<typeof preparePersistentEffect>>|undefined;
 try{
  source=await preparePersistentEffect(app,f.user,f.a,f.temp,mode);const workspace=app.workspace(source.id),original=source.summary.events.find(event=>event.type==='tool.proposed'&&event.data.id===source!.callId),main=source.summary.conversationBinding!;
  expect(original).toBeDefined();if(typeof original?.data.name!=='string')throw Error('原工具缺名称');const scope=source.state.scopes!.find(item=>item.runTracking?.mainRunIds.includes(source!.started.runId))!;
  const reference=originalPersistentWrite(original.data.name,original.data.input,{workspaceId:source.id,rootSessionId:source.started.taskId,runId:source.started.runId,scopeId:scope.scopeId,agentInstanceId:main.agentInstanceId,agentSessionId:main.agentSessionId,toolCallId:source.callId})!;
  expect(reference).toBeDefined();const direct=await observePersistentWrite(workspace,reference);expect(direct.state).toBe('recorded');expect(direct.record?.instanceId).toBe(source.instanceId);
  // Query rejects altered original arguments, caller identities and corrupted isolated read clones without touching the actual ledger.
  const wrong=structuredClone(reference);if(wrong.kind==='governance'){if(wrong.action==='observe')wrong.input.statement+=' changed';else wrong.input.reason+=' changed'}else wrong.input.change.reason+=' changed';
  expect(await observePersistentWrite(workspace,wrong)).toMatchObject({state:'unverifiable'});
  const wrongSource=structuredClone(reference);wrongSource.source.agentSessionId='another-session';expect((await observePersistentWrite(workspace,wrongSource)).state).toBe(mode==='ownership'?'absent':'unverifiable');
  const absent=structuredClone(reference);absent.source.toolCallId='different-original-call';expect(await observePersistentWrite(workspace,absent)).toMatchObject({state:'absent'});
  const identity=persistentWriteIdentity(reference),base={entry:workspace.entry,assert:()=>workspace.assert(),governed:<T>(operation:()=>Promise<T>)=>workspace.governed(operation),governance:workspace.governance,dispatchStore:workspace.dispatchStore};
  if(reference.kind==='governance'){
   const command=workspace.governance.store.find(identity.commandId)!;
   for(const mutate of [(v:typeof command)=>{v.fingerprint='0'.repeat(64)},(v:typeof command)=>{v.receipt.identity.instanceId=randomUUID()},(v:typeof command)=>{delete v.origin},(v:typeof command)=>{if(v.receipt.action==='observe')v.receipt.record.observationId=randomUUID();else if(v.receipt.action==='propose')v.receipt.record.proposalId=randomUUID()}]){const bad=structuredClone(command);mutate(bad);expect(await observePersistentWrite({...base,governance:{store:{find:()=>bad}}},reference)).toMatchObject({state:'unverifiable'})}
   expect(await observePersistentWrite({...base,governance:{store:{find:()=>{throw Error('PRIVATE_LEDGER_UNCERTAIN')}}}},reference)).toMatchObject({state:'unverifiable'});
  }else{
   const command=(await workspace.dispatchStore.commandReceipt('module-ownership-'+identity.commandId))!,state=await workspace.dispatchStore.read();
   for(const mutate of [(v:typeof command)=>{v.fingerprint='0'.repeat(64)},(v:typeof command)=>{(v.receipt as {revision:number}).revision++}]){const bad=structuredClone(command);mutate(bad);expect(await observePersistentWrite({...base,dispatchStore:{read:async()=>state,commandReceipt:async()=>bad}},reference)).toMatchObject({state:'unverifiable'})}
   expect(await observePersistentWrite({...base,dispatchStore:{read:async()=>({...state,ownershipChanges:[]}),commandReceipt:async()=>command}},reference)).toMatchObject({state:'unverifiable'});
   expect(await observePersistentWrite({...base,dispatchStore:{read:async()=>state,commandReceipt:async()=>undefined}},reference)).toMatchObject({state:'unverifiable'});
  }
  const stopped=new AbortController();stopped.abort(Error('explicit stop'));await expect(observePersistentWrite(workspace,reference,stopped.signal)).rejects.toThrow('explicit stop');
  const observed=effectObservationReportSchema.parse(await app.dispatch('dispatch.effectObserve',source.selection));expect(observed).toMatchObject({consistency:'stable',source:{state:'verified',scopeStatus:'closed'},calls:[{outcome:'failed',coverage:'persistent_record',persistent:direct}]});
  expect(JSON.stringify(observed)).not.toContain('TEST_RESPONSE_LOST');expect(JSON.stringify(observed)).not.toContain('PRIVATE_');expect(JSON.stringify(observed)).not.toContain(source.snapshot.files.find(file=>file.path.endsWith('module.md'))!.text);
  const request={...source.selection,commandId:randomUUID(),expectedBasis:observed.basis,expectedRevision:observed.dispositionRevision,decision:'inspect_more',reason:'原记录已经保存；工具失败保留，批准、实施或后续交接仍需单独核实'};
  const saved=effectDispositionReceiptSchema.parse(await app.dispatch('dispatch.effectDisposition',request)),lookup={workspaceId:source.id,rootSessionId:source.started.taskId,commandId:request.commandId};
  expect(saved.record.observation.calls[0]).toMatchObject({outcome:'failed',persistent:direct});expect(await app.dispatch('dispatch.effectDispositionReceipt',lookup)).toEqual(saved);expect(await app.dispatch('dispatch.effectDisposition',request)).toEqual(saved);await verifyPersistentEffectOriginal(app,f.user,source);
  const dispatchFile=path.join(f.user,source.id,'dispatch','dispatch.jsonl'),bytes=await fs.readFile(dispatchFile);
  await app.shutdown();app=new Application(new Paths(f.user,path.resolve('.')),path.resolve('design'));await app.init();expect(app.workspace(source.id).instanceId).not.toBe(source.instanceId);
  const reopened=effectObservationReportSchema.parse(await app.dispatch('dispatch.effectObserve',source.selection));expect(reopened.calls).toEqual(observed.calls);expect(reopened.basis).toBe(observed.basis);expect(await app.dispatch('dispatch.effectDispositionReceipt',lookup)).toEqual(saved);expect(await fs.readFile(dispatchFile)).toEqual(bytes);await verifyPersistentEffectOriginal(app,f.user,source);
  await fs.mkdir('test-results',{recursive:true});await fs.writeFile('test-results/persistent-effect-'+mode+'-pi-evidence.json',JSON.stringify({mode,selection:source.selection,requests:source.provider.requests.length,writes:source.writes,observed,reopened,receipt:saved,nativeBytes:source.native.length,nativeHash:hash(source.native),originalRecordsUnchanged:true,reopenAddedRequests:0,errors:source.provider.errors},null,2));
 }finally{await app.shutdown();await f.cleanup();await source?.provider.close()}
},90000);
