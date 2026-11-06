import {_electron as electron,type ElectronApplication} from 'playwright-core';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Application} from '../src/backend/main/application';
import {Paths} from '../src/backend/main/platform/paths';
import type {DispatchScope} from '../src/backend/core/tasks/dispatch-scope';
import type {GoalContinuationRequest} from '../src/backend/core/tasks/scope-continuation';
import {seedTeam} from '../tests/team-fixture';
import {request} from '../tests/helpers';
import {scopeContinuationProvider,continuationFixture as data} from '../tests/scope-continuation-provider';
import {latestExecutable} from './build-artifact.mjs';

// Real packaged UI + Pi; only the model's responses are deterministic and local.
// --stop cancels the first resumed model stream, preserving the consumed intent rather than replaying it.
const stopping=process.argv.includes('--stop'),unknown=process.argv.includes('--unknown'),artifact='scope-continuation'+(stopping?'-stop':unknown?'-unknown':'');
assert.ok(!(stopping&&unknown),'停止和未知回执分别验证');
const exe=await latestExecutable(),temp=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-scope-continuation-ui-'));
const project=path.join(temp,'project'),user=path.join(temp,'user');await fs.mkdir(project);await fs.writeFile(path.join(project,'continue-input.txt'),data.fact);
const provider=await scopeContinuationProvider({holdContinuation:true}),pageErrors:string[]=[];
const draft='主输入框保留的下一任务草稿，不作为本次目标补充';
let desktop:ElectronApplication|undefined,setup:Application|undefined,keepTemp=false;
try{
  setup=new Application(new Paths(user,path.resolve('.')),path.resolve('design'));await setup.init();
  await setup.models.save({profile:{name:'Local continuation UI',api:'openai-completions',baseUrl:provider.url,auth:'none',defaultModel:'continue-fixture',models:[{id:'continue-fixture',name:'Continue fixture',enabled:true,contextWindow:65536,maxTokens:4096,reasoning:false,pricing:{input:0,output:0,cacheRead:0,cacheWrite:0}}]}});
  const profileId=(await setup.models.list()).selectedId!,entry=await setup.dispatch('add',{path:project}),workspace=setup.workspace(entry.id),team=await seedTeam(workspace);provider.bind(team.input.agentId,team.input.moduleId);
  const knowledge=await workspace.snapshot(),modulePath=team.input.moduleId+'/module.json',definition=JSON.parse(knowledge.files.find(file=>file.path===modulePath)!.text);
  definition.maintenance={bindingId:'continue-ui-maintainer',maintainerPersonIds:['owner'],revision:1,state:'active',confirmation:{recordId:'continue-ui-review',source:'local_user',confirmedAt:new Date().toISOString()}};
  await workspace.commit(request(knowledge,[{path:modulePath,text:JSON.stringify(definition)},{path:'.cbim/team/people.json',text:JSON.stringify({people:[{id:'owner',name:'维护人',team:'.cbim/team'}]})}]));await setup.shutdown();setup=undefined;
  const scopes=async()=>{
    const raw=await fs.readFile(path.join(user,entry.id,'dispatch','dispatch.jsonl'),'utf8'),found=new Map<string,DispatchScope>();
    for(const line of raw.slice(0,raw.lastIndexOf('\n')).split('\n').filter(Boolean)){const {body}=JSON.parse(line);assert.equal(body.workspaceId,entry.id);for(const scope of body.mutation.scopes??[])found.set(scope.scopeId,scope)}return [...found.values()];
  };
  const waitUntil=async(check:()=>Promise<boolean>,label:string)=>{const deadline=Date.now()+30000;while(Date.now()<deadline){if(await check())return;await new Promise(resolve=>setTimeout(resolve,50))}throw Error('等待验收超时：'+label)};
  desktop=await electron.launch({executablePath:exe,env:{...process.env,CBIM_USER_DATA_ROOT:user},timeout:60000});
  let page=await desktop.firstWindow();page.setDefaultTimeout(30000);page.on('pageerror',error=>pageErrors.push(error.message));
  const call=(action:string,args:unknown={})=>page.evaluate(({action,args})=>(window as any).cbim.call(action,args),{action,args});
  const active=()=>page.locator('.workspace-panel:not([hidden])'),panel=()=>active().getByTestId('conversation-goal-summary');
  const input=()=>active().getByRole('textbox',{name:'对话草稿',exact:true});
  await page.getByRole('button',{name:'project · 运行中',exact:true}).click();await input().fill(data.mainGoal);await active().getByRole('button',{name:'发送消息',exact:true}).click();
  await active().locator('[data-testid="conversation-goal-summary"][data-goal-state="waiting"]').waitFor();await panel().getByTestId('scope-continuation-input').waitFor();
  const original=(await scopes())[0],rootSessionId=original.rootSessionId,identity={workspaceId:entry.id,rootSessionId};assert.equal(original.status,'waiting');assert.equal(provider.mainRequests.length,6);assert.equal(provider.memberRequests.length,5);
  const originalGraph=await call('dispatch.graphSnapshot',{identity}),queue=()=>call('loop.queue',{id:entry.id,taskId:rootSessionId});
  await input().fill(data.queuedGoal);await active().getByRole('button',{name:'加入队列',exact:true}).click();await active().locator('.message-queue').getByText(data.queuedGoal,{exact:true}).waitFor();
  assert.equal((await queue())[0].status,'paused');await input().fill(draft);
  await active().getByRole('combobox',{name:'执行权限',exact:true}).click();await active().getByRole('option',{name:/只读访问/}).click();
  await panel().getByTestId('scope-continuation-input').fill(data.supplement);
  assert.ok((await panel().getByTestId('scope-continuation-model').innerText()).includes('只读访问'));
  await active().getByRole('tab',{name:'任务视图',exact:true}).click();await active().getByTestId('dispatch-root-node').click();
  const root=active().getByTestId('dispatch-root-goal');assert.equal(await root.getByTestId('scope-continuation-input').inputValue(),data.supplement);
  await fs.mkdir('test-results',{recursive:true});await root.getByTestId('scope-continuation-input').scrollIntoViewIfNeeded();await page.screenshot({path:`test-results/${artifact}-shared-form.png`});
  await active().getByRole('tab',{name:'对话',exact:true}).click();assert.equal(await input().inputValue(),draft);
  await panel().getByTestId('scope-continuation-input').scrollIntoViewIfNeeded();await page.screenshot({path:`test-results/${artifact}-waiting-form.png`});
  if(unknown){
    // Fault injection only in this isolated renderer's local record: crash after saving a request
    // but before sending IPC. No accepted receipt, server record or backend history is fabricated.
    const request:GoalContinuationRequest={...identity,scopeId:original.scopeId,waitId:original.wait!.waitId,expectedGoalRevision:original.goal!.revision,expectedInputRevision:original.goal!.inputRevision??1,commandId:randomUUID(),input:{message:data.supplement},options:{provider:'cbim-'+profileId,model:'continue-fixture',profileId,permission:'read'}};
    await page.evaluate(({request})=>{const key='cbim.goal-continuation.v1.'+JSON.stringify([request.workspaceId,request.rootSessionId]);const saved=JSON.parse(localStorage.getItem(key)!);const record=saved.records.find((item:any)=>item.scopeId===request.scopeId&&item.waitId===request.waitId);if(!record||record.attempt)throw Error('仅向未提交草稿注入故障');record.attempt={request,phase:'submitting',uncertain:false};localStorage.setItem(key,JSON.stringify(saved))},{request});
    assert.equal(await call('loop.goalContinuation',{...identity,scopeId:request.scopeId,commandId:request.commandId}),undefined);assert.equal(provider.mainRequests.length,6);
  }
  await desktop.close();desktop=undefined;
  desktop=await electron.launch({executablePath:exe,env:{...process.env,CBIM_USER_DATA_ROOT:user},timeout:60000});page=await desktop.firstWindow();page.setDefaultTimeout(30000);page.on('pageerror',error=>pageErrors.push(error.message));
  await page.getByRole('button',{name:'project · 运行中',exact:true}).click();await page.locator('.workspace-conversations button').filter({hasText:data.mainGoal}).first().click();
  await active().locator('[data-testid="conversation-goal-summary"][data-goal-state="waiting"]').waitFor();assert.deepEqual(await scopes(),[original]);assert.equal(await input().inputValue(),draft);assert.equal(await panel().getByTestId('scope-continuation-input').inputValue(),data.supplement);assert.equal(provider.mainRequests.length,6);
  if(unknown){
    await panel().getByTestId('scope-continuation-unknown').waitFor();assert.equal(await panel().getByTestId('scope-continuation-input').getAttribute('readonly'),'');assert.equal(await panel().getByTestId('scope-continuation-submit').count(),0);
    await panel().getByTestId('scope-continuation-query').click();await panel().getByTestId('scope-continuation-unknown').waitFor();assert.deepEqual(await scopes(),[original]);assert.equal(provider.mainRequests.length,6);
    await panel().getByTestId('scope-continuation-unknown').scrollIntoViewIfNeeded();await page.screenshot({path:`test-results/${artifact}-unknown.png`});
    await panel().getByTestId('scope-continuation-retry').click();
  }else{
    // Two immediate clicks must keep the controller's same command, not create two model rounds.
    await page.waitForFunction(()=>{const button=document.querySelector<HTMLButtonElement>('.workspace-panel:not([hidden]) [data-testid="conversation-goal-summary"] [data-testid="scope-continuation-submit"]');return !!button&&!button.disabled});
    await panel().getByTestId('scope-continuation-submit').evaluate((button:HTMLButtonElement)=>{button.click();button.click()});
  }
  await panel().getByTestId('scope-continuation-accepted').waitFor();await active().getByText(data.liveContinuation,{exact:false}).waitFor();
  const accepted=(await scopes())[0];assert.equal(accepted.scopeId,original.scopeId);assert.equal(accepted.status,'active');assert.deepEqual(accepted.goal?.input,original.goal?.input);assert.equal(accepted.goal?.inputRevision,2);assert.equal(accepted.continuations?.length,1);assert.equal(provider.mainRequests.length,7);assert.equal(provider.memberRequests.length,5);
  const frozen=await page.evaluate(({workspaceId,rootSessionId,scopeId})=>{const key='cbim.goal-continuation.v1.'+JSON.stringify([workspaceId,rootSessionId]);const saved=JSON.parse(localStorage.getItem(key)!);return saved.records.find((record:any)=>record.scopeId===scopeId).attempt.request},{...identity,scopeId:original.scopeId}) as GoalContinuationRequest;
  assert.equal(frozen.options.permission,'read');assert.equal(frozen.options.profileId,profileId);assert.equal(frozen.options.model,'continue-fixture');assert.equal(frozen.input.message,data.supplement);assert.equal(frozen.commandId,accepted.continuations![0].continuationId);
  const duplicate=await call('loop.goalContinue',frozen);assert.deepEqual(duplicate.continuation,accepted.continuations![0]);assert.equal(provider.mainRequests.length,7);
  assert.equal(await input().inputValue(),draft);assert.equal((await queue())[0].message,data.queuedGoal);assert.equal((await queue())[0].status,'paused');
  assert.equal((await queue())[0].reason,'原目标已接收补充，后续消息仍暂停；目标结束后可继续队列');
  await panel().getByTestId('scope-continuation-query').click();await panel().getByTestId('scope-continuation-accepted').waitFor();assert.equal(provider.mainRequests.length,7);
  await panel().getByTestId('scope-continuation-accepted').scrollIntoViewIfNeeded();await page.screenshot({path:`test-results/${artifact}-accepted.png`});
  if(stopping)await active().getByRole('button',{name:'停止执行',exact:true}).click();else provider.releaseContinuation();
  await waitUntil(async()=>(await scopes())[0].status==='closed','原目标关闭');
  const resolved=(await scopes())[0];assert.equal(resolved.scopeId,original.scopeId);assert.deepEqual(resolved.goal?.input,original.goal?.input);assert.deepEqual(resolved.continuations,accepted.continuations);assert.equal(resolved.outcome,stopping?'cancelled':'completed');
  await active().locator(`[data-testid="conversation-goal-summary"][data-goal-state="${stopping?'cancelled':'completed'}"]`).waitFor();
  assert.equal(await input().inputValue(),draft);assert.equal((await queue())[0].status,'paused');assert.equal(provider.mainRequests.length,stopping?7:12);assert.equal(provider.memberRequests.length,5);
  const thread=await call('loop.thread',{id:entry.id,taskId:rootSessionId});assert.equal(thread.length,3);assert.equal(thread[2].source.kind,'user-continuation');assert.equal(thread[2].source.continuationId,frozen.commandId);assert.equal(thread[2].events.find((event:any)=>event.type==='run.started').data.message,data.supplement);
  assert.equal((await call('runtime.snapshot')).pressure.activeRuns,0);assert.deepEqual((await call('dispatch.graphSnapshot',{identity})).root.agent,originalGraph.root.agent);
  assert.deepEqual((await call('loop.goalContinue',frozen)).continuation,accepted.continuations![0]);assert.equal(provider.mainRequests.length,stopping?7:12);
  assert.equal(await panel().getByTestId('scope-continuation-submit').count(),0,'历史目标不能重新提交补充');
  await active().getByTestId('conversation-activity').filter({hasText:stopping?/^本轮已停止$/:/^目标已完成$/}).waitFor();
  await panel().getByTestId('scope-goal-status').scrollIntoViewIfNeeded();await page.screenshot({path:`test-results/${artifact}-settled.png`});
  if(!stopping){
    await active().getByRole('button',{name:'继续队列',exact:true}).click();await active().getByText(data.queuedFinal,{exact:true}).waitFor();
    await waitUntil(async()=>{const all=await scopes();return all.length===2&&all[1].status==='closed'},'独立排队目标完成');const queuedScope=(await scopes())[1];assert.notEqual(queuedScope.scopeId,original.scopeId);assert.equal(queuedScope.goal?.input.message,data.queuedGoal);assert.equal(queuedScope.outcome,'completed');assert.deepEqual(await queue(),[]);assert.equal(await input().inputValue(),draft);assert.equal(provider.mainRequests.length,13);
  }
  const persisted=await scopes(),count=provider.mainRequests.length+provider.memberRequests.length;
  await desktop.close();desktop=undefined;desktop=await electron.launch({executablePath:exe,env:{...process.env,CBIM_USER_DATA_ROOT:user},timeout:60000});page=await desktop.firstWindow();page.setDefaultTimeout(30000);page.on('pageerror',error=>pageErrors.push(error.message));
  await page.getByRole('button',{name:'project · 运行中',exact:true}).click();await page.locator('.workspace-conversations button').filter({hasText:data.mainGoal}).first().click();await panel().waitFor();
  await panel().getByTestId('scope-history-select').selectOption(original.scopeId);await active().locator(`[data-testid="conversation-goal-summary"][data-goal-state="${stopping?'cancelled':'completed'}"]`).waitFor();
  assert.deepEqual(await scopes(),persisted);assert.equal(await input().inputValue(),draft);assert.equal(provider.mainRequests.length+provider.memberRequests.length,count);assert.equal(await panel().getByTestId('scope-continuation-submit').count(),0);
  await panel().getByTestId('scope-continuation-query').click();await panel().getByTestId('scope-continuation-accepted').waitFor();assert.equal(provider.mainRequests.length+provider.memberRequests.length,count);
  await panel().getByTestId('scope-goal-status').scrollIntoViewIfNeeded();await page.screenshot({path:`test-results/${artifact}-restored.png`});
  assert.deepEqual(pageErrors,[]);assert.deepEqual(provider.errors,[]);
  const report={packagedExe:exe,realPi:true,realProvider:false,stopping,unknown,waitingRestartPreserved:true,sharedFormDraft:true,mainDraftPreserved:true,explicitInputSameScope:true,duplicateRequestNoReplay:true,...(unknown?{localPendingFaultInjected:true,unknownQueryDoesNotExecute:true,explicitRetryOriginalCommand:true}:{doubleClickOneCommand:true}),optionsFrozen:true,acceptedNotModelSuccess:true,oldGoalInputUnchanged:true,memberEvidenceNotReexecuted:true,queueRemainsPaused:true,...(stopping?{continuedRunCancelled:true}:{replanRequired:true,completedThenExplicitQueueCreatesNewGoal:true}),historyReadOnly:true,finalRestartWithoutReplay:true,mainRequests:provider.mainRequests.length,memberRequests:provider.memberRequests.length,pageErrors,transportErrors:provider.errors};
  await fs.writeFile(`test-results/${artifact}-ui-smoke.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}catch(error){
  keepTemp=true;await fs.mkdir('test-results',{recursive:true});if(desktop)await desktop.firstWindow().then(page=>page.screenshot({path:`test-results/${artifact}-failure.png`})).catch(()=>{});
  const workspaceState=desktop?await desktop.firstWindow().then(page=>page.evaluate(()=>(window as any).cbim.call('list'))).catch(error=>String(error)):undefined;
  await fs.writeFile(`test-results/${artifact}-ui-failure.json`,JSON.stringify({packagedExe:exe,temp,error:String(error),workspaceState,mainRequests:provider.mainRequests.length,memberRequests:provider.memberRequests.length,pageErrors,transportErrors:provider.errors},null,2));throw error;
}finally{
  provider.releaseContinuation();if(desktop)await desktop.close().catch(()=>{});if(setup)await setup.shutdown();await provider.close();
  if(!keepTemp){const target=path.resolve(temp);assert.equal(path.dirname(target),path.resolve(os.tmpdir()));assert.ok(path.basename(target).startsWith('cbim-scope-continuation-ui-'));await fs.rm(target,{recursive:true,force:true})}
}
