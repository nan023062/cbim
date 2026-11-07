import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import type {Application} from '../src/backend/main/application';
import type {RunSummary} from '../src/backend/core/brain/types';
import type {EffectObservationInput} from '../src/backend/core/tasks/effect-observation';
import {moduleGovernanceToolsProvider,moduleGovernanceToolsFixture} from './module-governance-tools-provider';
import {seedModuleGovernanceTools,moduleGovernanceToolsRecords,moduleGovernanceToolsLogBytes,moduleGovernanceToolsJournalBytes} from './module-governance-tools-fixture';
import {moduleOwnershipProvider} from './module-ownership-provider';
import {seedModuleOwnership,moduleOwnershipFixture} from './module-ownership-fixture';

export type PersistentEffectMode='observe'|'propose'|'ownership';
/** Source-only lost response follows a real durable write; final packaged UI uses no injection or replacement IPC. */
export async function preparePersistentEffect(app:Application,user:string,project:string,temp:string,mode:PersistentEffectMode){
 const ownership=mode==='ownership',provider=ownership?await moduleOwnershipProvider('bad-wire'):await moduleGovernanceToolsProvider(mode==='observe'?'lost-observation':'lost-reply');
 let restore=()=>{},writes=0;
 try{
  const seeded=ownership?await seedModuleOwnership(app,temp,provider.url):await seedModuleGovernanceTools(app,project,provider),id=seeded.entry.id,workspace=app.workspace(id),instanceId=workspace.instanceId;
  if(ownership){assert.ok('bindModule'in provider);assert.ok('moduleId'in seeded);provider.bindModule(seeded.moduleId);const service=app.workspaceOwnerships(id),original=service.commit,real=original.bind(service);service.commit=async(...args)=>{const value=await real(...args);writes++;return {...value,identity:{...value.identity,workspaceId:'wrong-test-output-identity'}}};restore=()=>{service.commit=original}}
  else{const service=workspace.governance,key=mode==='observe'?'observeFromMain':'proposeFromMain',original=service[key],real=original.bind(service);service[key]=async(...args)=>{await real(...args);writes++;throw Error('TEST_RESPONSE_LOST')};restore=()=>{service[key]=original}}
  const started=await app.dispatch('loop.chat',{id,message:ownership?moduleOwnershipFixture.goal:moduleGovernanceToolsFixture.goal,options:{profileId:seeded.profileId,model:ownership?moduleOwnershipFixture.model:moduleGovernanceToolsFixture.model,permission:'execute',turnTimeoutMs:60000}});
  const deadline=Date.now()+65000;
  while(true){assert.deepEqual(provider.errors,[]);const state=await moduleGovernanceToolsRecords(user,id);if(state.scopes.some(scope=>scope.rootSessionId===started.taskId&&scope.status==='closed')&&app.runtime.snapshot().pressure.activeRuns===0)break;assert.ok(Date.now()<deadline,'真实 Pi 未结算');await delay(30)}
  restore();restore=()=>{};assert.equal(writes,1);assert.equal(provider.requests.length,ownership?6:mode==='observe'?9:8);
  const callId=ownership?'owner-commit':mode==='observe'?'governance-observe':'governance-propose';
  const summary=await app.dispatch('loop.inspect',{id,taskId:started.taskId,runId:started.runId}) as RunSummary;
  assert.equal(summary.toolReceipts?.find(item=>item.toolCallId===callId)?.outcome,'failed');assert.ok(summary.sessionFile);
  const selection:EffectObservationInput={workspaceId:id,rootSessionId:started.taskId,subject:{kind:'main_run',runId:started.runId,toolCallIds:[callId]}};
  const snapshot=await workspace.snapshot(),state=await workspace.dispatchStore.read(),canonical=await moduleGovernanceToolsLogBytes(user,id),native=await fs.readFile(summary.sessionFile),journals=await moduleGovernanceToolsJournalBytes(user,id);
  const ledger=path.join(user,id,'governance','module-ledger.json'),ledgerBytes=await fs.readFile(ledger),anchorBytes=await fs.readFile(ledger+'.anchor');
  return {mode,provider,seeded,id,instanceId,started,callId,summary,selection,writes,snapshot,state,canonical,native,journals,ledger,ledgerBytes,anchorBytes};
 }catch(error){restore();await provider.close();throw error}
}

/** No observation or disposition may alter the original graph, source logs, private knowledge journals or governance ledger. */
export async function verifyPersistentEffectOriginal(app:Application,user:string,source:Awaited<ReturnType<typeof preparePersistentEffect>>){
 const workspace=app.workspace(source.id),state=await workspace.dispatchStore.read();
 for(const key of ['members','sessions','graphs','outbox','runs','scopes','moduleOwnerships','ownershipChanges','ownershipCursor','workspaceMembers','workspaceMemberChanges'] as const)assert.deepEqual(state[key],source.state[key],key+' changed');
 assert.deepEqual(await moduleGovernanceToolsLogBytes(user,source.id),source.canonical);assert.deepEqual(await fs.readFile(source.summary.sessionFile!),source.native);assert.deepEqual(await moduleGovernanceToolsJournalBytes(user,source.id),source.journals);assert.deepEqual(await fs.readFile(source.ledger),source.ledgerBytes);assert.deepEqual(await fs.readFile(source.ledger+'.anchor'),source.anchorBytes);
 assert.deepEqual((await workspace.snapshot()).files,source.snapshot.files);assert.equal(source.provider.requests.length,source.mode==='ownership'?6:source.mode==='observe'?9:8);assert.deepEqual(source.provider.errors,[]);
}
