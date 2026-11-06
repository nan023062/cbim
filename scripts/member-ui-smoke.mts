import {_electron as electron,type ElectronApplication} from 'playwright-core';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Application} from '../src/backend/main/application';
import {Paths} from '../src/backend/main/platform/paths';
import {seedTeam} from '../tests/team-fixture';
import {request} from '../tests/helpers';
import {latestExecutable} from './build-artifact.mjs';

// Real packaged Electron + pinned Pi, isolated files and localhost model fixture.
// A controlled SSE pause proves the UI displays partial output before the member finishes.
const temp=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-member-ui-'));
const project=path.join(temp,'project'),user=path.join(temp,'user');await fs.mkdir(project);
await fs.writeFile(path.join(project,'input.txt'),'MEMBER_READ_EVIDENCE');
const goal='MEMBER_UI: 核实文件并提交证据',acceptance=['读取 input.txt 并提供真实证据'];
let releaseFirst=()=>{},releaseSecond=()=>{};
const firstGate=new Promise<void>(resolve=>{releaseFirst=resolve}),secondGate=new Promise<void>(resolve=>{releaseSecond=resolve});
const failures:string[]=[];let memberTurn=0,mainRequests=0;
const server=http.createServer(async(req,res)=>{
  try{
    let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);
    res.writeHead(200,{'Content-Type':'text/event-stream'});
    const emit=(delta:unknown,finish_reason:string|null=null)=>res.write('data: '+JSON.stringify({id:randomUUID(),object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta,finish_reason}]})+'\n\n');
    const tool=(id:string,name:string,args:unknown)=>{emit({role:'assistant',tool_calls:[{index:0,id,type:'function',function:{name,arguments:JSON.stringify(args)}}]});emit({},'tool_calls')};
    if(JSON.stringify(body.messages).includes('MEMBER_UI:')){
      const turn=memberTurn++;
      if(turn===0)tool('plan','cbim_task_plan',{expectedVersion:0,goal,reason:'执行正式派发任务',acceptance,steps:[{id:'verify',title:'核实实际文件',owner:'开发者'}]});
      else if(turn===1){emit({role:'assistant',content:'成员第一段：正在核对真实业务文件。'});await firstGate;tool('read-evidence','read',{path:'input.txt'})}
      else if(turn===2){emit({role:'assistant',content:'成员第二段：文件已读取，正在整理证据。'});await secondGate;tool('step','cbim_task_step',{expectedVersion:1,id:'verify',state:'reported_done',evidenceIds:['read-evidence']})}
      else if(turn===3)tool('delivery','cbim_delivery_prepare',{expectedVersion:2,summary:'成员已核实 input.txt',limitations:['等待人工业务验收']});
      else {emit({role:'assistant',content:'成员完成：证据已提交，等待审阅。'});emit({},'stop')}
    }else{mainRequests++;emit({role:'assistant',content:'主 Agent 回复：可以开始成员协作。'});emit({},'stop')}
    res.end('data: [DONE]\n\n');
  }catch(error){failures.push(String(error));if(!res.headersSent)res.writeHead(500);res.end()}
});
await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
const address=server.address();assert.ok(address&&typeof address!=='string');
let desktop:ElectronApplication|undefined,setup:Application|undefined;
try{
  setup=new Application(new Paths(user,path.resolve('.')),path.resolve('design'));await setup.init();
  await setup.models.save({profile:{name:'Member UI fixture',api:'openai-completions',baseUrl:`http://127.0.0.1:${address.port}/v1`,auth:'none',defaultModel:'member-ui',models:[{id:'member-ui',name:'Member UI',enabled:true,contextWindow:65536,maxTokens:4096,reasoning:false,pricing:{input:0,output:0,cacheRead:0,cacheWrite:0}}]}});
  const entry=await setup.dispatch('add',{path:project}),workspace=setup.workspace(entry.id),team=await seedTeam(workspace);
  const snap=await workspace.snapshot(),modulePath=team.input.moduleId+'/module.json';
  const definition=JSON.parse(snap.files.find(file=>file.path===modulePath)!.text);
  definition.maintenance={bindingId:'member-ui-owner',maintainerPersonIds:['owner'],revision:1,state:'active',confirmation:{recordId:'member-ui-review',source:'local_user',confirmedAt:new Date().toISOString()}};
  await workspace.commit(request(snap,[{path:modulePath,text:JSON.stringify(definition)},{path:'.cbim/team/people.json',text:JSON.stringify({people:[{id:'owner',name:'维护人',team:'.cbim/team'}]})}]));
  await setup.shutdown();setup=undefined;
  const exe=await latestExecutable();desktop=await electron.launch({executablePath:exe,env:{...process.env,CBIM_USER_DATA_ROOT:user},timeout:60000});
  const page=await desktop.firstWindow();page.setDefaultTimeout(25000);
  const pageErrors:string[]=[];page.on('pageerror',error=>pageErrors.push(error.message));
  const call=(action:string,args:unknown={})=>page.evaluate(({action,args})=>(window as any).cbim.call(action,args),{action,args});
  await page.getByRole('button',{name:'project · 运行中',exact:true}).click();
  await page.getByRole('textbox',{name:'对话草稿',exact:true}).fill('主对话实时成员流程测试');
  await page.getByRole('button',{name:'发送消息',exact:true}).click();
  await page.getByText('主 Agent 回复：可以开始成员协作。',{exact:true}).waitFor();
  await page.waitForFunction(()=>document.querySelector('.chat-run-status')?.textContent?.includes('本轮结束'));
  const records=await call('loop.list',{id:entry.id}),rootSessionId=records.find((record:any)=>record.task?.goal==='主对话实时成员流程测试').task.taskId;
  const identity={workspaceId:entry.id,rootSessionId};
  await call('dispatch.open',{...identity,commandId:'open-ui'});
  const assign=async(commandId:string,taskGoal:string,prerequisites:unknown[]=[])=>call('dispatch.task',{...identity,commandId,expectedParentRevision:1,task:{assigneeAgentId:team.input.agentId,moduleIds:[team.input.moduleId],goal:taskGoal,acceptance:acceptance.map((text,i)=>({id:'criterion-'+i,text})),prerequisites}});
  const assigned=await assign('assign-ui',goal);
  await assign('assign-followup','收到结果后进行复核',[{taskId:assigned.taskId,expectedPlanRevision:1}]);
  // A second graph must never leak into this conversation, even when it uses the same workspace/role.
  const other={workspaceId:entry.id,rootSessionId:'other-ui-session'};
  await call('dispatch.open',{...other,commandId:'open-other'});
  await call('dispatch.task',{...other,commandId:'assign-other',expectedParentRevision:1,task:{assigneeAgentId:team.input.agentId,moduleIds:[team.input.moduleId],goal:'OTHER_MEMBER_SENTINEL',acceptance:[{id:'other',text:'独立会话'}]}});
  await call('dispatch.executionStart',{...identity,taskId:assigned.taskId,commandId:'start-ui',expectedRevision:1,options:{permission:'read',turnTimeoutMs:120000}});
  const active=page.locator('.workspace-panel:not([hidden])');
  await active.getByText('成员第一段：正在核对真实业务文件。',{exact:false}).waitFor();
  assert.equal((await call('dispatch.executionInspect',{...identity,taskId:assigned.taskId})).task.status,'running');
  assert.ok(!(await active.innerText()).includes('OTHER_MEMBER_SENTINEL'));
  await active.getByRole('textbox',{name:'对话草稿',exact:true}).fill('切换任务图后保留的草稿');
  await fs.mkdir('test-results',{recursive:true});await page.screenshot({path:'test-results/member-live-chat.png'});
  await active.getByRole('tab',{name:'任务视图',exact:true}).click();
  await active.getByTestId('dispatch-graph').waitFor();
  assert.equal(await active.getByTestId('dispatch-root-node').count(),1);
  assert.equal(await active.getByTestId('dispatch-task-node').count(),2);
  assert.equal(await active.locator('[data-testid="dispatch-graph-edge"][data-kind="dispatch"]').count(),2);
  assert.equal(await active.locator('[data-testid="dispatch-graph-edge"][data-kind="dependency"]').count(),1);
  assert.equal(await active.locator('.member-task-detail').count(),0);
  const node=active.locator(`[data-testid="dispatch-task-node"][data-task-id="${assigned.taskId}"]`);
  await node.click();await active.locator('.member-task-detail').getByText('成员第一段：正在核对真实业务文件。',{exact:false}).waitFor();
  releaseFirst();
  await active.locator('.member-task-detail').getByText('成员第二段：文件已读取，正在整理证据。',{exact:false}).waitFor();
  assert.equal(await node.getAttribute('aria-pressed'),'true');
  assert.ok((await active.locator('.member-task-detail').innerText()).includes('read'));
  await page.screenshot({path:'test-results/member-live-graph.png'});
  await page.getByRole('button',{name:'切换浅色模式',exact:true}).click();await page.screenshot({path:'test-results/member-live-graph-light.png'});await page.getByRole('button',{name:'切换深色模式',exact:true}).click();
  releaseSecond();
  await page.waitForFunction(({id})=>document.querySelector(`[data-task-id="${id}"]`)?.textContent?.includes('交付待审阅'),{id:assigned.taskId});
  assert.equal(await node.getAttribute('aria-pressed'),'true');
  await active.locator('.member-task-detail').getByText('成员完成：证据已提交，等待审阅。',{exact:false}).waitFor();
  assert.ok(!(await active.locator('.session-task-view').innerText()).includes('OTHER_MEMBER_SENTINEL'));
  await active.getByRole('tab',{name:'对话',exact:true}).click();
  assert.equal(await active.getByRole('textbox',{name:'对话草稿',exact:true}).inputValue(),'切换任务图后保留的草稿');
  await active.getByText('成员完成：证据已提交，等待审阅。',{exact:false}).waitFor();
  await active.locator('.member-activity-card').filter({hasText:goal}).getByRole('button',{name:'查看任务详情',exact:false}).click();
  assert.equal(await active.getByRole('tab',{name:'任务视图',exact:true}).getAttribute('aria-selected'),'true');
  assert.equal(await node.getAttribute('aria-pressed'),'true');
  // Reload reopens the same logical conversation; durable task and public run events are restored.
  await page.reload();await page.getByRole('button',{name:'project · 运行中',exact:true}).click();
  await page.locator('.workspace-conversations button').filter({hasText:'主对话实时成员流程测试'}).first().click();
  await active.getByText('成员完成：证据已提交，等待审阅。',{exact:false}).waitFor();
  await active.getByRole('tab',{name:'任务视图',exact:true}).click();await node.click();
  await active.locator('.member-task-detail').getByText('成员完成：证据已提交，等待审阅。',{exact:false}).waitFor();
  await page.setViewportSize({width:720,height:900});await page.screenshot({path:'test-results/member-graph-narrow.png'});
  assert.deepEqual(pageErrors,[]);assert.deepEqual(failures,[]);assert.equal(mainRequests,1);assert.equal(memberTurn,5);
  const evidence={packagedExe:exe,realProvider:false,realPi:true,streamBeforeCompletion:true,graphDefault:true,dispatchAndDependencyEdges:true,nodeSelectionStable:true,memberTools:true,mainDraftPreserved:true,sessionIsolation:true,reloadHistory:true,pageErrors,memberTurns:memberTurn};
  await fs.writeFile('test-results/member-ui-smoke.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));
}finally{releaseFirst();releaseSecond();await setup?.shutdown();await desktop?.close();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))}
