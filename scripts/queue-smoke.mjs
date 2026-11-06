// Packaged desktop interaction test with a deterministic local model, never a paid provider.
import {_electron as electron} from 'playwright-core';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {latestExecutable} from './build-artifact.mjs';
const temp=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-queue-smoke-')),root=path.join(temp,'project'),user=path.join(temp,'user');await fs.mkdir(root);
let app,release=()=>{};const requests=[],syncChecks=[];
const server=http.createServer(async(req,res)=>{
 let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);requests.push(body);const number=requests.length;
 res.writeHead(200,{'Content-Type':'text/event-stream'});
 const send=(delta,finish_reason)=>res.write('data: '+JSON.stringify({id:'queue-'+number,object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta,finish_reason}]})+'\n\n');
 send({role:'assistant',content:number===1?'正在处理当前任务。':number===3?'正在处理排队任务。':'已处理补充消息。'},null);
 if(number===1||number===3)await new Promise(r=>release=r);
 send({},'stop');res.end('data: [DONE]\n\n');
});await new Promise(r=>server.listen(0,'127.0.0.1',r));
try{
 const exe=await latestExecutable();app=await electron.launch({executablePath:exe,env:{...process.env,CBIM_USER_DATA_ROOT:user},timeout:60000});const page=await app.firstWindow();page.setDefaultTimeout(20000);
 const call=(action,args)=>page.evaluate(({action,args})=>window.cbim.call(action,args),{action,args});
 await call('models.save',{profile:{name:'排队测试',api:'openai-completions',baseUrl:'http://127.0.0.1:'+server.address().port+'/v1',auth:'none',models:[{id:'test-model',name:'test-model',enabled:true,reasoning:false,contextWindow:32768,maxTokens:1024}],defaultModel:'test-model'}});
 const entry=await call('add',{path:root});await page.getByRole('button',{name:'project · 运行中',exact:true}).click();
 const input=page.getByRole('textbox',{name:'对话草稿',exact:true});await input.fill('开始当前任务');await input.press('Enter');await page.getByText('正在处理当前任务。',{exact:true}).waitFor();
 const queue=page.locator('.chat-input-card .message-queue');
 const task=(await call('loop.list',{id:entry.id}))[0].task.taskId;
 // Compare rendered order with the durable queue, then observe several polling cycles for regressions.
 async function synced(label,expected){
  const start=Date.now();await page.waitForFunction(expected=>JSON.stringify([...document.querySelectorAll('.chat-input-card .queue-text')].map(x=>x.textContent))===JSON.stringify(expected),expected);
  const latencyMs=Date.now()-start;assert.deepEqual((await call('loop.queue',{id:entry.id,taskId:task})).map(x=>x.message.split('\n')[0]),expected);
  const snapshot=await call('loop.queueDelta',{id:entry.id,taskId:task});const cursor={epoch:snapshot.epoch,revision:snapshot.revision,items:Object.fromEntries(snapshot.upserts.map(x=>[x.item.id,x.version]))};
  const unchanged=await call('loop.queueDelta',{id:entry.id,taskId:task,cursor});assert.equal(unchanged.order,undefined);assert.equal(unchanged.upserts,undefined);
  await page.evaluate(()=>{window.queueMutations=0;window.queueObserver=new MutationObserver(records=>window.queueMutations+=records.length);const list=document.querySelector('.chat-input-card .queue-list');if(list)window.queueObserver.observe(list,{subtree:true,childList:true,characterData:true,attributes:true})});
  const observations=await page.evaluate(async expected=>{const samples=[];for(let i=0;i<16;i++){samples.push([...document.querySelectorAll('.chat-input-card .queue-text')].map(x=>x.textContent));await new Promise(r=>setTimeout(r,200))}return samples},expected);
  for(const order of observations)assert.deepEqual(order,expected,label+' reverted during polling');
  const mutations=await page.evaluate(()=>{window.queueObserver.disconnect();return window.queueMutations});assert.equal(mutations,0,label+' rewrote stable queue DOM');
  assert.equal((await call('loop.thread',{id:entry.id,taskId:task})).at(-1).status,'running');syncChecks.push({label,expected,latencyMs,pollObservationMs:3200,samples:observations.length,unchangedResponseBytes:JSON.stringify(unchanged).length,stableQueueDomMutations:mutations});
 }
 for(let n=1;n<=3;n++){await input.fill('测试对话排队'+n);await input.press('Enter');await queue.getByText('测试对话排队'+n,{exact:true}).waitFor()}
 await synced('add while running',['测试对话排队1','测试对话排队2','测试对话排队3']);
 await input.fill('尚未发送的草稿');await queue.locator('.queue-row').nth(1).hover();await queue.getByRole('button',{name:'编辑第 2 条消息',exact:true}).click();
 await queue.getByRole('textbox',{name:'编辑排队消息'}).fill('测试对话排队2（已编辑）');await queue.getByRole('button',{name:'保存',exact:true}).click();await queue.getByText('测试对话排队2（已编辑）',{exact:true}).waitFor();assert.equal(await input.inputValue(),'尚未发送的草稿');
 await queue.getByRole('button',{name:'拖动第 2 条消息排序'}).dragTo(queue.locator('.queue-row').first());
 await page.waitForFunction(()=>document.querySelector('.chat-input-card .queue-text')?.textContent==='测试对话排队2（已编辑）');
 await synced('drag while running',['测试对话排队2（已编辑）','测试对话排队1','测试对话排队3']);
 await queue.locator('.queue-row').nth(2).hover();await queue.getByRole('button',{name:'删除第 3 条消息',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.chat-input-card .queue-text').length===2);
 await synced('delete while running',['测试对话排队2（已编辑）','测试对话排队1']);
 const box=await queue.boundingBox(),card=await page.locator('.chat-input-card').boundingBox();assert.ok(box.y>=card.y&&box.y+box.height<card.y+card.height);
 await fs.mkdir('test-results',{recursive:true});await queue.locator('.queue-row').first().hover();await page.screenshot({path:'test-results/queue-composer.png'});
 await queue.locator('.queue-row').first().focus();await queue.locator('.queue-row').first().press('Control+Enter');await page.waitForFunction(()=>document.querySelectorAll('.chat-input-card .queue-text').length===1);assert.equal(requests.length,1);assert.equal(await input.inputValue(),'尚未发送的草稿');
 release();await page.getByText('正在处理排队任务。',{exact:true}).waitFor();await synced('queued item starts and leaves queue',[]);
 for(const text of ['后续任务A','后续任务B']){await input.fill(text);await input.press('Enter');await queue.getByText(text,{exact:true}).waitFor()}
 await synced('add during queued task execution',['后续任务A','后续任务B']);
 await queue.getByRole('button',{name:'拖动第 2 条消息排序'}).dragTo(queue.locator('.queue-row').first());await synced('drag during queued task execution',['后续任务B','后续任务A']);
 await queue.locator('.queue-row').first().hover();await queue.getByRole('button',{name:'删除第 1 条消息',exact:true}).click();await synced('delete during queued task execution',['后续任务A']);
 await queue.locator('.queue-row').first().hover();await queue.getByRole('button',{name:'删除第 1 条消息',exact:true}).click();await synced('delete last item hides queue',[]);release();
 for(let i=0;i<100;i++){const runs=await call('loop.thread',{id:entry.id,taskId:task});if(runs.length===2&&runs.every(r=>r.status==='completed'))break;if(i===99)throw Error('Queue did not settle');await new Promise(r=>setTimeout(r,100))}
 assert.ok(JSON.stringify(requests[1]).includes('测试对话排队2（已编辑）'));assert.equal(requests.length,3);
 const evidence={exe,embeddedQueue:true,editPreservesDraft:true,dragSort:true,delete:true,keyboardInsert:true,noAbort:true,remainingQueueExecuted:true,syncChecks,realPi:true,realProvider:false};await fs.writeFile('test-results/queue-smoke.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));
}finally{release();await app?.close();server.closeAllConnections();await new Promise(r=>server.close(r))}
