import {expect} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import type {Application} from '../src/bridge/server/application';
import {FileRunStorage} from '../src/logic/execution/storage/run-storage';
import {seedExecutionReport} from './execution-report-fixture';
import {businessReplanFixture as data,type businessReplanProvider} from './business-replan-provider';
import {inspectionScopes} from './inspection-cycle-fixture';

/** Three actual calls use independent native sessions; damaged original logs are preserved byte-for-byte. */
export async function prepareRecursiveReplan(app:Application,project:string,user:string,provider:Awaited<ReturnType<typeof businessReplanProvider>>){
 const {entry,team}=await seedExecutionReport(app,project,provider),profileId=(await app.models.list()).selectedId!;
 const wait=async(check:()=>Promise<boolean>,label:string)=>{const end=Date.now()+40000;while(Date.now()<end){if(provider.errors.length)throw Error(provider.errors.join('\n'));if(await check())return;await new Promise(resolve=>setTimeout(resolve,25))}throw Error('Recursive replan timeout '+label)};
 const start=await app.dispatch('loop.chat',{id:entry.id,message:data.oldGoal,options:{permission:'execute',turnTimeoutMs:30000}}),identity={workspaceId:entry.id,rootSessionId:start.taskId},scopes=()=>inspectionScopes(user,entry.id);
 await wait(async()=>provider.memberRequests.length===3,'original command');
 provider.releaseOld();
 await wait(async()=>(await scopes())[0]?.status==='closed'&&app.runtime.snapshot().pressure.activeRuns===0,'original closed');
 await app.dispatch('loop.stop',{id:entry.id,taskId:start.taskId});
 await app.dispatch('loop.enqueue',{id:entry.id,taskId:start.taskId,message:data.queued,options:{permission:'read'}});
 const oldScope=(await scopes())[0],state=await app.workspace(entry.id).dispatchStore.read(),oldRun=state.agentBusinessRuns![0];
 expect(oldRun.request).toBeDefined();expect(state.graphs[0].tasks).toEqual([]);
 const marker=path.join(project,data.marker),markerStat=await fs.stat(marker);expect(await fs.readFile(marker,'utf8')).toBe(data.markerLine);
 const storage=new FileRunStorage(),originals:{file:string;bytes:Buffer}[]=[];
 for(const [taskId,runId] of [[start.taskId,start.runId],[oldRun.binding.taskId,oldRun.binding.runId]]){
  const directory=path.join(user,entry.id,'loop-engine/tasks',taskId,runId),summary=await storage.read(directory),file=path.join(directory,'events.jsonl');
  await fs.appendFile(file,'{"invalid_original":true}\n');originals.push({file,bytes:await fs.readFile(file)},{file:summary.sessionFile!,bytes:await fs.readFile(summary.sessionFile!)});
 }
 const unchanged=async()=>{for(const item of originals)expect(await fs.readFile(item.file)).toEqual(item.bytes)};
 const subject={kind:'member_run' as const,taskId:oldRun.binding.taskId,runId:oldRun.binding.runId,toolCallIds:['old-write']};
 const report=await app.dispatch('dispatch.effectObserve',{...identity,subject});
 const recovery=await app.dispatch('loop.recoveryStart',{...identity,commandId:randomUUID(),source:{...subject,reportBasis:report.basis},operation:'inspect_effects',observation:{text:data.observation},input:{message:data.inspectionGoal},options:{profileId,provider:'cbim-'+profileId,model:'report-fixture',permission:'read',turnTimeoutMs:30000}});
 await wait(async()=>(await scopes())[1]?.status==='closed'&&app.runtime.snapshot().pressure.activeRuns===0,'inspection closed');
 const inspection=(await scopes())[1],after=await app.workspace(entry.id).dispatchStore.read(),inspectionRun=after.agentBusinessRuns!.find(run=>run.scopeId===inspection.scopeId)!;
 expect(inspection.outcome).toBe('completed');expect(inspectionRun.permission).toBe('read');expect(provider.mainRequests).toHaveLength(4);expect(provider.memberRequests).toHaveLength(8);
 return {entry,team,profileId,identity,oldScope,oldRun,inspection,inspectionRun,marker,markerStat,recovery,scopes,unchanged,wait};
}
