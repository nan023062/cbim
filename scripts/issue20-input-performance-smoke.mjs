// Real App with synthetic public IPC. Counters instrument Vite's in-memory source only;
// the same history and CPU throttle compare typing without changing shipped code or user records.
import fs from 'node:fs/promises';import path from 'node:path';import assert from 'node:assert/strict';
import {createServer} from 'vite';import {chromium} from 'playwright-core';
const mode=process.argv[2]||'after';assert.ok(['before','after'].includes(mode));const root=process.cwd(),out=path.join(root,'test-results');await fs.mkdir(out,{recursive:true});
await fs.writeFile(path.join(out,'issue20.html'),'<div id="root"></div><script type="module" src="/test-results/issue20.tsx"></script>');
await fs.writeFile(path.join(out,'issue20.tsx'),String.raw`
import React,{Profiler} from 'react';import {createRoot} from 'react-dom/client';import '/src/frontend/shell/shell.css';
const id='a'.repeat(64),time='2026-11-09T10:00:00.000Z',entry={id,name:'long-conversation',path:'C:/fixture',state:'running',instanceId:'instance',tasks:[]};
const task={taskId:'root',workspaceId:id,root:'C:/fixture',goal:'长对话输入验证',moduleIds:[],acceptance:[],mode:'chat'};
let runs=Array.from({length:100},(_,n)=>{const runId='run-'+n;return {task,runId,status:'completed',sessionFile:'test-session',acceptance:'not_evaluated',unresolvedTools:[],events:Array.from({length:6},(_,index)=>({version:1,seq:index+1,workspaceId:id,taskId:'root',runId,time,type:index===0?'run.started':index===5?'run.settled':'message',data:index===0?{message:'用户问题 '+n}:index===5?{}:{text:'# 历史回答 '+n+' / '+index+'\n\n说明项目的实际实现与验证。\n\n- 状态与执行分开\n- 保留文件与来源\n\n| 项目 | 状态 |\n| --- | --- |\n| 输入 | 已验证 |\n\n'+String.fromCharCode(96).repeat(3)+'ts\nconst value = '+n+';\n'+String.fromCharCode(96).repeat(3)}}))}});
window.fixture={calls:[],sent:[],unexpected:[],stats:{markdown:0,transcript:0,usage:0},commits:[],latency:[],bench:false,failSend:false,stream(){const last=runs.at(-1);runs=[...runs.slice(0,-1),{...last,events:[...last.events,{...last.events.at(-1),seq:7,type:'message',data:{text:'增量新增回复已经显示'}}]}]}};
window.cbim={call:async(action,args)=>{const f=window.fixture;f.calls.push({action,args});
 if(action==='list')return {entries:[entry]};if(action==='open')return entry;if(action==='snapshot')return {workspaceId:id,instanceId:'instance',revision:'revision',files:[]};
 if(action==='loop.list')return [{task,runId:runs.at(-1).runId,status:'completed'}];if(action==='loop.threadView')return {runs:structuredClone(runs),issues:[],resumeRunId:runs.at(-1).runId};
 if(action==='runtime.snapshot')return {workspaces:[{workspaceId:id,availability:'ready'}],runs:[]};if(action==='loop.approvals'||action==='loop.questions')return [];
 if(action==='loop.queueDelta')return {epoch:'queue',revision:1,reset:true,order:[],upserts:[]};if(action==='dispatch.sessionRead')throw Error('GRAPH_NOT_FOUND');
 if(action==='models.list')return {selectedId:'profile',profiles:[{id:'profile',name:'Test',defaultModel:'test',models:[{id:'test',name:'Test',enabled:true,contextWindow:32768}]}],secureStorage:true};
 if(action==='resources.status')return {source:'local',session:{state:'signedOut'}};if(action==='desktop.updates.status')return {currentVersion:'0.1.2',enabled:false,phase:'disabled'};
 if(action==='admission.read')return {kind:'snapshot',snapshot:{cursor:{streamId:'fixture',revision:1},policy:{revision:1,maxConcurrentRuns:4},occupied:[],waiting:[]}};
 if(action==='loop.resume'){if(f.failSend)throw Error('测试发送失败');f.sent.push(args);return {taskId:'root'}};
 f.unexpected.push(action);throw Error('Unexpected IPC '+action);
}};
const {App}=await import('/src/frontend/shell/App.tsx');createRoot(document.getElementById('root')).render(<Profiler id="app" onRender={(_,phase,duration)=>{if(window.fixture.bench&&phase==='update')window.fixture.commits.push(duration)}}><App/></Profiler>);
`);
const probes={
 '/src/frontend/run-view/MarkdownMessage.tsx': ['  const [error,setError]=useState','  (window as any).fixture.stats.markdown++;\n  const [error,setError]=useState'],
 '/src/frontend/run-view/transcript.ts':['  const source=run.source','  (window as any).fixture.stats.transcript++;\n  const source=run.source'],
 '/src/frontend/conversation/usage.ts':['  const data=taskUsage','  (window as any).fixture.stats.usage++;\n  const data=taskUsage'],
};
const server=await createServer({root,configFile:false,esbuild:{jsx:'automatic'},plugins:[{name:'input-readonly-probes',enforce:'pre',transform(code,id){const probe=Object.entries(probes).find(([file])=>id.replaceAll('\\','/').endsWith(file));if(!probe)return;assert.ok(code.includes(probe[1][0]),'probe source changed');return code.replace(...probe[1])}}],server:{host:'127.0.0.1',port:0},logLevel:'error'});let browser,page;const checks=[],errors=[];
try{
 await server.listen();browser=await chromium.launch({channel:'msedge',headless:true});page=await browser.newPage({viewport:{width:1200,height:900}});page.setDefaultTimeout(60000);page.on('pageerror',e=>errors.push(e.message));const cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
 await page.goto('http://127.0.0.1:'+server.httpServer.address().port+'/test-results/issue20.html');const open=async()=>{await page.getByRole('button',{name:'long-conversation · 运行中',exact:true}).click();await page.locator('.workspace-conversations').getByRole('button',{name:'长对话输入验证',exact:true}).click();await page.locator('.chat-turn').nth(99).waitFor()};await open();
 assert.equal(await page.locator('.chat-markdown table').count(),400);assert.equal(await page.locator('.chat-code-block').count(),400);
 const input=page.getByRole('textbox',{name:'对话草稿',exact:true});await input.fill('');await page.locator('.chat-scroll').evaluate(node=>{node.scrollTop=0;node.dispatchEvent(new Event('scroll'))});
 await input.evaluate(node=>{node.addEventListener('input',()=>{const start=performance.now();requestAnimationFrame(()=>window.fixture.latency.push(performance.now()-start))});window.fixture.stats={markdown:0,transcript:0,usage:0};window.fixture.commits=[];window.fixture.latency=[];window.fixture.bench=true});
 await input.pressSequentially('abcdef',{delay:20});await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 const metrics=await page.evaluate(()=>{const f=window.fixture;f.bench=false;const describe=a=>{const sorted=[...a].sort((a,b)=>a-b);return {count:a.length,p50:sorted[Math.floor(sorted.length*.5)]??0,p95:sorted[Math.floor(sorted.length*.95)]??0,max:sorted.at(-1)??0}};return {work:{...f.stats},renderMs:describe(f.commits),inputToPaintMs:describe(f.latency)}});
 assert.equal(await input.inputValue(),'abcdef');assert.equal(await page.locator('.chat-scroll').evaluate(node=>node.scrollTop),0);checks.push('100-turns-400-markdown-messages-and-typing-preserves-reader-scroll');
 await fs.writeFile(path.join(out,'issue20-'+mode+'-metrics.json'),JSON.stringify(metrics,null,2));
 if(mode==='after'){assert.equal(metrics.work.markdown,0);assert.equal(metrics.work.transcript,0);assert.equal(metrics.work.usage,0)}
 if(mode==='after'){
 await input.press('Home');await input.pressSequentially('middle-');assert.equal(await input.inputValue(),'middle-abcdef');await page.keyboard.insertText('中文');const draft=await input.inputValue();
 await input.evaluate(node=>node.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true})));assert.equal(await page.evaluate(()=>window.fixture.sent.length),0);
 await page.reload();await open();assert.equal(await input.inputValue(),draft);checks.push('cursor-composition-and-immediate-draft-persistence');
 await page.evaluate(()=>window.fixture.failSend=true);await input.press('Enter');await page.getByRole('alert').filter({hasText:'测试发送失败'}).waitFor();assert.equal(await input.inputValue(),draft);await page.evaluate(()=>window.fixture.failSend=false);await input.press('Enter');await page.waitForFunction(()=>window.fixture.sent.length===1);assert.equal(await page.evaluate(()=>window.fixture.sent[0].message),draft);await page.waitForFunction(()=>document.querySelector('textarea[aria-label="对话草稿"]').value==='');checks.push('failed-send-retains-draft-and-accepted-send-clears-exact-text');
 await page.evaluate(()=>window.fixture.stream());await page.getByText('增量新增回复已经显示',{exact:true}).waitFor();checks.push('new-history-events-still-render');
 await page.evaluate(()=>{const original=window.cbim.call;let step=0;window.fixture.streamStep=n=>{step=n};window.cbim.call=async(action,args)=>{const result=await original(action,args);if(action==='loop.threadView'&&step){const run=result.runs.at(-1),last=run.events.at(-1);run.status=step===3?'completed':'running';run.events.push({...last,seq:8,type:'message.delta',data:{text:'**正在流式'}});if(step>=2)run.events.push({...last,seq:9,type:'message.delta',data:{text:'显示**'}});if(step===3)run.events.push({...last,seq:10,type:'message',data:{text:'流式输出完成'}},{...last,seq:11,type:'run.settled',data:{}})}return result};window.fixture.streamStep(1)});
 const current=page.locator('.chat-turn').last();await current.locator('.work-outcome').getByText('正在工作',{exact:true}).waitFor();await current.getByText('正在流式',{exact:true}).waitFor();const working=await current.locator('.chat-run-status').innerText();await page.waitForFunction(text=>Array.from(document.querySelectorAll('.chat-turn')).at(-1)?.querySelector('.chat-run-status')?.innerText!==text,working);assert.match(await page.locator('.chat-turn').first().locator('.chat-run-status').innerText(),/已工作 0s/);
 await input.pressSequentially('实时输入');await page.evaluate(()=>window.fixture.streamStep(2));await current.getByText('正在流式显示',{exact:true}).waitFor();await page.evaluate(()=>window.fixture.streamStep(3));await current.getByText('流式输出完成',{exact:true}).waitFor();await current.locator('.work-outcome').getByText('本轮结束',{exact:true}).waitFor();assert.equal(await input.inputValue(),'实时输入');checks.push('running-clock-partial-stream-final-text-and-concurrent-draft');
 await page.screenshot({path:path.join(out,'issue20-after.png')});
 }
 assert.deepEqual(errors,[]);assert.deepEqual(await page.evaluate(()=>window.fixture.unexpected),[]);
 const report={mode,turns:100,markdownMessages:400,cpuThrottle:4,metrics,checks,pageErrors:errors,source:'real React App, synthetic public IPC, read-only render counters; not a user hardware latency guarantee'};await fs.writeFile(path.join(out,'issue20-'+mode+'.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}catch(error){const stem=path.join(out,'issue20-'+mode+'-failure-'+Date.now());await fs.writeFile(stem+'.json',JSON.stringify({error:String(error),checks,errors,body:await page?.locator('body').innerText()},null,2));await page?.screenshot({path:stem+'.png'});throw error}finally{await browser?.close();await server.close()}
