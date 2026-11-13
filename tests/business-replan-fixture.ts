import fs from 'node:fs/promises';
import path from 'node:path';
import type {Application} from '../src/backend/main/assembly/application';
import type {GraphSnapshot} from '../src/logic/tasks/rules/graph-types';
import {seedExecutionReport} from './execution-report-fixture';
import {inspectionScopes,corruptInspectionHistory} from './inspection-cycle-fixture';
import {businessReplanFixture as data} from './business-replan-provider';
import type {businessReplanProvider} from './business-replan-provider';
import {randomUUID} from 'node:crypto';

/** Build a real failed business run and completed read-only inspection in an isolated Application. */
export async function prepareBusinessReplan(app:Application,project:string,user:string,provider:Awaited<ReturnType<typeof businessReplanProvider>>){
  const {entry,team}=await seedExecutionReport(app,project,provider),profileId=(await app.models.list()).selectedId!;
  const wait=async(check:()=>Promise<boolean>,label:string)=>{const end=Date.now()+30000;while(Date.now()<end){if(await check())return;await new Promise(resolve=>setTimeout(resolve,25))}throw Error('Business fixture timeout: '+label)};
  const started=await app.dispatch('loop.chat',{id:entry.id,message:data.oldGoal,options:{permission:'execute',turnTimeoutMs:30000}}) as {taskId:string;runId:string},identity={workspaceId:entry.id,rootSessionId:started.taskId};
  const scopes=()=>inspectionScopes(user,entry.id),graph=async()=>await app.dispatch('dispatch.graphSnapshot',{identity}) as GraphSnapshot;
  await wait(async()=>provider.memberRequests.length===3,'old native failure');await app.dispatch('loop.enqueue',{id:entry.id,taskId:started.taskId,message:data.queued,options:{permission:'read'}});provider.releaseOld();
  await wait(async()=>{try{return (await scopes())[0].status==='closed'&&app.runtime.snapshot().pressure.activeRuns===0}catch{return false}},'old scope closed');
  const oldScope=(await scopes())[0],originalGraph=await graph(),oldTask=originalGraph.tasks[0],oldRun=oldTask.runIds[0],marker=path.join(project,data.marker),markerStat=await fs.stat(marker);
  if(await fs.readFile(marker,'utf8')!==data.markerLine)throw Error('Old native command did not perform the expected isolated write');
  const corruption=await corruptInspectionHistory(user,entry.id,started.taskId,oldTask.taskId,oldRun),report=await app.dispatch('dispatch.executionReport',{...identity,taskId:oldTask.taskId,runId:oldRun});
  const recovery=await app.dispatch('loop.recoveryStart',{...identity,commandId:randomUUID(),source:{scopeId:oldScope.scopeId,taskId:oldTask.taskId,runId:oldRun,reportBasis:report.basis.key},operation:'inspect_effects',observation:{text:data.observation},input:{message:data.inspectionGoal},options:{profileId,provider:'cbim-'+profileId,model:'report-fixture',permission:'read',turnTimeoutMs:30000}});
  await wait(async()=>{const all=await scopes();return all[1]?.status==='closed'&&app.runtime.snapshot().pressure.activeRuns===0},'inspection closed');
  const inspection=(await scopes())[1],inspectionTask=(await graph()).tasks.find(task=>task.scopeId===inspection.scopeId)!;
  if(inspection.outcome!=='completed'||!inspectionTask.result)throw Error('Fixture inspection did not produce real completed evidence');
  return {entry,team,profileId,identity,oldScope,oldTask,inspection,inspectionTask,originalGraph,corruption,marker,markerStat,recovery,scopes,graph};
}
