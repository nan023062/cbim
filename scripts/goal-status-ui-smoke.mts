import {_electron as electron,type ElectronApplication,type Locator} from 'playwright-core';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Application} from '../src/backend/main/application';
import {Paths} from '../src/backend/main/platform/paths';
import type {DispatchScope} from '../src/backend/core/tasks/dispatch-scope';
import {seedTeam} from '../tests/team-fixture';
import {request} from '../tests/data/knowledge';
import {goalCompleteArguments,goalPlanArguments,type GoalFixtureRequest} from '../tests/goal-provider-fixture';
import {latestExecutable} from './build-artifact.mjs';

// Real packaged Electron + Pi + persistent dispatch state. Only model responses use a local deterministic provider.
// --blocked deliberately skips goal review: a confident final answer must never turn this scope into UI success.
// --stop clicks the live conversation stop button while the member stream is held, then verifies durable cancellation.
const blocked=process.argv.includes('--blocked'),stopping=process.argv.includes('--stop'),defaultExecutor=process.argv.includes('--default-executor');
assert.ok(!(blocked&&stopping),'--blocked 与 --stop 分别运行，避免将审阅失败混同主动停止');
const artifact='goal-status'+(defaultExecutor?'-default':'')+(blocked?'-blocked':stopping?'-stopped':'');
const exe=await latestExecutable(),temp=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-goal-status-ui-'));
const project=path.join(temp,'project'),user=path.join(temp,'user');await fs.mkdir(project);
const mainGoal='请核实模块文件；仅在证据审阅完成后结束本次目标';
const memberGoal='核实 input.txt 的实际内容并提交读取证据';
const acceptance=['读取 input.txt 并提交真实工具回执'],fact='GOAL_STATUS_REAL_FILE_136c0a';
const candidate='文件实际内容为 '+fact;
const memberLive='执行成员正在核实实际文件。';
const mainFinalPending='完成审阅已提交，正在形成最终回复。';
const mainFinal=blocked?'文本声称已经完成，但没有结构化审阅。':'原目标的执行证据和完成审阅已经核实。';
const queuedGoal='请在上一目标真正结束后，单独答复这条排队消息';
const queuedFinal='原目标已经关闭，现在答复独立排队消息。';
await fs.writeFile(path.join(project,'input.txt'),fact);
type ProviderRequest=GoalFixtureRequest&{model:string;tools?:{function:{name:string}}[]};
const mainRequests:ProviderRequest[]=[],memberRequests:ProviderRequest[]=[],transportErrors:string[]=[],pageErrors:string[]=[];
let agentId='',moduleId='',releaseMember=()=>{},releaseFinal=()=>{};
const memberGate=new Promise<void>(resolve=>{releaseMember=resolve}),finalGate=new Promise<void>(resolve=>{releaseFinal=resolve});
const server=http.createServer(async(req,res)=>{
  try{
    assert.equal(req.method,'POST');assert.ok(req.url?.endsWith('/chat/completions'));
    let raw='';for await(const chunk of req)raw+=chunk;
    const body=JSON.parse(raw) as ProviderRequest,isMain=body.tools?.some(tool=>tool.function.name==='cbim_dispatch_task')===true;
    const history=isMain?mainRequests:memberRequests,turn=history.length;history.push(body);
    res.writeHead(200,{'Content-Type':'text/event-stream'});
    const emit=(delta:unknown,finish_reason:string|null=null)=>res.write('data: '+JSON.stringify({id:randomUUID(),object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta,finish_reason}]})+'\n\n');
    const tool=(id:string,name:string,args:unknown)=>{emit({role:'assistant',tool_calls:[{index:0,id,type:'function',function:{name,arguments:JSON.stringify(args)}}]});emit({},'tool_calls')};
    const reply=(content:string)=>{emit({role:'assistant',content});emit({},'stop')};
    if(isMain){
      assert.ok(body.tools?.some(tool=>tool.function.name==='cbim_goal_review'));
      assert.ok(!body.tools?.some(tool=>['write','edit','bash'].includes(tool.function.name)));
      if(turn===0)tool('main-goal-plan','cbim_goal_plan',goalPlanArguments({objective:mainGoal,agentId:defaultExecutor?'cbim:executor':agentId,moduleIds:[moduleId],acceptance}));
      else if(turn===1)tool('main-dispatch','cbim_dispatch_task',{...(!defaultExecutor?{agentId}:{}),moduleIds:[moduleId],goal:memberGoal,acceptance:acceptance.map((text,index)=>({id:'criterion-'+index,text})),prerequisites:[]});
      else if(turn===2)reply('主 Agent 本轮调度结束，成员仍在执行，整体目标尚未完成。');
      else if(blocked){assert.equal(turn,3);assert.ok(JSON.stringify(body.messages).includes(candidate));reply(mainFinal)}
      else if(turn===3)tool('main-goal-inspect','cbim_goal_inspect',{});
      else if(turn===4)tool('main-goal-review','cbim_goal_review',goalCompleteArguments(body,'main-goal-inspect'));
      else if(turn===5){emit({role:'assistant',content:mainFinalPending+'\n\n'});await finalGate;reply(mainFinal)}
      else if(turn===6){assert.ok(JSON.stringify(body.messages.filter(message=>message.role==='user').at(-1)?.content).includes(queuedGoal));reply(queuedFinal)}
      else throw Error('Unexpected main request '+turn);
    }else{
      assert.ok(!body.tools?.some(tool=>tool.function.name.startsWith('cbim_goal_')||tool.function.name.startsWith('cbim_dispatch_')));
      if(turn===0)tool('member-plan','cbim_task_plan',{expectedVersion:0,goal:memberGoal,reason:'受托核实业务模块',acceptance,steps:[{id:'verify',title:'读取并核实实际文件',owner:'执行成员'}]});
      else if(turn===1){emit({role:'assistant',content:memberLive});await memberGate;tool('member-read','read',{path:'input.txt'})}
      else if(turn===2){assert.ok(JSON.stringify(body.messages).includes(fact));tool('member-step','cbim_task_step',{expectedVersion:1,id:'verify',state:'reported_done',evidenceIds:['member-read']})}
      else if(turn===3)tool('member-delivery','cbim_delivery_prepare',{expectedVersion:2,summary:candidate,limitations:['不代表人工业务验收']});
      else if(turn===4)reply('成员读取证据已提交。');
      else throw Error('Unexpected executor request '+turn);
    }
    res.end('data: [DONE]\n\n');
  }catch(error){transportErrors.push(String(error));if(!res.headersSent)res.writeHead(500);res.end()}
});
await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert.ok(address&&typeof address!=='string');
let desktop:ElectronApplication|undefined,setup:Application|undefined;
try{
  setup=new Application(new Paths(user,path.resolve('.')),path.resolve('design'));await setup.init();
  await setup.models.save({profile:{name:'Local goal status UI',api:'openai-completions',baseUrl:`http://127.0.0.1:${address.port}/v1`,auth:'none',defaultModel:'goal-status-ui',models:[{id:'goal-status-ui',name:'Goal status UI',enabled:true,contextWindow:65536,maxTokens:4096,reasoning:false,pricing:{input:0,output:0,cacheRead:0,cacheWrite:0}}]}});
  const entry=await setup.dispatch('add',{path:project}),workspace=setup.workspace(entry.id),team=await seedTeam(workspace);agentId=team.input.agentId;moduleId=team.input.moduleId;
  if(defaultExecutor){const snapshot=await workspace.snapshot(),plan=await team.call('cbim_object_preview',{revision:snapshot.revision,operations:[{kind:'agent',action:'delete',id:agentId,cascade:true}]});await team.call('cbim_object_commit',{planId:plan.planId},true)}
  const knowledge=await workspace.snapshot(),modulePath=moduleId+'/module.json',definition=JSON.parse(knowledge.files.find(file=>file.path===modulePath)!.text);
  definition.maintenance={bindingId:'goal-status-owner',maintainerPersonIds:['owner'],revision:1,state:'active',confirmation:{recordId:'goal-status-review',source:'local_user',confirmedAt:new Date().toISOString()}};
  await workspace.commit(request(knowledge,[{path:modulePath,text:JSON.stringify(definition)},{path:'.cbim/team/people.json',text:JSON.stringify({people:[{id:'owner',name:'维护人',team:'.cbim/team'}]})}]));
  await setup.shutdown();setup=undefined;
  const scopes=async()=>{
    // Pure reader: do not open a recovering writer over a live partial transaction line.
    const raw=await fs.readFile(path.join(user,entry.id,'dispatch','dispatch.jsonl'),'utf8'),found=new Map<string,DispatchScope>();
    for(const line of raw.slice(0,raw.lastIndexOf('\n')).split('\n').filter(Boolean)){
      const {body}=JSON.parse(line);assert.equal(body.workspaceId,entry.id);for(const scope of body.mutation.scopes??[])found.set(scope.scopeId,scope);
    }
    return [...found.values()];
  };
  const waitScopes=async(count:number)=>{
    const deadline=Date.now()+20000;
    while(Date.now()<deadline){const current=await scopes();if(current.length===count&&current.every(scope=>scope.status==='closed'))return current;await new Promise(resolve=>setTimeout(resolve,50))}
    throw Error('Goal scopes did not close: '+JSON.stringify(await scopes()));
  };
  desktop=await electron.launch({executablePath:exe,env:{...process.env,CBIM_USER_DATA_ROOT:user},timeout:60000});
  let page=await desktop.firstWindow();page.setDefaultTimeout(30000);page.on('pageerror',error=>pageErrors.push(error.message));
  const call=(action:string,args:unknown={})=>page.evaluate(({action,args})=>(window as any).cbim.call(action,args),{action,args});
  const active=()=>page.locator('.workspace-panel:not([hidden])');
  const panel=()=>active().getByTestId('conversation-goal-summary');
  async function expandDetails(container:Locator,testId:string){
    const details=container.getByTestId('scope-goal-details');
    if(await details.count()&&await details.getAttribute('open')===null)await details.locator(':scope > summary').click();
    const target=container.getByTestId(testId);
    await target.waitFor({state:'visible'});return target;
  }
  await page.getByRole('button',{name:'project · 运行中',exact:true}).click();
  await active().getByRole('textbox',{name:'对话草稿',exact:true}).fill(mainGoal);await active().getByRole('button',{name:'发送消息',exact:true}).click();
  await active().locator('.member-activity-card').getByText(memberLive,{exact:false}).waitFor();
  const records=await call('loop.list',{id:entry.id}),rootSessionId=records.find((record:any)=>record.task?.goal===mainGoal)?.task.taskId;assert.equal(typeof rootSessionId,'string');
  const identity={workspaceId:entry.id,rootSessionId},firstThread=await call('loop.thread',{id:entry.id,taskId:rootSessionId});
  assert.equal(firstThread.length,1);assert.equal(firstThread[0].status,'completed');
  const initial=(await scopes())[0];assert.equal(initial.status,'active');assert.equal(initial.goal?.revision,2);
  await active().locator(`[data-testid="conversation-goal-summary"][data-scope-id="${initial.scopeId}"]`).waitFor();
  assert.notEqual(await panel().getAttribute('data-goal-state'),'completed');
  assert.ok((await (await expandDetails(panel(),'scope-goal-plan')).innerText()).includes(acceptance[0]));
  assert.ok((await panel().getByTestId('scope-goal-input').innerText()).includes(mainGoal));
  const stop=active().getByRole('button',{name:'停止执行',exact:true});assert.equal(await stop.isEnabled(),true);
  assert.equal(await active().getByText('本轮已结束',{exact:true}).count(),0,'成员执行期间不得显示整个目标已结束');
  await fs.mkdir('test-results',{recursive:true});await panel().getByTestId('scope-goal-status').scrollIntoViewIfNeeded();await page.screenshot({path:`test-results/${artifact}-member-active.png`});

  await active().getByRole('tab',{name:'任务视图',exact:true}).click();await active().getByTestId('dispatch-root-node').click();
  const rootGoal=active().getByTestId('dispatch-root-goal');await rootGoal.waitFor();assert.equal(await rootGoal.getAttribute('data-scope-id'),initial.scopeId);
  assert.ok((await (await expandDetails(rootGoal,'scope-goal-plan')).innerText()).includes(acceptance[0]));
  assert.equal(await active().getByTestId('scope-stop').isEnabled(),true);
  await page.screenshot({path:`test-results/${artifact}-root-plan.png`});
  await active().getByRole('tab',{name:'对话',exact:true}).click();
  await active().getByRole('textbox',{name:'对话草稿',exact:true}).fill(queuedGoal);
  await active().getByRole('button',{name:'加入队列',exact:true}).click();
  await active().locator('.message-queue').getByText(queuedGoal,{exact:true}).waitFor();
  assert.deepEqual((await call('loop.queue',{id:entry.id,taskId:rootSessionId})).map((item:any)=>({message:item.message,status:item.status})),[{message:queuedGoal,status:'pending'}]);
  assert.equal((await scopes()).length,1);assert.equal(mainRequests.length,3);assert.equal(memberRequests.length,2);
  assert.equal(await active().getByRole('button',{name:'停止执行',exact:true}).isEnabled(),true);
  await page.screenshot({path:`test-results/${artifact}-member-queued.png`});
  if(stopping)await active().getByRole('button',{name:'停止执行',exact:true}).click();
  else releaseMember();
  if(!blocked&&!stopping){
    await active().getByText(mainFinalPending,{exact:false}).waitFor();
    await page.waitForFunction(()=>document.querySelector('[data-testid="conversation-goal-summary"]')?.getAttribute('data-goal-state')==='review_pending');
    assert.equal((await scopes())[0].status,'active');assert.equal((await scopes())[0].goal?.review?.decision,'complete');
    await expandDetails(panel(),'scope-goal-review');
    assert.notEqual(await panel().getAttribute('data-goal-state'),'completed');
    assert.equal((await call('loop.queue',{id:entry.id,taskId:rootSessionId}))[0].status,'pending');
    await panel().getByTestId('scope-goal-status').scrollIntoViewIfNeeded();await page.screenshot({path:`test-results/${artifact}-review-pending.png`});
    releaseFinal();await active().getByText(queuedFinal,{exact:true}).waitFor();
  }else if(blocked)await active().getByText(mainFinal,{exact:true}).waitFor();
  const persisted=await waitScopes(blocked||stopping?1:2);assert.equal(persisted[0].scopeId,initial.scopeId);
  assert.deepEqual(persisted[0].goal?.input,initial.goal?.input);
  if(stopping){
    assert.equal(persisted[0].outcome,'cancelled');assert.equal(persisted[0].goal?.review,undefined);
    await active().locator('[data-testid="conversation-goal-summary"][data-goal-state="cancelled"]').waitFor();
    assert.equal(await panel().getByTestId('scope-goal-status').innerText(),'本轮已停止');
    await active().getByTestId('conversation-activity').filter({hasText:/^本轮已停止$/}).waitFor();
    const graph=await call('dispatch.graphSnapshot',{identity}),runtime=await call('runtime.snapshot');
    assert.equal(graph.tasks.length,1);assert.equal(graph.tasks[0].status,'cancelled');
    assert.equal(runtime.members.find((member:any)=>member.agentInstanceId===graph.tasks[0].assignee.agentInstanceId)?.lifecycle,'released');
    assert.notEqual(runtime.members.find((member:any)=>member.agentInstanceId===graph.root.agent.agentInstanceId)?.lifecycle,'released');
    const thread=await call('loop.thread',{id:entry.id,taskId:rootSessionId});assert.equal(thread.length,1);assert.equal(thread[0].source,undefined);
    assert.equal((await call('loop.queue',{id:entry.id,taskId:rootSessionId}))[0].status,'paused');
    assert.equal(await active().getByText(queuedFinal,{exact:true}).count(),0);assert.equal(await active().getByText(mainFinal,{exact:true}).count(),0);
    assert.equal(mainRequests.length,3);
  }else if(blocked){
    assert.equal(persisted[0].outcome,'failed');assert.ok(persisted[0].goal?.blocked?.reason);assert.equal(persisted[0].goal?.review,undefined);
    await active().locator('[data-testid="conversation-goal-summary"][data-goal-state="blocked"]').waitFor();
    assert.ok((await panel().getByTestId('scope-goal-blocked').innerText()).includes(persisted[0].goal!.blocked!.reason));
    assert.equal(await panel().getByTestId('scope-goal-status').innerText(),'目标未完成');
    await active().getByTestId('conversation-activity').filter({hasText:/^目标未完成$/}).waitFor();
    assert.equal((await call('loop.queue',{id:entry.id,taskId:rootSessionId}))[0].status,'paused');
    assert.equal(await active().getByText(queuedFinal,{exact:true}).count(),0);
    assert.equal(mainRequests.length,4);
  }else{
    assert.equal(persisted[0].outcome,'completed');assert.equal(persisted[0].goal?.review?.decision,'complete');
    assert.equal(persisted[1].outcome,'completed');assert.equal(persisted[1].goal?.input.message,queuedGoal);
    await active().locator('[data-testid="scope-history-select"]:visible').selectOption(initial.scopeId);
    await page.waitForFunction(scopeId=>{const element=document.querySelector('[data-testid="conversation-goal-summary"]');return element?.getAttribute('data-scope-id')===scopeId&&element?.getAttribute('data-goal-state')==='completed'},initial.scopeId);
    await expandDetails(panel(),'scope-goal-review');assert.equal(mainRequests.length,7);
    assert.deepEqual(await call('loop.queue',{id:entry.id,taskId:rootSessionId}),[]);
  }
  assert.equal(memberRequests.length,stopping?2:5);await active().getByRole('button',{name:'停止执行',exact:true}).waitFor({state:'hidden'});
  await panel().getByTestId('scope-goal-status').scrollIntoViewIfNeeded();await page.screenshot({path:`test-results/${artifact}-settled.png`});
  await active().getByRole('tab',{name:'任务视图',exact:true}).click();await active().getByTestId('dispatch-root-node').click();
  const rootHistory=active().locator('[data-testid="scope-history-select"]:visible');if(await rootHistory.count())await rootHistory.selectOption(initial.scopeId);
  const settledRoot=active().getByTestId('dispatch-root-goal');await settledRoot.waitFor();assert.equal(await settledRoot.getAttribute('data-scope-id'),initial.scopeId);
  if(stopping)assert.equal(await settledRoot.getAttribute('data-goal-state'),'cancelled');
  else if(blocked){assert.equal(await settledRoot.getAttribute('data-goal-state'),'blocked');assert.ok((await settledRoot.getByTestId('scope-goal-blocked').innerText()).includes(persisted[0].goal!.blocked!.reason))}
  else{assert.equal(await settledRoot.getAttribute('data-goal-state'),'completed');await expandDetails(settledRoot,'scope-goal-review')}
  await page.screenshot({path:`test-results/${artifact}-root-settled.png`});
  const count=mainRequests.length+memberRequests.length;
  await desktop.close();desktop=undefined;desktop=await electron.launch({executablePath:exe,env:{...process.env,CBIM_USER_DATA_ROOT:user},timeout:60000});
  page=await desktop.firstWindow();page.setDefaultTimeout(30000);page.on('pageerror',error=>pageErrors.push(error.message));
  await page.getByRole('button',{name:'project · 运行中',exact:true}).click();await page.locator('.workspace-conversations button').filter({hasText:mainGoal}).first().click();
  await panel().waitFor();
  const history=active().locator('[data-testid="scope-history-select"]:visible');if(await history.count())await history.selectOption(initial.scopeId);
  assert.deepEqual(await scopes(),persisted);
  if(stopping){await active().locator('[data-testid="conversation-goal-summary"][data-goal-state="cancelled"]').waitFor();assert.equal((await call('loop.queue',{id:entry.id,taskId:rootSessionId}))[0].status,'paused');assert.equal((await call('loop.thread',{id:entry.id,taskId:rootSessionId})).length,1)}
  else if(blocked){await active().locator('[data-testid="conversation-goal-summary"][data-goal-state="blocked"]').waitFor();assert.ok((await panel().getByTestId('scope-goal-blocked').innerText()).includes(persisted[0].goal!.blocked!.reason));assert.equal((await call('loop.queue',{id:entry.id,taskId:rootSessionId}))[0].status,'paused')}
  else{await page.waitForFunction(()=>document.querySelector('[data-testid="conversation-goal-summary"]')?.getAttribute('data-goal-state')==='completed');await expandDetails(panel(),'scope-goal-review')}
  assert.equal(mainRequests.length+memberRequests.length,count);
  await active().getByRole('button',{name:'停止执行',exact:true}).waitFor({state:'hidden'});
  await panel().getByTestId('scope-goal-status').scrollIntoViewIfNeeded();await page.screenshot({path:`test-results/${artifact}-restored.png`});
  if(!blocked&&!stopping){
    await page.getByRole('button',{name:'切换浅色模式',exact:true}).click();
    await desktop.evaluate(({BrowserWindow})=>{const window=BrowserWindow.getAllWindows()[0];window.setSize(800,760)});
    await page.waitForFunction(()=>document.documentElement.dataset.theme==='light'&&window.innerWidth<=800);
    const details=panel().getByTestId('scope-goal-details');if(await details.getAttribute('open')!==null)await details.locator(':scope > summary').click();
    await panel().scrollIntoViewIfNeeded();
    const checkLayout=async()=>{
      const geometry=await active().evaluate(element=>{
        const composer=element.querySelector('.chat-composer')!.getBoundingClientRect(),input=element.querySelector('[aria-label="对话草稿"]')!.getBoundingClientRect(),goal=element.querySelector('[data-testid="conversation-goal-summary"]')!.getBoundingClientRect();
        return {width:window.innerWidth,height:window.innerHeight,documentWidth:document.documentElement.scrollWidth,composerBottom:composer.bottom,inputHeight:input.height,inputBottom:input.bottom,goalLeft:goal.left,goalRight:goal.right};
      });
      assert.ok(geometry.documentWidth<=geometry.width+1,'窄窗口不应横向溢出');assert.ok(geometry.composerBottom<=geometry.height+1&&geometry.inputBottom<=geometry.height+1&&geometry.inputHeight>=32,'目标卡片不能挤出或压扁输入框');assert.ok(geometry.goalLeft>=0&&geometry.goalRight<=geometry.width+1,'目标卡片必须保持在视口内');
    };
    await checkLayout();await page.screenshot({path:`test-results/${artifact}-narrow-light.png`});
    await expandDetails(panel(),'scope-goal-plan');await panel().getByTestId('scope-goal-status').scrollIntoViewIfNeeded();
    await checkLayout();await page.screenshot({path:`test-results/${artifact}-narrow-light-expanded.png`});
  }
  assert.deepEqual(pageErrors,[]);assert.deepEqual(transportErrors,[]);
  const report={packagedExe:exe,realPi:true,realProvider:false,defaultExecutor,blocked,stopping,planVisible:true,rootGoalVisible:true,mainRunCompletedWhileMembersActive:true,queueAndStopAvailableDuringMember:true,queueWaitDoesNotOpenScope:true,...(stopping?{stopClicked:true,scopeCancelled:true,executorReleased:true,mainRetained:true,noResultContinuation:true,queuePaused:true}:blocked?{blockedReasonVisible:true,failedScopeNotSuccess:true,queuePaused:true}:{reviewPendingBeforeClose:true,completedOnlyAfterScopeClosed:true,independentQueuedGoal:true,goalHistoryVisible:true,narrowLightComposerVisible:true}),restartWithoutReplay:true,mainRequests:mainRequests.length,memberRequests:memberRequests.length,pageErrors,transportErrors};
  await fs.writeFile(`test-results/${artifact}-ui-smoke.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}catch(error){
  await fs.mkdir('test-results',{recursive:true});if(desktop)await desktop.firstWindow().then(page=>page.screenshot({path:`test-results/${artifact}-failure.png`})).catch(()=>{});
  await fs.writeFile(`test-results/${artifact}-ui-failure.json`,JSON.stringify({packagedExe:exe,error:String(error),mainRequests:mainRequests.length,memberRequests:memberRequests.length,pageErrors,transportErrors},null,2));throw error;
}finally{
  releaseMember();releaseFinal();if(desktop)await desktop.close().catch(()=>{});if(setup)await setup.shutdown();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));
  const target=path.resolve(temp);assert.equal(path.dirname(target),path.resolve(os.tmpdir()));assert.ok(path.basename(target).startsWith('cbim-goal-status-ui-'));await fs.rm(target,{recursive:true,force:true});
}
