import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {chromium} from 'playwright-core';
const root=process.cwd(),out=path.join(root,'test-results');await fs.mkdir(out,{recursive:true});
await fs.writeFile(path.join(out,'issue12-ui.html'),'<div id="root"></div><script type="module" src="/test-results/issue12-ui.tsx"></script>');
await fs.writeFile(path.join(out,'issue12-ui.tsx'),String.raw`
import React from 'react';import {createRoot} from 'react-dom/client';import '/src/frontend/shell/shell.css';
import {progressFixture,progressMemberRun,progressIdentity} from '/tests/conversation-progress-fixture.ts';
const id=progressIdentity.workspaceId,entry={id,name:'progress-project',path:'C:/fixture',state:'running',instanceId:'instance',tasks:[],revision:'revision'};
window.fixture={phase:Number(sessionStorage.getItem('progress-phase')||0),calls:[],unexpected:[]};
window.cbim={call:async(action,args)=>{const f=window.fixture;f.calls.push({action,args});const value=progressFixture(f.phase);
 if(action==='list')return {entries:[entry]};if(action==='open')return entry;
 if(action==='snapshot')return {workspaceId:id,instanceId:'instance',revision:'revision',files:[]};
 if(action==='loop.list')return [{task:{taskId:'root',workspaceId:id,goal:'中国象棋',mode:'chat'},runId:'main-run',status:'completed'}];
 if(action==='runtime.snapshot')return {workspaces:[{workspaceId:id,availability:'ready'}],runs:[]};
 if(action==='loop.threadView')return {runs:[],issues:[]};
 if(action==='loop.approvals'||action==='loop.questions')return [];
 if(action==='loop.queueDelta')return {epoch:'queue',revision:1,reset:true,order:[],upserts:[]};
 if(action==='dispatch.sessionRead'){const cursor={...value.identity,kind:'scopes',streamId:'scopes:graph',seq:f.phase+1};return {graph:{mode:'reset',reason:'initial',snapshot:value.graph,cursor:value.graph.cursor},scopes:{mode:'reset',reason:'initial',snapshot:{identity:value.identity,cursor,scopes:[value.summary]},cursor},detail:{mode:'updated',stamp:value.summary.stamp,scope:value.scope}}}
 if(action==='dispatch.executionEvents'){const {events,...run}=progressMemberRun(args.taskId,f.phase);return {mode:'reset',run,cursor:{runId:run.runId,seq:events.length},events,hasMore:false}}
 if(action==='models.list')return {profiles:[],secureStorage:true};
 if(action==='resources.status')return {source:'local',session:{state:'signedOut'}};
 if(action==='desktop.updates.status')return {currentVersion:'0.1.1',enabled:false,phase:'disabled'};
 if(action==='admission.read')return {kind:'snapshot',snapshot:{cursor:{streamId:'fixture',revision:1},policy:{revision:1,maxConcurrentRuns:4},occupied:[],waiting:[]}};
 f.unexpected.push(action);throw Error('Unexpected IPC '+action);
}};
const {App}=await import('/src/frontend/shell/App.tsx');createRoot(document.getElementById('root')).render(React.createElement(App));
`);
const server=await createServer({root,configFile:false,esbuild:{jsx:'automatic'},server:{host:'127.0.0.1',port:0},logLevel:'error'});let browser,page;
const errors=[],checks=[];
try{
 await server.listen();browser=await chromium.launch({channel:'msedge',headless:true});page=await browser.newPage({viewport:{width:1200,height:900}});page.setDefaultTimeout(12000);page.on('pageerror',error=>errors.push(error.message));
 await page.goto('http://127.0.0.1:'+server.httpServer.address().port+'/test-results/issue12-ui.html');
 await page.getByRole('button',{name:'progress-project · 运行中',exact:true}).click();await page.locator('.workspace-conversations').getByRole('button',{name:'中国象棋',exact:true}).click();
 const panel=()=>page.getByRole('region',{name:'任务执行进展',exact:true});
 const phase=async n=>{await page.evaluate(n=>{window.fixture.phase=n;sessionStorage.setItem('progress-phase',String(n))},n)};
 await panel().getByText('主 Agent 正在梳理目标与分工',{exact:true}).waitFor();
 await phase(1);await panel().getByText('目标计划已保存 · 第 2 版',{exact:true}).waitFor();assert.match(await panel().innerText(),/规则执行员 → 棋子规则/);
 await phase(2);await panel().getByText('已派发给 规则执行员',{exact:true}).waitFor();await panel().getByText('等待前置任务成果',{exact:true}).waitFor();
 await phase(3);await panel().getByText('规则执行员 · 正在执行',{exact:true}).waitFor();await page.getByRole('region',{name:'成员计划进度'}).getByText('正在执行 · 实现并验证走子逻辑',{exact:true}).first().waitFor();checks.push('planning-dispatch-member-start-and-visible-steps');
 await phase(4);await panel().getByText('前置候选已接收',{exact:true}).waitFor();assert.match(await panel().textContent(),/规则执行员 返回交付候选 · 尚未验收/);await panel().getByText('界面执行员 · 正在执行',{exact:true}).waitFor();checks.push('candidate-evidence-and-dependent-member-start');
 // Pointer position is outside the scroller; subsequent resize-driven updates must not steal a reader's place.
 await page.locator('.chat-scroll').evaluate(node=>{node.scrollTop=0;node.dispatchEvent(new Event('scroll'))});
 await phase(5);await panel().getByText('等待补充 · 执行已暂停',{exact:true}).waitFor();await panel().getByText('主 Agent 请求用户补充',{exact:true}).waitFor();assert.equal(await page.locator('.chat-scroll').evaluate(node=>node.scrollTop),0);checks.push('waiting-user-distinct-and-reader-scroll-preserved');
 await page.reload();await page.getByRole('button',{name:'progress-project · 运行中',exact:true}).click();await page.locator('.workspace-conversations').getByRole('button',{name:'中国象棋',exact:true}).click();await panel().getByText('等待补充 · 执行已暂停',{exact:true}).waitFor();checks.push('reload-reconstructs-saved-progress');
 await phase(6);await panel().getByText('界面执行员 · 执行失败',{exact:true}).waitFor();await panel().getByText('主 Agent 审阅：目标受阻',{exact:true}).waitFor();checks.push('failure-and-blocked-reason-visible');
 await phase(7);await panel().getByText('完成申请待复核',{exact:true}).waitFor();assert.ok(!(await panel().innerText()).includes('目标已完成'));
 await phase(8);await panel().getByText('目标已完成',{exact:true}).waitFor();checks.push('review-request-not-completion-until-reliable-close');
 assert.equal(await panel().locator(':scope > ol > li').count(),6);await panel().locator('.progress-earlier>summary').click();await panel().getByText('目标计划已保存 · 第 2 版',{exact:true}).waitFor();checks.push('older-milestones-expand-without-new-work');
 for(const theme of ['light','dark']){await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);await panel().scrollIntoViewIfNeeded();await page.screenshot({path:path.join(out,'issue12-'+theme+'.png')})}
 await page.setViewportSize({width:320,height:820});await page.getByRole('button',{name:'收起侧栏',exact:true}).click();await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 const sizes=await panel().evaluate(node=>({width:node.clientWidth,scroll:node.scrollWidth}));assert.ok(sizes.scroll<=sizes.width+1);await panel().scrollIntoViewIfNeeded();await page.screenshot({path:path.join(out,'issue12-narrow.png')});checks.push('theme-and-narrow-progress-containment');
 assert.deepEqual(errors,[]);assert.deepEqual(await page.evaluate(()=>window.fixture.unexpected),[]);
 const calls=await page.evaluate(()=>window.fixture.calls);assert.ok(!calls.some(({action})=>/loop\.(chat|resume|stop|enqueue)|dispatch\.(task|start)|commit/.test(action)));
 const report={checks,pageErrors:errors,executionWrites:0,source:'real React App with deterministic public IPC fixtures'};await fs.writeFile(path.join(out,'issue12-ui-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}catch(error){const stem=path.join(out,'issue12-ui-failure-'+Date.now());await fs.writeFile(stem+'.json',JSON.stringify({message:String(error),checks,errors,body:await page?.locator('body').innerText()},null,2));await page?.screenshot({path:stem+'.png'});throw error}finally{await browser?.close();await server.close()}
