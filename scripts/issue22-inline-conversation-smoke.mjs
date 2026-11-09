// Real React App with deterministic persisted-shape IPC fixtures. No model or business writes.
import fs from 'node:fs/promises';import path from 'node:path';import assert from 'node:assert/strict';
import {createServer} from 'vite';import {chromium} from 'playwright-core';
const root=process.cwd(),out=path.join(root,'test-results');await fs.mkdir(out,{recursive:true});
await fs.writeFile(path.join(out,'issue22-ui.html'),'<div id="root"></div><script type="module" src="/test-results/issue22-ui.tsx"></script>');
await fs.writeFile(path.join(out,'issue22-ui.tsx'),String.raw`
import React from 'react';import {createRoot} from 'react-dom/client';import '/src/frontend/shell/shell.css';
import {progressFixture,progressMemberRun,progressIdentity} from '/tests/conversation-progress-fixture.ts';
import {inlineMainRuns} from '/tests/inline-conversation-fixture.ts';
const id=progressIdentity.workspaceId,entry={id,name:'inline-project',path:'C:/fixture',state:'running',instanceId:'instance',tasks:[],revision:'revision'};
window.fixture={phase:Number(sessionStorage.getItem('inline-phase')||0),calls:[],unexpected:[]};
window.cbim={call:async(action,args)=>{const f=window.fixture;f.calls.push({action,args});const value=progressFixture(f.phase),runs=inlineMainRuns(f.phase);
 if(action==='list')return {entries:[entry]};if(action==='open')return entry;
 if(action==='snapshot')return {workspaceId:id,instanceId:'instance',revision:'revision',files:[]};
 if(action==='loop.list')return runs.map(({task,runId,status})=>({task,runId,status}));
 if(action==='runtime.snapshot')return {workspaces:[{workspaceId:id,availability:'ready'}],runs:[]};
 if(action==='loop.threadView')return {runs,issues:[],resumeRunId:runs.at(-1).runId};
 if(action==='loop.approvals'||action==='loop.questions')return [];
 if(action==='loop.queueDelta')return {epoch:'queue',revision:1,reset:true,order:[],upserts:[]};
 if(action==='dispatch.sessionRead'){const cursor={...value.identity,kind:'scopes',streamId:'scopes:graph',seq:f.phase+1};return {graph:{mode:'reset',reason:'initial',snapshot:value.graph,cursor:value.graph.cursor},scopes:{mode:'reset',reason:'initial',snapshot:{identity:value.identity,cursor,scopes:[value.summary]},cursor},detail:{mode:'updated',stamp:value.summary.stamp,scope:value.scope}}}
 if(action==='dispatch.executionEvents'){const {events,...run}=progressMemberRun(args.taskId,f.phase);return {mode:'reset',run,cursor:{runId:run.runId,seq:events.length},events,hasMore:false}}
 if(action==='models.list')return {profiles:[],secureStorage:true};
 if(action==='resources.status')return {source:'local',session:{state:'signedOut'}};
 if(action==='desktop.updates.status')return {currentVersion:'0.1.2',enabled:false,phase:'disabled'};
 if(action==='admission.read')return {kind:'snapshot',snapshot:{cursor:{streamId:'fixture',revision:1},policy:{revision:1,maxConcurrentRuns:4},occupied:[],waiting:[]}};
 f.unexpected.push(action);throw Error('Unexpected IPC '+action);
}};
const {App}=await import('/src/frontend/shell/App.tsx');createRoot(document.getElementById('root')).render(React.createElement(App));
`);
const server=await createServer({root,configFile:false,esbuild:{jsx:'automatic'},server:{host:'127.0.0.1',port:0},logLevel:'error'});let browser,page;
const errors=[],checks=[];
try{
 await server.listen();browser=await chromium.launch({channel:'msedge',headless:true});page=await browser.newPage({viewport:{width:1200,height:900}});page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
 const open=async()=>{await page.getByRole('button',{name:'inline-project · 运行中',exact:true}).click();await page.locator('.workspace-conversations').getByRole('button',{name:'中国象棋',exact:true}).click()};
 await page.goto('http://127.0.0.1:'+server.httpServer.address().port+'/test-results/issue22-ui.html');await open();
 const phase=async n=>{await page.evaluate(n=>{window.fixture.phase=n;sessionStorage.setItem('inline-phase',String(n))},n)};
 const member=n=>page.locator('[data-member-task-id="member-'+n+'"]'),goal=()=>page.getByTestId('conversation-goal-summary');
 await page.getByText('先分析棋子',{exact:true}).waitFor();await phase(1);await page.getByText('先把规则引擎拆成一个任务。',{exact:true}).waitFor();
 assert.equal(await page.getByText('先分析棋子',{exact:true}).count(),0);assert.equal(await page.getByRole('region',{name:'任务执行进展',exact:true}).count(),0);checks.push('stream-final-replacement-and-no-progress-panel');
 await phase(2);await member(1).getByText('待执行',{exact:true}).waitFor();await member(2).getByText('等待前置任务',{exact:true}).waitFor();
 const order=await page.locator('.chat-turn').first().evaluate(node=>[...node.children].map(e=>e.classList.contains('conversation-tool-call')?e.querySelector('[data-tool-call-id]')?.getAttribute('data-tool-call-id'):e.querySelector('.chat-markdown')?.textContent||e.className));
 assert.deepEqual(order.slice(1,7),['先把规则引擎拆成一个任务。','plan','dispatch-member-1','接下来派发棋盘交互，等待规则候选。','dispatch-member-2','已派发，等待成员回传后继续处理。']);
 assert.equal(await page.locator('.chat-tool[data-tool-call-id="dispatch-member-1"]').count(),1);checks.push('text-tool-text-chronology-and-one-card-per-call');
 await phase(3);await member(1).getByText('正在执行',{exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>window.fixture.calls.filter(x=>x.action==='dispatch.executionEvents').length),0);
 await member(1).getByRole('button',{name:'展开成员过程',exact:true}).click();await member(1).getByText('正在执行 · 实现并验证走子逻辑',{exact:true}).waitFor();
 await member(1).getByRole('button',{name:'收起成员过程',exact:true}).click();const reads=await page.evaluate(()=>window.fixture.calls.filter(x=>x.action==='dispatch.executionEvents').length);
 await phase(4);await member(1).getByText('交付待审阅 · 尚未验收',{exact:true}).waitFor();await member(2).getByText('正在执行',{exact:true}).waitFor();
 await page.getByText('已接收前置候选 · 规则执行员：实现象棋走子规则',{exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>window.fixture.calls.filter(x=>x.action==='dispatch.executionEvents').length),reads);checks.push('lazy-member-observation-stop-on-collapse-and-actual-dependency-receipt');
 await page.locator('.inline-handoff>summary').click();await page.getByText('已收到成员任务回传，主 Agent 继续处理',{exact:true}).waitFor();
 assert.equal(await page.locator('.chat-message.user').count(),1);assert.match(await page.locator('.inline-handoff').innerText(),/规则执行员 → 主 Agent/);checks.push('system-handoff-inline-without-fake-user-or-tool-call');
 await page.locator('.chat-scroll').evaluate(node=>{node.scrollTop=0;node.dispatchEvent(new Event('scroll'))});
 await phase(5);await goal().getByText('等待补充 · 执行已暂停',{exact:true}).waitFor();assert.equal(await page.locator('.chat-scroll').evaluate(node=>node.scrollTop),0);checks.push('waiting-controls-and-reader-scroll-preserved');
 await page.reload();await open();await member(2).getByText('交付待审阅 · 尚未验收',{exact:true}).waitFor();
 assert.equal(await page.locator('.chat-tool[data-tool-call-id="dispatch-member-1"]').count(),1);assert.equal(await page.evaluate(()=>window.fixture.calls.filter(x=>x.action==='dispatch.executionEvents').length),0);checks.push('reload-restores-order-and-collapsed-observation-without-replay');
 await phase(6);await member(2).getByText('执行失败',{exact:true}).waitFor();await goal().getByText('目标受阻',{exact:true}).waitFor();
 await phase(7);await goal().getByText('完成申请待复核',{exact:true}).waitFor();assert.ok(!(await goal().innerText()).includes('目标已完成'));
 await phase(8);await goal().getByText('目标已完成',{exact:true}).waitFor();checks.push('failed-member-and-review-distinct-from-reliable-completion');
 for(const theme of ['light','dark']){await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);await page.locator('.chat-turn').first().scrollIntoViewIfNeeded();await page.screenshot({path:path.join(out,'issue22-'+theme+'.png')})}
 await page.setViewportSize({width:320,height:820});await page.getByRole('button',{name:'收起侧栏',exact:true}).click();await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 const sizes=await page.locator('.conversation-tool-call,.inline-handoff').evaluateAll(nodes=>nodes.map(n=>({width:n.clientWidth,scroll:n.scrollWidth})));
 assert.ok(sizes.every(n=>n.scroll<=n.width+1),JSON.stringify(sizes));await page.locator('.inline-handoff').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(out,'issue22-narrow.png')});checks.push('light-dark-and-320px-inline-layout');
 assert.deepEqual(errors,[]);assert.deepEqual(await page.evaluate(()=>window.fixture.unexpected),[]);
 const calls=await page.evaluate(()=>window.fixture.calls);assert.ok(!calls.some(({action})=>/loop\.(chat|resume|stop|enqueue)|dispatch\.(task|start)|commit/.test(action)));
 const report={checks,pageErrors:errors,executionWrites:0,source:'real React App with persisted-shape public IPC fixtures'};await fs.writeFile(path.join(out,'issue22-ui-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}catch(error){const stem=path.join(out,'issue22-ui-failure-'+Date.now());await fs.writeFile(stem+'.json',JSON.stringify({message:String(error),checks,errors,body:await page?.locator('body').innerText()},null,2));await page?.screenshot({path:stem+'.png'});throw error}finally{await browser?.close();await server.close()}
