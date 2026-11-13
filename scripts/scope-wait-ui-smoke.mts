import {_electron as electron,type ElectronApplication,type Locator} from 'playwright-core';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {execFileSync} from 'node:child_process';
import {Application} from '../src/bridge/server/application';
import {Paths} from '../src/logic/workspace/service/paths';
import type {DispatchScope} from '../src/logic/tasks/rules/dispatch-scope';
import {seedTeam} from '../tests/team-fixture';
import {registerExplicitFixtureOwner} from '../tests/explicit-owner-fixture';
import {request} from '../tests/data/knowledge';
import {scopeWaitProvider,waitFixture} from '../tests/scope-wait-provider';
import {latestExecutable} from './build-artifact.mjs';

// Real packaged Electron and native Pi. The local model supplies deterministic responses,
// while evidence, checkpoints, leases, queue mutations and restart recovery use product code.
// --crash kills only this script's isolated Electron process after every model has settled.
const crash=process.argv.includes('--crash'),artifact='scope-wait'+(crash?'-crash':'');
const exe=await latestExecutable(),temp=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-scope-wait-ui-'));
const project=path.join(temp,'project'),user=path.join(temp,'user');await fs.mkdir(project);
await fs.writeFile(path.join(project,'wait-input.txt'),waitFixture.fact);
const provider=await scopeWaitProvider({holdFinal:true}),pageErrors:string[]=[];
let desktop:ElectronApplication|undefined,setup:Application|undefined;
let keepTemp=false;
const desktopProcesses:{pid:number;stderr:string[]}[]=[],crashProcesses:unknown[]=[];
function observeDesktop(app:ElectronApplication){const child=app.process(),record={pid:child.pid!,stderr:[] as string[]};desktopProcesses.push(record);child.stderr?.on('data',chunk=>record.stderr.push(String(chunk)))}
function processTree(pid:number){return JSON.parse(execFileSync('powershell.exe',['-NoProfile','-Command',`Get-CimInstance Win32_Process -Filter 'ProcessId=${pid} OR ParentProcessId=${pid}' | Select-Object ProcessId,ParentProcessId,Name,ExecutablePath,CommandLine | ConvertTo-Json -Depth 3`],{encoding:'utf8',windowsHide:true}).trim()||'[]')}
try{
  setup=new Application(new Paths(user,path.resolve('.')),path.resolve('design'));await setup.init();
  await setup.models.save({profile:{name:'Local scope waiting UI',api:'openai-completions',baseUrl:provider.url,auth:'none',defaultModel:'wait-fixture',models:[{id:'wait-fixture',name:'Wait fixture',enabled:true,contextWindow:65536,maxTokens:4096,reasoning:false,pricing:{input:0,output:0,cacheRead:0,cacheWrite:0}}]}});
  const entry=await setup.dispatch('add',{path:project}),workspace=setup.workspace(entry.id),team=await seedTeam(workspace);
  const knowledge=await workspace.snapshot(),modulePath=team.input.moduleId+'/module.json',definition=JSON.parse(knowledge.files.find(file=>file.path===modulePath)!.text);
  definition.maintenance={bindingId:'wait-ui-maintainer',maintainerPersonIds:['owner'],revision:1,state:'active',confirmation:{recordId:'wait-ui-review',source:'local_user',confirmedAt:new Date().toISOString()}};
  await workspace.commit(request(knowledge,[{path:modulePath,text:JSON.stringify(definition)},{path:'.cbim/team/people.json',text:JSON.stringify({people:[{id:'owner',name:'维护人',team:'.cbim/team'}]})}]));
  const owner=await registerExplicitFixtureOwner(setup,entry.id,{agentId:team.input.agentId,moduleIds:[team.input.moduleId],profileId:(await setup.models.list()).selectedId!,modelId:'wait-fixture'});
  provider.bind(team.input.agentId,team.input.moduleId,owner.selection);
  await setup.shutdown();setup=undefined;
  const scopes=async()=>{
    const raw=await fs.readFile(path.join(user,entry.id,'dispatch','dispatch.jsonl'),'utf8'),found=new Map<string,DispatchScope>();
    // Read committed lines only; never instantiate another writer against the live app's store.
    for(const line of raw.slice(0,raw.lastIndexOf('\n')).split('\n').filter(Boolean)){const {body}=JSON.parse(line);assert.equal(body.workspaceId,entry.id);for(const scope of body.mutation.scopes??[])found.set(scope.scopeId,scope)}
    return [...found.values()];
  };
  const waitScope=async(status:DispatchScope['status'])=>{
    const deadline=Date.now()+30000;
    while(Date.now()<deadline){const records=await scopes();if(records.length===1&&records[0].status===status)return records[0];await new Promise(resolve=>setTimeout(resolve,50))}
    throw Error('等待目标状态超时：'+status+' '+JSON.stringify(await scopes()));
  };
  desktop=await electron.launch({executablePath:exe,env:{...process.env,CBIM_USER_DATA_ROOT:user},timeout:60000});
  observeDesktop(desktop);
  let page=await desktop.firstWindow();page.setDefaultTimeout(30000);page.on('pageerror',error=>pageErrors.push(error.message));
  const call=(action:string,args:unknown={})=>page.evaluate(({action,args})=>(window as any).cbim.call(action,args),{action,args});
  const active=()=>page.locator('.workspace-panel:not([hidden])'),panel=()=>active().getByTestId('conversation-goal-summary');
  async function expandDetails(container:Locator){const details=container.getByTestId('scope-goal-details');if(await details.count()&&await details.getAttribute('open')===null)await details.locator(':scope > summary').click()}
  const openProject=()=>page.getByRole('button',{name:'project · 运行中',exact:true}).click();
  await openProject();await active().getByRole('textbox',{name:'对话草稿',exact:true}).fill(waitFixture.mainGoal);await active().getByRole('button',{name:'发送消息',exact:true}).click();
  await active().getByText(waitFixture.liveFinal,{exact:false}).waitFor();
  const records=await call('loop.list',{id:entry.id}),rootSessionId=records.find((record:any)=>record.task?.goal===waitFixture.mainGoal)?.task.taskId;assert.equal(typeof rootSessionId,'string');
  const identity={workspaceId:entry.id,rootSessionId},live=(await scopes())[0];
  assert.equal(live.status,'active');assert.equal(live.goal?.review?.decision,'awaiting_user');assert.equal(live.wait,undefined);
  await active().locator('[data-testid="conversation-goal-summary"][data-goal-state="awaiting_user"]').waitFor();
  assert.equal(await panel().getByTestId('scope-goal-status').innerText(),'已请求补充 · 等待暂停确认');
  await fs.mkdir('test-results',{recursive:true});await panel().getByTestId('scope-goal-status').scrollIntoViewIfNeeded();await page.screenshot({path:`test-results/${artifact}-pending.png`});
  provider.releaseFinal();const checkpoint=await waitScope('waiting');
  await active().locator('[data-testid="conversation-goal-summary"][data-goal-state="waiting"]').waitFor();
  await active().getByTestId('conversation-waiting').waitFor();
  assert.equal(await panel().getByTestId('scope-goal-status').innerText(),'等待补充 · 执行已暂停');
  assert.ok((await panel().getByTestId('scope-goal-waiting').innerText()).includes(waitFixture.waitReason));
  assert.equal(checkpoint.scopeId,live.scopeId);assert.deepEqual(checkpoint.goal?.input,{message:waitFixture.mainGoal,attachmentIds:[]});assert.equal(checkpoint.goal?.revision,3);
  const thread=await call('loop.thread',{id:entry.id,taskId:rootSessionId}),graph=await call('dispatch.graphSnapshot',{identity});
  assert.equal(thread.length,2);assert.ok(thread.every((run:any)=>run.status==='completed'));assert.deepEqual(checkpoint.wait?.mainRunIds,thread.map((run:any)=>run.runId));assert.equal(checkpoint.wait?.runId,thread[1].runId);
  assert.equal(graph.tasks.length,1);assert.equal(graph.tasks[0].status,'result_ready');assert.equal(graph.tasks[0].result.acceptance,'not_evaluated');
  assert.equal(checkpoint.goal?.review?.checks.find(check=>check.criterionId===waitFixture.humanId)?.outcome,'needs_human');
  assert.equal((await call('runtime.snapshot')).pressure.activeRuns,0);
  assert.equal(provider.mainRequests.length,6);assert.equal(provider.memberRequests.length,5);
  const count=provider.mainRequests.length+provider.memberRequests.length;
  await active().getByTestId('conversation-activity').filter({hasText:/^等待补充 · 执行已暂停$/}).waitFor();
  await page.waitForFunction(()=>document.querySelectorAll('.workspace-panel:not([hidden]) .chat-turn .work-outcome.running').length===0);
  assert.equal(await active().getByTestId('conversation-activity').locator('.usage-sparkle').count(),0);
  const waitingMetrics=await active().locator('.usage-above .usage-trigger').innerText();
  await expandDetails(panel());assert.ok((await panel().getByTestId('scope-goal-wait-detail').innerText()).includes(waitFixture.waitReason));
  assert.equal(await active().getByRole('button',{name:'取消当前任务',exact:true}).isEnabled(),true);
  assert.equal(await active().getByRole('button',{name:/恢复.*任务|恢复.*执行/}).count(),0);
  await panel().getByTestId('scope-goal-status').scrollIntoViewIfNeeded();await page.screenshot({path:`test-results/${artifact}-waiting.png`});
  await active().getByRole('tab',{name:'任务视图',exact:true}).click();await active().getByTestId('dispatch-root-node').click();
  const rootGoal=active().getByTestId('dispatch-root-goal');await rootGoal.waitFor();assert.equal(await rootGoal.getAttribute('data-goal-state'),'waiting');assert.equal(await rootGoal.getAttribute('data-scope-id'),checkpoint.scopeId);
  assert.equal(await active().getByTestId('scope-stop').isEnabled(),true);assert.equal(await active().getByTestId('scope-stop').innerText(),'取消当前任务');
  await page.screenshot({path:`test-results/${artifact}-root-waiting.png`});await active().getByRole('tab',{name:'对话',exact:true}).click();
  for(const message of ['同意','仅整理排队资料']){await active().getByRole('textbox',{name:'对话草稿',exact:true}).fill(message);await active().getByRole('button',{name:'加入队列',exact:true}).click();await active().locator('.message-queue').getByText(message,{exact:true}).waitFor()}
  const queue=()=>call('loop.queue',{id:entry.id,taskId:rootSessionId});
  assert.deepEqual((await queue()).map((item:any)=>({message:item.message,status:item.status})),[{message:'同意',status:'paused'},{message:'仅整理排队资料',status:'paused'}]);
  assert.equal(await active().getByRole('button',{name:'继续队列',exact:true}).isDisabled(),true);assert.equal(await active().getByRole('button',{name:/插入第 .* 条到当前任务/}).count(),0);
  await active().getByRole('button',{name:'编辑第 2 条消息',exact:true}).click();await active().getByRole('textbox',{name:'编辑排队消息',exact:true}).fill('补充资料稍后处理');await active().locator('.queue-editor').getByRole('button',{name:'保存',exact:true}).click();
  await active().locator('.message-queue').getByText('补充资料稍后处理',{exact:true}).waitFor();
  await active().getByRole('button',{name:'拖动第 2 条消息排序',exact:true}).press('Alt+ArrowUp');
  await page.waitForFunction(()=>document.querySelector('.message-queue .queue-text')?.textContent==='补充资料稍后处理');
  await active().getByRole('button',{name:'删除第 1 条消息',exact:true}).click();await active().locator('.message-queue').getByText('补充资料稍后处理',{exact:true}).waitFor({state:'hidden'});
  assert.deepEqual((await queue()).map((item:any)=>item.message),['同意']);
  await assert.rejects(()=>call('loop.queueContinue',{id:entry.id,taskId:rootSessionId}),/GOAL_WAITING/);
  assert.deepEqual(await scopes(),[checkpoint]);assert.equal(provider.mainRequests.length+provider.memberRequests.length,count);
  assert.equal((await call('runtime.snapshot')).pressure.activeRuns,0);
  assert.equal(await active().locator('.usage-above .usage-trigger').innerText(),waitingMetrics,'等待补充期间工作时间与生成速度不得继续变化');
  await page.screenshot({path:`test-results/${artifact}-queued.png`});
  if(crash){
    // On Windows Playwright may expose a cmd.exe launcher rather than Electron itself.
    // Resolve the actual main PID inside Electron before killing only this isolated app tree.
    const launcher=desktop.process(),exited=once(launcher,'exit'),mainPid=await desktop.evaluate(()=>process.pid);assert.ok(mainPid&&mainPid!==process.pid);
    const tree=processTree(mainPid),nodes=Array.isArray(tree)?tree:[tree];assert.ok(nodes.some(node=>node.ProcessId===mainPid&&node.Name==='CBIM.exe'));crashProcesses.push(tree);
    execFileSync('taskkill.exe',['/PID',String(mainPid),'/T','/F'],{windowsHide:true,stdio:'pipe'});await exited;desktop=undefined;
  }else{await desktop.close();desktop=undefined}
  assert.deepEqual(await scopes(),[checkpoint]);
  desktop=await electron.launch({executablePath:exe,env:{...process.env,CBIM_USER_DATA_ROOT:user},timeout:60000});
  observeDesktop(desktop);
  page=await desktop.firstWindow();page.setDefaultTimeout(30000);page.on('pageerror',error=>pageErrors.push(error.message));
  await page.waitForFunction(()=>!!(window as any).cbim);
  const restoredCatalog=await call('list'),restoredWorkspace=restoredCatalog.entries.find((item:any)=>item.id===entry.id);
  assert.equal(restoredWorkspace?.state,'running','重启后的工作区错误：'+JSON.stringify(restoredWorkspace));
  await openProject();await page.locator('.workspace-conversations button').filter({hasText:waitFixture.mainGoal}).first().click();
  await active().locator('[data-testid="conversation-goal-summary"][data-goal-state="waiting"]').waitFor();await active().getByTestId('conversation-waiting').waitFor();
  assert.deepEqual(await scopes(),[checkpoint]);const restored=await call('dispatch.graphSnapshot',{identity});assert.deepEqual(restored.root.agent,graph.root.agent);assert.deepEqual(restored.tasks,graph.tasks);
  assert.equal((await call('loop.thread',{id:entry.id,taskId:rootSessionId})).length,2);assert.equal((await call('runtime.snapshot')).pressure.activeRuns,0);
  assert.deepEqual((await queue()).map((item:any)=>({message:item.message,status:item.status})),[{message:'同意',status:'paused'}]);assert.equal(await active().getByRole('button',{name:'继续队列',exact:true}).isDisabled(),true);
  assert.equal(provider.mainRequests.length+provider.memberRequests.length,count);
  await panel().getByTestId('scope-goal-status').scrollIntoViewIfNeeded();await page.screenshot({path:`test-results/${artifact}-restored.png`});
  await active().getByRole('button',{name:'取消当前任务',exact:true}).click();const cancelled=await waitScope('closed');
  assert.equal(cancelled.outcome,'cancelled');assert.deepEqual(cancelled.wait,checkpoint.wait);assert.deepEqual(cancelled.goal,checkpoint.goal);
  await active().locator('[data-testid="conversation-goal-summary"][data-goal-state="cancelled"]').waitFor();
  const runtime=await call('runtime.snapshot');assert.equal(runtime.pressure.activeRuns,0);assert.equal(runtime.members.find((member:any)=>member.agentInstanceId===graph.tasks[0].assignee.agentInstanceId)?.lifecycle,'released');const main=runtime.members.find((member:any)=>member.agentInstanceId===graph.root.agent.agentInstanceId);assert.ok(main);assert.notEqual(main.lifecycle,'released');
  assert.ok((await queue()).every((item:any)=>item.status==='paused'));assert.equal(provider.mainRequests.length+provider.memberRequests.length,count);
  assert.equal(await active().getByRole('button',{name:'取消当前任务',exact:true}).count(),0);
  await panel().getByTestId('scope-goal-status').scrollIntoViewIfNeeded();await page.screenshot({path:`test-results/${artifact}-cancelled.png`});
  assert.deepEqual(pageErrors,[]);assert.deepEqual(provider.errors,[]);
  const report={packagedExe:exe,realPi:true,realProvider:false,crashRestart:crash,normalRestart:!crash,awaitingUserNotYetPaused:true,checkpointPreserved:true,originalInputPreserved:true,mainRunCounterPreserved:true,waitingNoActiveModel:true,waitingNoAnimationOrGrowingWorkTime:true,queueDoesNotAcceptOrResume:true,queueEditSortDelete:true,restartWithoutReplay:true,waitingCancelled:true,executorReleased:true,mainRetained:true,queuePaused:true,mainRequests:provider.mainRequests.length,memberRequests:provider.memberRequests.length,pageErrors,transportErrors:provider.errors};
  await fs.writeFile(`test-results/${artifact}-ui-smoke.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}catch(error){
  keepTemp=true;
  await fs.mkdir('test-results',{recursive:true});if(desktop)await desktop.firstWindow().then(page=>page.screenshot({path:`test-results/${artifact}-failure.png`})).catch(()=>{});
  const state=desktop?await desktop.firstWindow().then(page=>page.evaluate(()=>(window as any).cbim.call('list'))).catch(error=>String(error)):undefined;
  await fs.writeFile(`test-results/${artifact}-ui-failure.json`,JSON.stringify({packagedExe:exe,temp,user,error:String(error),workspaceState:state,desktopProcesses,crashProcesses,mainRequests:provider.mainRequests.length,memberRequests:provider.memberRequests.length,pageErrors,transportErrors:provider.errors},null,2));throw error;
}finally{
  provider.releaseFinal();if(desktop)await desktop.close().catch(()=>{});if(setup)await setup.shutdown();await provider.close();
  if(!keepTemp){const target=path.resolve(temp);assert.equal(path.dirname(target),path.resolve(os.tmpdir()));assert.ok(path.basename(target).startsWith('cbim-scope-wait-ui-'));await fs.rm(target,{recursive:true,force:true})}
}
