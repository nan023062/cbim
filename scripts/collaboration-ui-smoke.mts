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

// Real packaged Electron and native Pi; only provider responses are deterministic localhost SSE.
// The first user message must trigger the model's dispatch tool. No test IPC starts a member or continuation.
// Run after packaging: CBIM_TEST_EXE=<packaged CBIM.exe> pnpm exec tsx scripts/collaboration-ui-smoke.mts
// --default-executor removes custom roles and verifies the built-in fallback has its own scoped instance.
const defaultExecutor=process.argv.includes('--default-executor');
const verifyHistory=process.argv.includes('--history');
const artifact=(defaultExecutor?'main-instance':'collaboration')+(verifyHistory?'-history':'');
const exe=await latestExecutable();
const temp=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-collaboration-ui-'));
const project=path.join(temp,'project'),user=path.join(temp,'user');
await fs.mkdir(project);
const mainGoal=defaultExecutor?'请安排默认执行成员核实业务文件，并在本会话的任务图中记录执行':'请让团队成员核实业务文件，并在原对话告诉我结果';
const memberGoal='自动协作：读取 input.txt 并提供真实读取证据';
const fact='COLLABORATION_UI_REAL_FILE_62b7e1';
const candidate='成员已核实 input.txt 的实际内容：'+fact;
const acceptance=['读取 input.txt 并提交实际读取回执'];
const liveText='成员正在独立会话核对业务文件。';
const memberFinal='成员已提交读取证据，候选等待业务验收。';
const mainFinal='主 Agent 已收到成员结果：'+fact+'。候选尚未验收。';
const sourceNotice='已收到成员任务回传，主 Agent 继续处理';
await fs.writeFile(path.join(project,'input.txt'),fact);
type ProviderRequest={model:string;messages:{role:string;content:unknown}[];tools?:{function:{name:string}}[]};
const mainRequests:ProviderRequest[]=[],memberRequests:ProviderRequest[]=[],transportErrors:string[]=[];
let agentId='',moduleId='',releaseMember=()=>{};
const memberGate=new Promise<void>(resolve=>{releaseMember=resolve});
const server=http.createServer(async(req,res)=>{
  try{
    assert.equal(req.method,'POST');assert.ok(req.url?.endsWith('/chat/completions'));
    let raw='';for await(const chunk of req)raw+=chunk;
    const body=JSON.parse(raw) as ProviderRequest;
    const isMain=body.tools?.some(tool=>tool.function.name==='cbim_dispatch_task')===true;
    const history=isMain?mainRequests:memberRequests,turn=history.length;history.push(body);
    res.writeHead(200,{'Content-Type':'text/event-stream'});
    const emit=(delta:unknown,finish_reason:string|null=null)=>res.write('data: '+JSON.stringify({id:randomUUID(),object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta,finish_reason}]})+'\n\n');
    const tool=(id:string,name:string,args:unknown)=>{emit({role:'assistant',tool_calls:[{index:0,id,type:'function',function:{name,arguments:JSON.stringify(args)}}]});emit({},'tool_calls')};
    const reply=(text:string)=>{emit({role:'assistant',content:text});emit({},'stop')};
    if(isMain){
      assert.ok(!body.tools?.some(tool=>['write','edit','bash','cbim_dispatch_self'].includes(tool.function.name)),'主调度不应获得业务文件和命令执行工具');
      assert.ok(body.tools?.some(tool=>tool.function.name==='cbim_object_commit'),'主 Agent 必须保留受控知识治理工具');
      if(turn===0)tool('main-dispatch','cbim_dispatch_task',{...(!defaultExecutor?{agentId}:{}),moduleIds:[moduleId],goal:memberGoal,acceptance:acceptance.map((text,index)=>({id:'criterion-'+index,text})),prerequisites:[]});
      else if(turn===1)reply('已派发成员任务，等待成员回传后继续处理。');
      else if(turn===2){assert.ok(JSON.stringify(body.messages).includes(candidate),'主会话续跑没有收到成员候选');reply(mainFinal)}
      else throw Error('出现意外主会话请求：'+turn);
    }else{
      assert.ok(!body.tools?.some(tool=>tool.function.name.startsWith('cbim_dispatch_')),'成员不应获得递归派发工具');
      if(turn===0)tool('member-plan','cbim_task_plan',{expectedVersion:0,goal:memberGoal,reason:'执行主会话可靠派发的任务',acceptance,steps:[{id:'verify',title:'核实实际文件内容',owner:'开发者'}]});
      else if(turn===1){emit({role:'assistant',content:liveText});await memberGate;tool('member-read','read',{path:'input.txt'})}
      else if(turn===2){assert.ok(JSON.stringify(body.messages).includes(fact),'成员上下文缺少真实读取内容');tool('member-step','cbim_task_step',{expectedVersion:1,id:'verify',state:'reported_done',evidenceIds:['member-read']})}
      else if(turn===3)tool('member-delivery','cbim_delivery_prepare',{expectedVersion:2,summary:candidate,limitations:['尚未进行人工业务验收']});
      else if(turn===4)reply(memberFinal);
      else throw Error('出现意外成员请求：'+turn);
    }
    res.end('data: [DONE]\n\n');
  }catch(error){transportErrors.push(String(error));if(!res.headersSent)res.writeHead(500);res.end()}
});
await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
const address=server.address();assert.ok(address&&typeof address!=='string');
let desktop:ElectronApplication|undefined,setup:Application|undefined;
const pageErrors:string[]=[];
try{
  setup=new Application(new Paths(user,path.resolve('.')),path.resolve('design'));await setup.init();
  await setup.models.save({profile:{name:'Local collaboration UI',api:'openai-completions',baseUrl:`http://127.0.0.1:${address.port}/v1`,auth:'none',defaultModel:'collaboration-ui',models:[{id:'collaboration-ui',name:'Collaboration UI',enabled:true,contextWindow:65536,maxTokens:4096,reasoning:false,pricing:{input:0,output:0,cacheRead:0,cacheWrite:0}}]}});
  const entry=await setup.dispatch('add',{path:project}),workspace=setup.workspace(entry.id),team=await seedTeam(workspace);
  agentId=team.input.agentId;moduleId=team.input.moduleId;
  if(defaultExecutor){
    const snap=await workspace.snapshot();
    const preview=await team.call('cbim_object_preview',{revision:snap.revision,operations:[{kind:'agent',action:'delete',id:agentId,cascade:true}]});
    await team.call('cbim_object_commit',{planId:preview.planId},true);
    const registry=await team.call('cbim_agent_registry');assert.equal(registry.groups.flatMap((group:any)=>group.agents).length,0);
  }
  const snapshot=await workspace.snapshot(),modulePath=moduleId+'/module.json';
  const definition=JSON.parse(snapshot.files.find(file=>file.path===modulePath)!.text);
  definition.maintenance={bindingId:'collaboration-ui-owner',maintainerPersonIds:['owner'],revision:1,state:'active',confirmation:{recordId:'collaboration-ui-review',source:'local_user',confirmedAt:new Date().toISOString()}};
  await workspace.commit(request(snapshot,[{path:modulePath,text:JSON.stringify(definition)},{path:'.cbim/team/people.json',text:JSON.stringify({people:[{id:'owner',name:'维护人',team:'.cbim/team'}]})}]));
  await setup.shutdown();setup=undefined;
  desktop=await electron.launch({executablePath:exe,env:{...process.env,CBIM_USER_DATA_ROOT:user},timeout:60000});
  let page=await desktop.firstWindow();page.setDefaultTimeout(30000);page.on('pageerror',error=>pageErrors.push(error.message));
  const call=(action:string,args:unknown={})=>page.evaluate(({action,args})=>(window as any).cbim.call(action,args),{action,args});
  await page.getByRole('button',{name:'project · 运行中',exact:true}).click();
  const active=page.locator('.workspace-panel:not([hidden])');
  await active.getByRole('textbox',{name:'对话草稿',exact:true}).fill(mainGoal);
  await active.getByRole('button',{name:'发送消息',exact:true}).click();

  // Holding the model stream proves this is a live member card, not replayed final output.
  const card=active.locator('.member-activity-card').filter({hasText:memberGoal});
  await card.getByText(liveText,{exact:false}).waitFor();
  const records=await call('loop.list',{id:entry.id});
  const rootSessionId=records.find((record:any)=>record.task?.goal===mainGoal)?.task.taskId;
  assert.equal(typeof rootSessionId,'string');
  const identity={workspaceId:entry.id,rootSessionId};
  const runningGraph=await call('dispatch.graphSnapshot',{identity});
  assert.equal(runningGraph.tasks.length,1);const memberTaskId=runningGraph.tasks[0].taskId;
  assert.equal(runningGraph.tasks[0].status,'running');
  const firstThread=await call('loop.thread',{id:entry.id,taskId:rootSessionId});
  assert.equal(firstThread.length,1);assert.equal(firstThread[0].status,'completed');
  const mainInstanceId=runningGraph.root.agent.agentInstanceId;
  assert.equal(firstThread[0].conversationBinding.agentInstanceId,mainInstanceId);
  assert.equal(firstThread[0].conversationBinding.rootSessionId,rootSessionId);
  assert.notEqual(runningGraph.tasks[0].assignee.agentInstanceId,mainInstanceId);
  assert.ok(runningGraph.tasks[0].scopeId,'自动派发任务必须属于用户调度周期');
  if(defaultExecutor)assert.equal(runningGraph.tasks[0].assignee.agentId,'cbim:executor');
  const runtimeBefore=await call('runtime.snapshot');
  assert.equal(runtimeBefore.members.find((member:any)=>member.agentInstanceId===runningGraph.tasks[0].assignee.agentInstanceId)?.lifecycle,'active');
  assert.equal(await active.locator('.chat-message.user').count(),1);
  assert.equal(await active.locator('.chat-message.user').innerText().then(text=>text.includes(mainGoal)),true);
  assert.equal(mainRequests.length,2);assert.equal(memberRequests.length,2);
  await active.getByRole('textbox',{name:'对话草稿',exact:true}).fill('自动回传后仍保留的用户草稿');
  await fs.mkdir('test-results',{recursive:true});
  await page.screenshot({path:`test-results/${artifact}-live-chat.png`});

  await active.getByRole('tab',{name:'任务视图',exact:true}).click();
  await active.getByTestId('dispatch-graph').waitFor();
  assert.equal(await active.getByTestId('dispatch-root-node').count(),1);
  assert.equal(await active.getByTestId('dispatch-task-node').count(),1);
  assert.equal(await active.locator('[data-testid="dispatch-graph-edge"][data-kind="dispatch"]').count(),1);
  await active.getByTestId('dispatch-root-node').click();
  const rootDetails=active.getByTestId('root-task-detail');
  await rootDetails.getByText(mainInstanceId,{exact:true}).waitFor();
  await rootDetails.getByText(firstThread[0].conversationBinding.agentSessionId,{exact:true}).waitFor();
  const node=active.locator(`[data-testid="dispatch-task-node"][data-task-id="${memberTaskId}"]`);
  await node.click();await active.locator('.member-task-detail').getByText(liveText,{exact:false}).waitFor();
  await page.screenshot({path:`test-results/${artifact}-live-graph.png`});
  releaseMember();
  await active.locator('.member-task-detail').getByText(memberFinal,{exact:false}).waitFor();
  await active.locator('.member-result').getByText(candidate,{exact:true}).waitFor();
  assert.ok((await node.innerText()).includes('交付待审阅'));
  assert.ok((await active.locator('.member-result').innerText()).includes('交付候选 · 尚未验收'));
  assert.equal(await node.getAttribute('aria-pressed'),'true');
  await page.screenshot({path:`test-results/${artifact}-result-graph.png`});

  await active.getByRole('tab',{name:'对话',exact:true}).click();
  await active.getByText(mainFinal,{exact:true}).waitFor();
  await active.locator('.chat-model-notice').filter({hasText:sourceNotice}).waitFor();
  assert.equal(await active.locator('.chat-turn').count(),2);
  assert.equal(await active.locator('.chat-message.user').count(),1,'成员系统回传不能变成第二条用户气泡');
  assert.ok(!(await active.locator('.chat-message.user').innerText()).includes(candidate));
  assert.equal(await active.getByRole('textbox',{name:'对话草稿',exact:true}).inputValue(),'自动回传后仍保留的用户草稿');
  await page.waitForFunction(async({id,taskId})=>{
    const runs=await (window as any).cbim.call('loop.thread',{id,taskId});
    return runs.length===2&&runs.every((run:any)=>run.status==='completed');
  },{id:entry.id,taskId:rootSessionId});
  const thread=await call('loop.thread',{id:entry.id,taskId:rootSessionId});
  assert.equal(thread.length,2);assert.ok(thread.every((run:any)=>run.status==='completed'&&run.task.taskId===rootSessionId));
  assert.equal(thread[0].sessionFile,thread[1].sessionFile);
  assert.deepEqual(thread[0].conversationBinding,thread[1].conversationBinding);
  assert.equal(thread[1].source.kind,'member-results');assert.ok(thread[1].source.continuationId);
  const finalGraph=await call('dispatch.graphSnapshot',{identity});
  await page.waitForFunction(async(instanceId)=>{
    const runtime=await (window as any).cbim.call('runtime.snapshot');
    return runtime.members.find((member:any)=>member.agentInstanceId===instanceId)?.lifecycle==='released';
  },runningGraph.tasks[0].assignee.agentInstanceId);
  const runtimeAfter=await call('runtime.snapshot');
  const retainedMain=runtimeAfter.members.find((member:any)=>member.agentInstanceId===mainInstanceId);
  assert.ok(retainedMain);assert.notEqual(retainedMain.lifecycle,'released');
  assert.equal(finalGraph.tasks[0].result.acceptance,'not_evaluated');
  assert.deepEqual(finalGraph.tasks[0].result.evidenceRefs,['member-read']);
  assert.deepEqual(await call('dispatch.messages',{...identity,agentSessionId:finalGraph.root.agent.agentSessionId}),[]);
  assert.equal(await fs.readFile(path.join(project,'input.txt'),'utf8'),fact);
  await page.screenshot({path:`test-results/${artifact}-returned-chat.png`});

  // Reopening UI history retains the system source and never asks the provider to replay completed work.
  await page.reload();await page.getByRole('button',{name:'project · 运行中',exact:true}).click();
  await page.locator('.workspace-conversations button').filter({hasText:mainGoal}).first().click();
  await active.getByText(mainFinal,{exact:true}).waitFor();
  await active.locator('.chat-model-notice').filter({hasText:sourceNotice}).waitFor();
  assert.equal(await active.locator('.chat-message.user').count(),1);
  assert.equal((await call('loop.thread',{id:entry.id,taskId:rootSessionId})).length,2);
  assert.equal(mainRequests.length,3);assert.equal(memberRequests.length,5);
  if(verifyHistory){
    // Inspect persisted static-role history from the packaged team UI, after the executor was released.
    const memberRole=finalGraph.tasks[0].assignee.agentId;
    const currentView=()=>page.locator('.extension-area:not([hidden]) .extension-content:not([hidden])');
    async function openTeam(){
      const expand=page.getByRole('button',{name:'展开右侧扩展',exact:true});if(await expand.isVisible())await expand.click();
      const tab=page.getByRole('tab',{name:'团队架构',exact:true});
      if(await tab.count())await tab.click();
      else{await page.getByRole('button',{name:'新增扩展页签',exact:true}).click();await currentView().getByRole('button',{name:'打开团队架构',exact:true}).click()}
      await currentView().getByRole('heading',{name:'团队组织架构',exact:true}).waitFor();
    }
    async function roleHistory(roleId:string,archived=false){
      const existing=currentView().getByTestId('agent-session-history');
      if(await existing.count())await existing.getByTestId('history-back').click();
      if(archived){await currentView().getByTestId('team-history-roles').click();await currentView().locator(`[data-testid="agent-history-role"][data-agent-id="${roleId}"]`).click()}
      else{await currentView().locator(`[data-testid="team-static-node"][data-agent-id="${roleId}"]`).click();await currentView().getByTestId('team-history-open').click()}
      return currentView().getByTestId('agent-session-history');
    }
    async function showRun(roleId:string,runId:string,archived=false){
      const sessions=await call('agentHistory.sessions',{workspaceId:entry.id,agentId:roleId});
      assert.deepEqual(sessions.diagnostics,[]);assert.equal(sessions.items.length,1);
      const session=sessions.items[0];assert.equal(session.rootSessionId,rootSessionId);
      const history=await roleHistory(roleId,archived);
      await history.locator(`[data-testid="agent-history-session"][data-session-id="${session.sessionId}"]`).click();
      await history.locator(`[data-testid="agent-history-run"][data-run-id="${runId}"]`).click();
      return history.getByTestId('agent-history-events');
    }
    await openTeam();
    const beforeHistory=(await call('snapshot',{id:entry.id})).revision;
    const roles=await call('agentHistory.roles',{workspaceId:entry.id});assert.deepEqual(roles.diagnostics,[]);
    assert.equal(roles.roles.find((role:any)=>role.agentId==='cbim:main').runCount,2);
    assert.equal(roles.roles.find((role:any)=>role.agentId===memberRole).runCount,1);
    const mainHistory=await showRun('cbim:main',thread[0].runId);
    await mainHistory.getByText('主会话输入',{exact:true}).waitFor();
    await mainHistory.getByText('已派发成员任务，等待成员回传后继续处理。',{exact:true}).waitFor();
    const returnedHistory=await showRun('cbim:main',thread[1].runId);
    await returnedHistory.getByText('回注来源',{exact:true}).waitFor();
    await returnedHistory.getByText(mainFinal,{exact:true}).waitFor();
    await page.screenshot({path:`test-results/${artifact}-main-history.png`});
    const memberRuns=await call('agentHistory.sessions',{workspaceId:entry.id,agentId:memberRole});
    const memberRunList=await call('agentHistory.runs',{workspaceId:entry.id,agentId:memberRole,sessionId:memberRuns.items[0].sessionId});
    const memberRun=memberRunList.items[0];assert.notEqual(memberRun.agentInstanceId,mainInstanceId);
    const memberHistory=await showRun(memberRole,memberRun.runId);
    await memberHistory.getByText(memberFinal,{exact:true}).waitFor();
    await memberHistory.getByText(candidate,{exact:true}).waitFor();
    await memberHistory.getByText('交付候选 · 尚未验收',{exact:true}).waitFor();
    assert.equal((await call('snapshot',{id:entry.id})).revision,beforeHistory,'只读历史不能修改知识');
    assert.equal(await memberHistory.getByRole('button',{name:/停止|允许|执行任务|批准/}).count(),0);
    await page.screenshot({path:`test-results/${artifact}-member-history.png`});
    if(!defaultExecutor){
      await currentView().getByTestId('history-back').click();
      await currentView().locator(`[data-testid="team-static-node"][data-agent-id="${memberRole}"]`).click();
      await currentView().getByRole('button',{name:'删除 Agent',exact:true}).click();
      const editor=page.getByRole('dialog',{name:'删除Agent',exact:true});
      await editor.getByRole('checkbox',{name:'同时删除下级知识',exact:true}).check();
      await editor.getByRole('button',{name:'预览删除影响',exact:true}).click();
      await editor.getByRole('button',{name:'确认删除知识',exact:true}).click();await editor.waitFor({state:'hidden'});
      await page.waitForFunction(async({workspaceId,agentId})=>!(await (window as any).cbim.call('snapshot',{id:workspaceId})).files.some((file:any)=>file.path===agentId+'/agent.json'),{workspaceId:entry.id,agentId:memberRole});
      const archived=await showRun(memberRole,memberRun.runId,true);
      await archived.getByText(memberFinal,{exact:true}).waitFor();
      assert.equal(await currentView().locator(`[data-testid="team-static-node"][data-agent-id="${memberRole}"]`).count(),0,'历史角色不能回填静态团队树');
      await page.screenshot({path:`test-results/${artifact}-deleted-role-history.png`});
    }
    assert.equal(mainRequests.length,3);assert.equal(memberRequests.length,5);
    // Full application restart verifies archive durability, not just a cached renderer view.
    await desktop.close();desktop=undefined;
    desktop=await electron.launch({executablePath:exe,env:{...process.env,CBIM_USER_DATA_ROOT:user},timeout:60000});
    page=await desktop.firstWindow();page.setDefaultTimeout(30000);page.on('pageerror',error=>pageErrors.push(error.message));
    await page.getByRole('button',{name:'project · 运行中',exact:true}).click();await openTeam();
    const restored=await showRun(memberRole,memberRun.runId,!defaultExecutor);
    await restored.getByText(memberFinal,{exact:true}).waitFor();
    await restored.getByText(candidate,{exact:true}).waitFor();
    assert.equal(mainRequests.length,3);assert.equal(memberRequests.length,5);
    await page.screenshot({path:`test-results/${artifact}-restored-history.png`});
  }
  assert.deepEqual(pageErrors,[]);assert.deepEqual(transportErrors,[]);
  const evidence={packagedExe:exe,realPi:true,realProvider:false,isolatedWorkspace:true,mainInstanceMatchesGraph:true,defaultExecutor,executorIsSeparateInstance:true,executorReleasedAfterCycle:true,mainInstanceRetained:true,mainHasNoBusinessExecutionTools:true,mainHasKnowledgeGovernanceTools:true,modelDispatched:true,memberAutoStarted:true,memberLiveCard:true,graphNodeDetails:true,resultNotAccepted:true,originalConversationContinued:true,systemReturnNotUserBubble:true,userDraftPreserved:true,resultEnvelopeAcknowledged:true,reloadWithoutReplay:true,...(verifyHistory?{staticRoleHistory:true,mainInputAndReturnHistory:true,releasedExecutorHistory:true,deletedRoleHistory:!defaultExecutor,historyAfterAppRestart:true,historyReadWithoutExecution:true}:{}),mainRequests:mainRequests.length,memberRequests:memberRequests.length,pageErrors,transportErrors};
  await fs.writeFile(`test-results/${artifact}-ui-smoke.json`,JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));
}catch(error){
  await fs.mkdir('test-results',{recursive:true});
  if(desktop)await desktop.firstWindow().then(page=>page.screenshot({path:`test-results/${artifact}-ui-failure.png`})).catch(()=>{});
  await fs.writeFile(`test-results/${artifact}-ui-smoke-failure.json`,JSON.stringify({packagedExe:exe,error:String(error),pageErrors,transportErrors,mainRequests:mainRequests.length,memberRequests:memberRequests.length},null,2));
  throw error;
}finally{
  releaseMember();await setup?.shutdown();await desktop?.close();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));
  const root=path.resolve(temp),parent=path.resolve(os.tmpdir());
  assert.equal(path.dirname(root),parent);assert.ok(path.basename(root).startsWith('cbim-collaboration-ui-'));
  await fs.rm(root,{recursive:true,force:true,maxRetries:3,retryDelay:150});
}
