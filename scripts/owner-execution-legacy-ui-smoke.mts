import {_electron as electron,type ElectronApplication,type Page} from 'playwright-core';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import type {GraphSnapshot} from '../src/backend/core/tasks/graph-types';
import {createOwnerExecutionLegacyFixture} from '../tests/owner-execution-legacy-fixture';
import {ownerExecutionRecords} from '../tests/owner-execution-fixture';
import {knowledgeSourceDiskEvidence} from '../tests/knowledge-source-lifecycle-fixture';
import {latestExecutable} from './build-artifact.mjs';

// The released old EXE creates all three historical states. The final EXE only reads/reconciles them;
// rejected legacy claims below use explicit IPC, while the checkpoint history and draft use actual UI.
const exe=await latestExecutable(),artifact='owner-execution-legacy',screenshots:string[]=[],pageErrors:string[]=[],transportErrors:string[]=[];
assert.ok(!exe.includes('20261107-235854'),'Legacy production and final acceptance must use different actual binaries');
const legacy=await createOwnerExecutionLegacyFixture(),old=legacy.evidence,id=legacy.workspaceId,draft='旧任务只核实原事实；此草稿不发送，也不自动补岗位。';
let desktop:ElectronApplication|undefined,page!:Page,passed=false,report:Record<string,unknown>|undefined;
const cleanup={desktopClosed:false,providersClosed:false,tempRemoved:false,originalRetainedSampleUntouched:true};
const digest=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
try{
  await fs.mkdir('test-results',{recursive:true});
  await fs.writeFile(`test-results/${artifact}-ui-seed.json`,JSON.stringify(old,null,2));
  const launch=async()=>{desktop=await electron.launch({executablePath:exe,env:{...process.env,CBIM_USER_DATA_ROOT:legacy.user},timeout:60000});page=await desktop.firstWindow();page.setDefaultTimeout(30000);page.on('pageerror',error=>pageErrors.push(error.message));page.on('requestfailed',request=>transportErrors.push(request.url()+': '+request.failure()?.errorText))};
  const call=<T=any,>(action:string,args:unknown={}):Promise<T>=>page.evaluate(({action,args})=>(window as any).cbim.call(action,args),{action,args});
  const until=async(check:()=>Promise<boolean>,label:string)=>{const end=Date.now()+60000;while(Date.now()<end){assert.deepEqual(legacy.providerErrors(),[]);if(await check())return;await new Promise(resolve=>setTimeout(resolve,40))}throw Error('Legacy desktop state did not settle: '+label)};
  const active=()=>page.locator('.workspace-panel:not([hidden])'),input=()=>active().getByRole('textbox',{name:'对话草稿',exact:true});
  const screenshot=async(label:string)=>{const file=`test-results/${artifact}-${label}.png`;await page.screenshot({path:file});screenshots.push(file)};
  const openCheckpoint=async()=>{
    const name=path.basename(old.project);
    await page.getByRole('button',{name:name+' · 运行中',exact:true}).click();
    await page.locator(`[aria-label="${name} 的对话"] button`).filter({hasText:'MEMBER_CHECKPOINT_MAIN:'}).first().click();
    await active().getByRole('tab',{name:'任务视图',exact:true}).click();
    const node=active().locator(`[data-testid="dispatch-task-node"][data-task-id="${old.checkpointTaskId}"]`);await node.waitFor();await node.click();
    const detail=active().locator('.member-task-detail');await detail.getByTestId('owner-binding-legacy').waitFor();
    assert.equal(await detail.getByTestId('owner-execution-binding').count(),0);
    await detail.getByTestId('owner-inspect-current').click();
    await until(async()=>(await detail.getByTestId('owner-current-result').getAttribute('data-comparison'))==='legacy','explicit legacy observation');
    await detail.getByTestId('owner-binding-legacy').scrollIntoViewIfNeeded();return detail;
  };
  await launch();await page.waitForFunction(()=>!!(window as any).cbim);
  await until(async()=>{const records=await ownerExecutionRecords(legacy.user,id);return records.runs.every(run=>run.status!=='running'&&run.status!=='starting')&&(await call('runtime.snapshot')).pressure.activeRuns===0},'old active intent reconciled without new model');
  const records=await ownerExecutionRecords(legacy.user,id),queuedIdentity={workspaceId:id,rootSessionId:old.queued.input.rootSessionId,taskId:old.queued.receipt.taskId};
  const queued=await call<GraphSnapshot>('dispatch.graphSnapshot',{identity:{workspaceId:id,rootSessionId:queuedIdentity.rootSessionId}});assert.deepEqual(queued,old.queuedGraph);
  const beforeRead=(await knowledgeSourceDiskEvidence(legacy.user,id)).dispatchBytes;
  assert.deepEqual(await call('dispatch.task',old.queued.input),old.queued.receipt);
  let claimError='';try{await call('dispatch.executionStart',{...queuedIdentity,commandId:randomUUID(),expectedRevision:queued.tasks[0].revision,options:{permission:'read'}})}catch(error){claimError=String(error)}
  assert.match(claimError,/OWNER_BINDING_REQUIRED/);assert.deepEqual((await knowledgeSourceDiskEvidence(legacy.user,id)).dispatchBytes,beforeRead);
  const live=records.runs.find(run=>run.binding.runId===old.run.runId)!;assert.equal(live.status,'interrupted');assert.equal(live.prepared.memberContext,undefined);
  const oldLive=old.records.runs.find(run=>run.binding.runId===live.binding.runId)!;assert.deepEqual(live.binding,oldLive.binding);assert.deepEqual(live.model,oldLive.model);assert.deepEqual(live.prepared,oldLive.prepared);
  const parked=await call<GraphSnapshot>('dispatch.graphSnapshot',{identity:{workspaceId:id,rootSessionId:old.main.taskId}}),parkedTask=parked.tasks.find(task=>task.taskId===old.checkpointTaskId)!;
  assert.deepEqual(parkedTask.checkpoints,old.parked.tasks.find(task=>task.taskId===old.checkpointTaskId)!.checkpoints);assert.equal(parkedTask.ownerBinding,undefined);
  const detail=await openCheckpoint();
  await until(async()=>(await active().locator(`[data-testid="dispatch-task-node"][data-task-id="${old.checkpointTaskId}"]`).getAttribute('data-status'))===parkedTask.status,'old checkpoint graph final status');
  await screenshot('checkpoint-history');await detail.getByTestId('member-checkpoint').scrollIntoViewIfNeeded();await screenshot('checkpoint-original-proof');
  await active().getByRole('tab',{name:'对话',exact:true}).click();await input().fill(draft);
  const bytes=await Promise.all(legacy.originalRunBytes.map(async row=>{const native=await fs.readFile(row.sessionFile),canonical=await fs.readFile(row.canonicalPath);assert.deepEqual(native,row.native);assert.deepEqual(canonical.subarray(0,row.canonical.length),row.canonical);return {taskId:row.taskId,runId:row.runId,native,canonical}}));
  assert.deepEqual(legacy.counts(),old.requestCounts);const stable=(await knowledgeSourceDiskEvidence(legacy.user,id)).dispatchBytes;
  await desktop!.close();desktop=undefined;await launch();await page.waitForFunction(()=>!!(window as any).cbim);await openCheckpoint();
  await screenshot('restored-legacy');await active().getByRole('tab',{name:'对话',exact:true}).click();assert.equal(await input().inputValue(),draft);
  assert.deepEqual(await ownerExecutionRecords(legacy.user,id),records);assert.deepEqual((await knowledgeSourceDiskEvidence(legacy.user,id)).dispatchBytes,stable);
  for(const [index,row] of legacy.originalRunBytes.entries()){assert.deepEqual(await fs.readFile(row.sessionFile),bytes[index].native);assert.deepEqual(await fs.readFile(row.canonicalPath),bytes[index].canonical)}
  assert.deepEqual(legacy.counts(),old.requestCounts);assert.deepEqual(legacy.providerErrors(),[]);assert.deepEqual(pageErrors,[]);assert.deepEqual(transportErrors,[]);
  report={packagedExe:exe,oldExecutable:old.executable,workspaceId:id,temp:legacy.temp,oldTestPidTerminated:old.killedPid,oldStatesCreatedThroughRealExe:true,originalReceiptStable:true,legacyClaim:{method:'explicit IPC; no new UI execution action',error:claimError},checkpointUiReadOnly:true,oldRunningStatus:live.status,noOwnerBindingBackfill:true,originalModelsAndPreparedPreserved:true,originalNativeBytesPreserved:true,canonicalOriginalPrefixesPreserved:true,ordinaryDraftPreserved:true,restartWithoutReplay:true,newExecutableModelRequests:0,oldSeedRequestCounts:old.requestCounts,actualFinalCounts:legacy.counts(),runBytes:bytes.map(row=>({taskId:row.taskId,runId:row.runId,canonical:{bytes:row.canonical.length,sha256:digest(row.canonical)},native:{bytes:row.native.length,sha256:digest(row.native)}})),pageErrors,transportErrors,providerErrors:legacy.providerErrors(),screenshots,cleanup};passed=true;
}catch(error){
  const dom=desktop?await desktop.firstWindow().then(window=>window.locator('body').innerText()).catch(()=>undefined):undefined;
  if(desktop)await desktop.firstWindow().then(window=>window.screenshot({path:`test-results/${artifact}-ui-failure.png`})).catch(()=>{});
  await fs.writeFile(`test-results/${artifact}-ui-failure.json`,JSON.stringify({packagedExe:exe,oldExecutable:old.executable,temp:legacy.temp,error:String(error),dom,counts:legacy.counts(),pageErrors,transportErrors,providerErrors:legacy.providerErrors(),retained:true},null,2));throw error;
}finally{
  if(desktop)await desktop.close();cleanup.desktopClosed=true;await legacy.cleanup(passed);cleanup.providersClosed=true;cleanup.tempRemoved=passed;
  if(report){await fs.writeFile(`test-results/${artifact}-ui-smoke.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report))}
}
