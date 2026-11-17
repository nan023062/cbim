import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import type {Application} from '../../../../../../src/bridge/server/application';
import {FileRunStorage} from '../../../../../../src/logic/execution/storage/run-storage';
import {seedEffectObservation,effectWait,effectRecords} from '../../../evidence/runtime/support/effect-observation-fixture';
import {effectFixture as data,type effectObservationProvider} from '../../../evidence/runtime/support/effect-observation-provider';
import {loseOriginalEffectResult} from '../../../evidence/runtime/support/effect-observation-fault';

/** Exercise real recursive effects and preserve the original unknown receipt without synthetic legacy nodes. */
export async function prepareRecursiveUnknownEffect(app:Application,user:string,project:string,provider:Awaited<ReturnType<typeof effectObservationProvider>>,unsupported=false,edit=false){
 const seed=await seedEffectObservation(app,project,provider),id=seed.entry.id,fault=unsupported||edit?undefined:loseOriginalEffectResult(project);
 if(edit)await fs.writeFile(path.join(project,data.file),data.editSeedText);
 try{
  const started=await app.Dispatch('loop.chat',{id,message:data.oldGoal,options:seed.options}),identity={workspaceId:id,rootSessionId:started.taskId};
  await effectWait(async()=>{const saved=await effectRecords(user,id);return saved.scopes.length===1&&saved.scopes[0].status==='closed'&&app.runtime.Snapshot().pressure.activeRuns===0},provider,'recursive source closed');
  const records=await effectRecords(user,id),state=await app.Workspace(id).dispatchStore.Read(),run=state.agentBusinessRuns?.[0];
  assert.ok(run);assert.equal(state.agentBusinessRuns?.length,1);assert.deepEqual(state.graphs[0].tasks,[]);assert.deepEqual(records.runs,[]);
  assert.equal(provider.main.length,2);assert.equal(provider.member.length,3);
  const toolCallId=unsupported?'effect-old-command':edit?'effect-old-edit':'effect-old-write',subject={kind:'member_run' as const,taskId:run.binding.taskId,runId:run.binding.runId,toolCallIds:[toolCallId]};
  const directory=path.join(user,id,'loop-engine/tasks',subject.taskId,subject.runId),summary=await new FileRunStorage().Read(directory);
  assert.ok(summary.sessionFile);assert.equal(summary.logIntegrity?.partialTail,false);assert.equal(summary.taskProgress?.delivery,undefined);
  assert.equal(summary.events.filter(e=>e.type==='tool.allowed'&&e.data.id===toolCallId).length,1);
  if(!unsupported&&!edit){assert.equal(fault!.events.length,1);assert.ok(summary.unresolvedTools.includes(toolCallId));assert.equal(summary.events.filter(e=>e.type==='tool.finished'&&e.data.id===toolCallId).length,0)}
  else assert.equal(summary.toolReceipts?.find(r=>r.toolCallId===toolCallId)?.outcome,edit?'succeeded':'failed');
  assert.equal(await fs.readFile(path.join(project,data.file),'utf8'),unsupported?'UNSUPPORTED_NATIVE_EFFECT':data.oldText);
  const canonicalPath=path.join(directory,'events.jsonl'),nativePath=summary.sessionFile;
  return {seed,started,identity,subject,records,run,summary,original:{canonicalPath,nativePath,canonical:await fs.readFile(canonicalPath),native:await fs.readFile(nativePath)},faultEvents:fault?.events??[]};
 }finally{fault?.restore()}
}
