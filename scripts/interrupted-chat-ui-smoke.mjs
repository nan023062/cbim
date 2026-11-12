// 真实 App/Conversation，确定性 IPC 夹具；不调用模型、不修改用户数据。
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {chromium} from 'playwright-core';

const root=process.cwd(),out=path.join(root,'test-results');await fs.mkdir(out,{recursive:true});
await fs.writeFile(path.join(out,'interrupted-chat-ui.html'),'<div id="root"></div><script type="module" src="/test-results/interrupted-chat-ui.tsx"></script>');
await fs.writeFile(path.join(out,'interrupted-chat-ui.tsx'),String.raw`
import React from 'react';import {createRoot} from 'react-dom/client';import '/src/frontend/shell/shell.css';
import {progressFixture,progressIdentity,progressTime} from '/tests/conversation-progress-fixture.ts';
import {inlineMainRuns} from '/tests/inline-conversation-fixture.ts';
const id=progressIdentity.workspaceId,instanceId='11111111-1111-4111-8111-111111111111',profileId='22222222-2222-4222-8222-222222222222';
const entry={id,name:'recovery-project',path:'C:/fixture',state:'running',instanceId,tasks:[],revision:'revision'};
window.fixture={mode:'missing',seq:2,calls:[],unexpected:[],set(mode){this.mode=mode;this.seq++}};
const runs=()=>{const run=inlineMainRuns(0)[0],f=window.fixture;run.status='interrupted';run.task.goal='中断对话';run.logIntegrity={partialTail:f.mode==='partial'};run.sessionFile=f.mode==='missing'?undefined:'native.jsonl';run.unresolvedTools=f.mode==='unknown-tool'?['call']:[];
 run.events=[{...run.events[0],data:{...run.events[0].data,engine:'codex',message:'中断对话'}},{...run.events[0],seq:f.seq,type:'run.interrupted',data:{error:'请求未完整完成'}}];return [run]};
window.cbim={call:async(action,args)=>{const f=window.fixture;f.calls.push({action,args});
 if(action==='list')return {entries:[entry]};if(action==='open')return entry;
 if(action==='snapshot')return {workspaceId:id,instanceId,revision:'revision',files:[]};
 if(action==='loop.list')return runs().map(({task,runId,status})=>({task,runId,status}));
 if(action==='runtime.snapshot')return {workspaces:[{workspaceId:id,availability:'ready'}],runs:[]};
 if(action==='loop.threadView')return {runs:runs(),issues:[],resumeRunId:f.mode==='missing-head'?undefined:'main-run'};
 if(action==='loop.approvals'||action==='loop.questions')return [];
 if(action==='loop.queueDelta')return {epoch:'queue',revision:1,reset:true,order:[],upserts:[]};
 if(action==='dispatch.sessionRead'){const value=progressFixture(0),cursor={...value.identity,kind:'scopes',streamId:'scopes:graph',seq:1};value.scope.status='closed';value.summary.status='closed';return {graph:{mode:'reset',reason:'initial',snapshot:value.graph,cursor:value.graph.cursor},scopes:{mode:'reset',reason:'initial',snapshot:{identity:value.identity,cursor,scopes:[value.summary]},cursor},detail:{mode:'updated',stamp:value.summary.stamp,scope:value.scope}}}
 if(action==='agent.mainSettings')return {workspaceId:id,instanceId,agentId:'cbim:main',revision:1,selection:{engine:'codex',profileId,modelId:'fixture'}};
 if(action==='models.list')return {selectedId:profileId,profiles:[{id:profileId,name:'Fixture',api:'openai-responses',defaultModel:'fixture',models:[{id:'fixture',name:'Test model',enabled:true,contextWindow:200000,maxTokens:4096}]}],secureStorage:true};
 if(action==='resources.status')return {source:'local',session:{state:'signedOut'}};
 if(action==='desktop.updates.status')return {currentVersion:'0.1.14',enabled:false,phase:'disabled'};
 if(action==='admission.read')return {kind:'snapshot',snapshot:{cursor:{streamId:'fixture',revision:1},policy:{revision:1,maxConcurrentRuns:4},occupied:[],waiting:[]}};
 f.unexpected.push(action);throw Error('Unexpected IPC '+action);
}};
const {App}=await import('/src/frontend/shell/App.tsx');createRoot(document.getElementById('root')).render(React.createElement(App));
`);
const server=await createServer({root,configFile:false,esbuild:{jsx:'automatic'},server:{host:'127.0.0.1',port:0},logLevel:'error'});
let browser;const errors=[],checks=[];
try{
  await server.listen();browser=await chromium.launch({channel:'msedge',headless:true});
  const page=await browser.newPage({viewport:{width:1200,height:900}});page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://127.0.0.1:'+server.httpServer.address().port+'/test-results/interrupted-chat-ui.html');
  await page.getByRole('button',{name:'recovery-project · 运行中',exact:true}).click();
  const history=page.locator('.workspace-conversations');await history.getByRole('button',{name:'中断对话',exact:true}).click();
  const active=()=>page.locator('.workspace-panel:not([hidden])'),draft=()=>active().getByRole('textbox',{name:'对话草稿'}),notice=()=>active().getByTestId('thread-recovery-notice'),send=()=>active().getByRole('button',{name:'发送消息',exact:true});
  await notice().waitFor();await draft().fill('为什么中断了');assert.equal(await send().isDisabled(),true);
  assert.match(await notice().innerText(),/未登记/);checks.push('missing-binding-explained-with-recovery-actions');
  await draft().press('Enter');assert.equal(await draft().inputValue(),'为什么中断了\n');await draft().fill('为什么中断了');
  await notice().getByRole('button',{name:'查看原运行',exact:true}).click();await active().getByTestId('root-task-detail').waitFor();
  await active().getByRole('tab',{name:'对话',exact:true}).click();assert.equal(await draft().inputValue(),'为什么中断了');checks.push('inspect-original-run-does-not-send-or-clear-draft');
  // 恢复提示不能被模型、权限菜单切换绕过；同一后端运行头补齐后按钮才重新可用。
  await page.evaluate(()=>window.fixture.set('valid'));await notice().waitFor({state:'hidden'});await page.waitForFunction(()=>!document.querySelector('.workspace-panel:not([hidden]) button[aria-label="发送消息"]').disabled);
  checks.push('valid-interrupted-session-can-send');
  for(const [mode,expected] of [['unknown-tool','尚未确认'],['partial','日志不完整'],['missing-head','没有可安全续接']]){
    await page.evaluate(mode=>window.fixture.set(mode),mode);await notice().getByText(new RegExp(expected)).waitFor();assert.equal(await send().isDisabled(),true);
  }
  checks.push('unknown-effects-partial-log-missing-head-remain-blocked');
  await page.evaluate(()=>window.fixture.set('missing'));await notice().getByText(/未登记/).waitFor();
  await page.screenshot({path:path.join(out,'interrupted-chat-recovery.png')});
  await notice().getByRole('button',{name:'新建对话继续',exact:true}).click();await active().getByRole('heading',{name:'有什么可以帮你？'}).waitFor();
  assert.equal(await draft().inputValue(),'');await draft().fill('新的继续请求');await page.waitForFunction(()=>!document.querySelector('.workspace-panel:not([hidden]) button[aria-label="发送消息"]').disabled);
  assert.equal(await notice().count(),0);await history.getByRole('button',{name:'中断对话',exact:true}).click();await notice().waitFor();assert.equal(await draft().inputValue(),'为什么中断了');
  checks.push('new-chat-enabled-original-history-and-draft-preserved');
  const result=await page.evaluate(()=>({unexpected:window.fixture.unexpected,writes:window.fixture.calls.filter(call=>['loop.chat','loop.resume','loop.recoveryStart','loop.queueAdd'].includes(call.action))}));
  assert.deepEqual(result,{unexpected:[],writes:[]});assert.deepEqual(errors,[]);
  await fs.writeFile(path.join(out,'interrupted-chat-ui-report.json'),JSON.stringify({checks,pageErrors:errors,...result},null,2));console.log(JSON.stringify({checks,pageErrors:errors}));
}finally{await browser?.close();await server.close()}
