// 真实 App/Conversation，确定性 IPC 夹具；不调用模型、不修改用户数据。
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {chromium} from 'playwright-core';

const root=process.cwd(),out=path.join(root,'test-results');await fs.mkdir(out,{recursive:true});
await fs.writeFile(path.join(out,'waiting-chat-ui.html'),'<div id="root"></div><script type="module" src="/test-results/waiting-chat-ui.tsx"></script>');
await fs.writeFile(path.join(out,'waiting-chat-ui.tsx'),String.raw`
import React from 'react';import {createRoot} from 'react-dom/client';import '/src/view/shell/shell.css';
import {progressFixture,progressIdentity,progressTime} from '/tests/conversation-progress-fixture.ts';
import {inlineMainRuns} from '/tests/inline-conversation-fixture.ts';
const id=progressIdentity.workspaceId,instanceId='11111111-1111-4111-8111-111111111111',profileId='22222222-2222-4222-8222-222222222222';
const entry={id,name:'waiting-project',path:'C:/fixture',state:'running',instanceId,tasks:[],revision:'revision'};
window.fixture={mode:'waiting',seq:2,calls:[],unexpected:[],set(mode){this.mode=mode;this.seq++}};
const runs=()=>{const run=inlineMainRuns(0)[0];run.status='completed';run.sessionFile='native.jsonl';run.task.goal='等待补充的对话';return [run]};
const waiting=()=>{const value=progressFixture(5);value.graph.tasks=[];value.graph.edges=[];value.graph.agents=value.graph.agents.slice(0,1);return value};
window.cbim={call:async(action,args)=>{const f=window.fixture;f.calls.push({action,args});
 if(action==='list')return {entries:[entry]};if(action==='open')return entry;
 if(action==='snapshot')return {workspaceId:id,instanceId,revision:'revision',files:[]};
 if(action==='loop.list')return runs().map(({task,runId,status})=>({task,runId,status}));
 if(action==='runtime.snapshot')return {workspaces:[{workspaceId:id,availability:'ready'}],runs:[]};
 if(action==='loop.threadView')return {runs:runs(),issues:[],resumeRunId:f.mode==='missing-head'?undefined:'main-run'};
 if(action==='loop.approvals'||action==='loop.questions')return [];
 if(action==='loop.queueDelta')return {epoch:'queue',revision:1,reset:true,order:['queued'],upserts:[{version:1,item:{id:'queued',taskId:'root',message:'稍后处理的其他任务',status:'paused',reason:'当前目标等待用户补充',options:{provider:'cbim-'+profileId,model:'fixture'}}}]};
 if(action==='dispatch.sessionRead'){const value=waiting(),cursor={...value.identity,kind:'scopes',streamId:'scopes:graph',seq:6};return {graph:{mode:'reset',reason:'initial',snapshot:value.graph,cursor:value.graph.cursor},scopes:{mode:'reset',reason:'initial',snapshot:{identity:value.identity,cursor,scopes:[value.summary]},cursor},detail:{mode:'updated',stamp:value.summary.stamp,scope:value.scope}}}
 if(action==='loop.goalContinue'){const request=args;f.request=request;if(f.mode==='unknown')throw Error('IPC_TIMEOUT');return {workspaceId:request.workspaceId,rootSessionId:request.rootSessionId,scopeId:request.scopeId,scopeStatus:'active',continuation:{continuationId:request.commandId,acceptedAt:progressTime,wait:waiting().scope.wait,inputRevision:request.expectedInputRevision+1,input:request.input,runId:'continued-run',options:request.options}}}
 if(action==='loop.goalContinuation')return undefined;
 if(action==='agent.mainSettings')return {workspaceId:id,instanceId,agentId:'cbim:main',revision:1,selection:{engine:'codex',profileId,modelId:'fixture'}};
 if(action==='models.list')return {selectedId:profileId,profiles:[{id:profileId,name:'Fixture',api:'openai-responses',defaultModel:'fixture',models:[{id:'fixture',name:'Test model',enabled:true,contextWindow:200000,maxTokens:4096}]}],secureStorage:true};
 if(action==='resources.status')return {source:'local',session:{state:'signedOut'}};
 if(action==='desktop.updates.status')return {currentVersion:'0.1.14',enabled:false,phase:'disabled'};
 if(action==='admission.read')return {kind:'snapshot',snapshot:{cursor:{streamId:'fixture',revision:1},policy:{revision:1,maxConcurrentRuns:4},occupied:[],waiting:[]}};
 f.unexpected.push(action);throw Error('Unexpected IPC '+action);
}};
const {App}=await import('/src/view/shell/App.tsx');createRoot(document.getElementById('root')).render(React.createElement(App));
`);
const server=await createServer({root,configFile:false,esbuild:{jsx:'automatic'},server:{host:'127.0.0.1',port:0},logLevel:'error'});
let browser;const errors=[],checks=[];
try{
  await server.listen();browser=await chromium.launch({channel:'msedge',headless:true});
  const page=await browser.newPage({viewport:{width:1200,height:900}});page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://127.0.0.1:'+server.httpServer.address().port+'/test-results/waiting-chat-ui.html');
  await page.getByRole('button',{name:'waiting-project · 运行中',exact:true}).click();
  await page.locator('.workspace-conversations').getByRole('button',{name:'等待补充的对话',exact:true}).click();
  const active=()=>page.locator('.workspace-panel:not([hidden])'),draft=()=>active().getByRole('textbox',{name:'对话草稿'}),composer=()=>active().locator('.chat-composer');
  await active().getByTestId('conversation-waiting').waitFor();
  assert.match(await active().getByTestId('conversation-waiting').innerText(),/发送将补充并继续原目标/);
  await draft().fill('继续');
  await page.waitForFunction(()=>!document.querySelector('.workspace-panel:not([hidden]) button.chat-send[aria-label="补充并继续"]').disabled);
  await draft().press('Enter');
  await composer().getByTestId('scope-continuation-accepted').waitFor();assert.equal(await draft().inputValue(),'');
  const result=await page.evaluate(()=>({unexpected:window.fixture.unexpected,writes:window.fixture.calls.filter(call=>['loop.goalContinue','loop.enqueue','loop.resume','loop.chat','loop.queueInsert','loop.queueChange'].includes(call.action))}));
  assert.equal(result.writes.length,1);assert.equal(result.writes[0].action,'loop.goalContinue');assert.equal(result.writes[0].args.input.message,'继续');assert.equal(result.writes[0].args.scopeId,'scope-one');assert.equal(result.writes[0].args.waitId,'wait');assert.equal(result.writes[0].args.options.engine,'codex');
  assert.match(await composer().locator('.message-queue').innerText(),/稍后处理的其他任务/);assert.deepEqual(result.unexpected,[]);
  checks.push('Enter continues exact waiting goal instead of enqueue; existing queue preserved');
  // 新 renderer 会话验证未知回执：不能把保留内容再入队，查询入口就在输入区。
  await page.evaluate(()=>localStorage.clear());await page.reload();await page.evaluate(()=>window.fixture.set('unknown'));
  await page.getByRole('button',{name:'waiting-project · 运行中',exact:true}).click();
  await page.locator('.workspace-conversations').getByRole('button',{name:'等待补充的对话',exact:true}).click();
  await active().getByTestId('conversation-waiting').waitFor();await draft().fill('继续');
  await composer().getByRole('button',{name:'补充并继续',exact:true}).click();
  await composer().getByTestId('scope-continuation-unknown').waitFor();assert.equal(await draft().inputValue(),'');
  await draft().fill('再继续');assert.equal(await composer().locator('button.chat-send[aria-label="补充并继续"]').isDisabled(),true);
  assert.equal(await composer().getByRole('button',{name:'查询提交状态',exact:true}).count(),1);
  const pending=await page.evaluate(()=>({unexpected:window.fixture.unexpected,writes:window.fixture.calls.filter(call=>['loop.goalContinue','loop.enqueue','loop.resume','loop.chat','loop.queueInsert'].includes(call.action))}));
  assert.equal(pending.writes.length,1);assert.equal(pending.writes[0].action,'loop.goalContinue');assert.deepEqual(pending.unexpected,[]);assert.deepEqual(errors,[]);
  checks.push('unknown receipt keeps original request visible and blocks duplicate ordinary send');
  await page.screenshot({path:path.join(out,'waiting-chat-recovery.png')});
  await fs.writeFile(path.join(out,'waiting-chat-ui-report.json'),JSON.stringify({checks,pageErrors:errors},null,2));console.log(JSON.stringify({checks,pageErrors:errors}));
}finally{await browser?.close();await server.close()}
