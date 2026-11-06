import {_electron as electron} from 'playwright-core';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {latestExecutable} from './build-artifact.mjs';

// Isolated deterministic provider: verifies packaged execution, not real model quality.
const temp=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-loop-smoke-'));
const root=path.join(temp,'project'),user=path.join(temp,'user');await fs.mkdir(root);
let app,requests=0,modelError;
const server=http.createServer(async(req,res)=>{
  try{
    if(req.url==='/article'){res.writeHead(200,{'Content-Type':'text/html'}).end('<h1>WEB_ATTACHMENT_EVIDENCE</h1><script>ignore</script>');return}
    assert.equal(req.headers.authorization,'Bearer packaged-test-secret');
    if(req.method==='GET'){res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({data:[{id:'test-model',context_window:32768,max_output_tokens:4096},{id:'second-model',context_window:65536,max_output_tokens:8192}]}));return}
    let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);
    if(!body.stream){res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({choices:[{message:{content:'OK'}}]}));return}
    requests++;
    assert.ok(JSON.stringify(body.messages).includes('CBIM 的内置主 Agent'));
    assert.ok(!JSON.stringify(body.messages).includes('你是 CBIM 内部团队工作流执行器'));
    assert.ok(body.tools.some(t=>t.function.name==='cbim_workspace_identity'));
    res.writeHead(200,{'Content-Type':'text/event-stream'});
    if(requests===4||requests===15){res.write('data: '+JSON.stringify({id:'waiting',object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta:{role:'assistant',content:'等待停止测试'},finish_reason:null}]})+'\n\n');return}
    if(requests>=9){
      for(const name of (requests<15?['ls','write','edit','bash']:[]))assert.ok(body.tools.some(t=>t.function.name===name),name+' missing');
      const html='<!doctype html><html><title>Game</title><button id="play" onclick="this.textContent=Number(this.textContent)+1">0</button></html>';
      const tools={9:['ls',{path:root}],10:['write',{path:path.join(root,'game/index.html'),content:html}],11:['bash',{command:`node -e "const fs=require('fs'); if(!fs.readFileSync('game/index.html','utf8').includes('Game'))process.exit(1); console.log('GAME_VERIFIED')"`}]};
      if(requests===13)tools[13]=['cbim_ask_user_question',{questions:[{question:'下一步选择哪个方向？',options:[{label:'双人对战',description:'分屏协作'},{label:'音效与最高分',description:'保留当前表现'}]}]}];
      if(requests===14)assert.ok(JSON.stringify(body.messages).includes('优先触屏操作'));
      if(requests===16){assert.equal(body.model,'second-model');assert.ok(!body.tools.some(t=>t.function.name==='write'));assert.ok(JSON.stringify(body.messages).includes('优先执行队列B'))}
      if(requests===17){assert.equal(body.model,'test-model');assert.ok(body.tools.some(t=>t.function.name==='write'));assert.ok(JSON.stringify(body.messages).includes('随后执行队列A'))}
      const next=tools[requests];
      const output=next?{role:'assistant',tool_calls:[{index:0,id:'game-'+requests,type:'function',function:{name:next[0],arguments:JSON.stringify(next[1])}}]}:{role:'assistant',content:'### 已创建游戏\n\n**文件已落盘**，并执行检查。\n\n- [打开游戏](game/index.html)\n\n| 检查 | 结果 |\n| --- | --- |\n| 文件 | 通过 |\n\n```js\nconsole.log("Game");\n```'};
      for(const [delta,finish] of [[output,null],[{},next?'tool_calls':'stop']])res.write('data: '+JSON.stringify({id:'game-'+requests,object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta,finish_reason:finish}]})+'\n\n');res.write('data: '+JSON.stringify({id:'usage-'+requests,object:'chat.completion.chunk',created:1,model:body.model,choices:[],usage:{prompt_tokens:1000,completion_tokens:100,total_tokens:1100}})+'\n\n');res.end('data: [DONE]\n\n');return;
    }
    const approvalCall=requests===5||requests===7;
    if(requests===1){const text=JSON.stringify(body.messages);for(const expected of ['FILE_ATTACHMENT_EVIDENCE','WEB_ATTACHMENT_EVIDENCE','示例链接器'])assert.ok(text.includes(expected),expected)}
    const delta=approvalCall?{role:'assistant',tool_calls:[{index:0,id:'approval-'+requests,type:'function',function:{name:'write',arguments:JSON.stringify({path:path.join(root,requests===5?'approved.txt':'denied.txt'),content:'APPROVED'})}}]}:requests===1?{role:'assistant',tool_calls:[{index:0,id:'packaged-identity',type:'function',function:{name:'cbim_workspace_identity',arguments:'{}'}}]}:{role:'assistant',content:'已通过内部工具核实工作区。'};
    for(const [value,finish] of [[delta,null],[{},requests===1||approvalCall?'tool_calls':'stop']])res.write('data: '+JSON.stringify({id:'smoke-'+requests,object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta:value,finish_reason:finish}]})+'\n\n');
    res.write('data: '+JSON.stringify({id:'usage-'+requests,object:'chat.completion.chunk',created:1,model:body.model,choices:[],usage:{prompt_tokens:1000,completion_tokens:100,total_tokens:1100}})+'\n\n');res.end('data: [DONE]\n\n');
  }catch(error){modelError=error;res.writeHead(500).end(String(error))}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
try{
  const exe=await latestExecutable();app=await electron.launch({executablePath:exe,env:{...process.env,CBIM_USER_DATA_ROOT:user},timeout:60000});
  const page=await app.firstWindow();
  const call=(action,args)=>page.evaluate(({action,args})=>window.cbim.call(action,args),{action,args});
  const entry=await call('add',{path:root});
  await page.getByRole('button',{name:'用户菜单',exact:true}).click();await page.getByRole('menuitem',{name:'设置',exact:true}).click();
  const settings=page.getByRole('region',{name:'模型供应商'});
  await settings.getByRole('button',{name:'添加供应商',exact:true}).click();
  await settings.getByRole('textbox',{name:'名称',exact:true}).fill('本机测试供应商');
  await settings.getByRole('textbox',{name:'API 地址',exact:true}).fill('http://127.0.0.1:'+server.address().port+'/v1');
  await settings.getByLabel('API Key',{exact:true}).fill('packaged-test-secret');
  await settings.getByRole('button',{name:'获取模型列表',exact:true}).click();
  await settings.getByRole('button',{name:'＋ test-model',exact:true}).click();
  await settings.getByRole('button',{name:'＋ second-model',exact:true}).click();
  await settings.getByRole('button',{name:'保存供应商',exact:true}).click();
  await settings.getByRole('button',{name:'测试连接',exact:true}).click();
  await settings.getByRole('status').filter({hasText:'连接成功'}).waitFor();
  const models=await call('models.list');assert.equal(models.profiles.length,1);assert.equal(models.profiles[0].hasKey,true);
  assert.ok(!JSON.stringify(models).includes('packaged-test-secret'));
  assert.ok(!(await fs.readFile(path.join(user,'llm.json'),'utf8')).includes('packaged-test-secret'));
  await page.screenshot({path:'test-results/model-settings.png'});
  await page.getByRole('button',{name:'project · 运行中',exact:true}).click();
  assert.equal(await page.getByRole('combobox',{name:'业务模块',exact:true}).count(),0);
  assert.equal(await page.getByRole('combobox',{name:'执行 Agent',exact:true}).count(),0);
  assert.equal(await page.getByRole('textbox',{name:'验收要求',exact:true}).count(),0);
  await page.getByRole('combobox',{name:'对话模型',exact:true}).click();await page.getByRole('textbox',{name:'搜索模型',exact:true}).fill('test-model');await page.getByRole('option').filter({hasText:'本机测试供应商 / test-model'}).click();
  assert.ok((await page.getByRole('combobox',{name:'执行权限',exact:true}).innerText()).includes('默认权限'));
  const inputFile=path.join(root,'sample.txt');await fs.writeFile(inputFile,'FILE_ATTACHMENT_EVIDENCE');
  const snap=await call('snapshot',{id:entry.id});await call('commit',{workspaceId:entry.id,instanceId:snap.instanceId,revision:snap.revision,requestId:crypto.randomUUID(),changes:[{path:'.cbim/connectors/registry.json',text:JSON.stringify({connectors:[{id:'.cbim/connectors/sample',name:'示例链接器',summary:'说明',plugin:{ghost_id:'sample',namespace:null}}]})}]});
  await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]})},inputFile);
  await page.getByLabel('添加上下文',{exact:true}).click();await page.getByRole('button',{name:'文件',exact:true}).click();await page.getByRole('button',{name:'移除附件 sample.txt',exact:true}).waitFor();
  await app.evaluate(({dialog},folder)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[folder]})},root);
  await page.getByLabel('添加上下文',{exact:true}).click();await page.getByRole('button',{name:'文件夹',exact:true}).click();await page.getByRole('button',{name:'移除附件 project',exact:true}).waitFor();
  for(const kind of ['链接','网页']){await page.getByLabel('添加上下文',{exact:true}).click();await page.getByRole('button',{name:kind,exact:true}).click();await page.getByRole('textbox',{name:kind==='链接'?'链接地址':'网页地址',exact:true}).fill('http://127.0.0.1:'+server.address().port+'/article');await page.getByRole('button',{name:'添加到对话',exact:true}).click();await page.locator('.chat-add-menu:not([open])').waitFor()}
  await page.getByLabel('添加上下文',{exact:true}).click();await page.getByRole('button',{name:'链接器',exact:true}).click();await page.getByRole('combobox',{name:'已登记链接器',exact:true}).selectOption('.cbim/connectors/sample');await page.getByRole('button',{name:'添加到对话',exact:true}).click();await page.getByRole('button',{name:'移除附件 示例链接器',exact:true}).waitFor();
  assert.equal(await page.locator('.chat-composer .composer-attachment').count(),5);
  await page.getByRole('button',{name:'预览附件 sample.txt',exact:true}).click();await page.getByRole('dialog').getByText('FILE_ATTACHMENT_EVIDENCE',{exact:true}).waitFor();await page.getByRole('button',{name:'关闭附件预览',exact:true}).click();
  const dropped=path.join(root,'dropped.txt');await fs.writeFile(dropped,'DROPPED_ATTACHMENT_EVIDENCE');
  await page.evaluate(()=>{const input=document.createElement('input');input.type='file';input.id='native-drop-test';document.body.append(input)});
  await page.locator('#native-drop-test').setInputFiles(dropped);
  await page.evaluate(()=>{const input=document.querySelector('#native-drop-test');const transfer=new DataTransfer();transfer.items.add(input.files[0]);document.querySelector('.chat-input-card').dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer}));input.remove()});
  await page.getByRole('button',{name:'预览附件 dropped.txt',exact:true}).waitFor();await page.getByRole('button',{name:'预览附件 dropped.txt',exact:true}).click();await page.getByRole('dialog').getByText('DROPPED_ATTACHMENT_EVIDENCE',{exact:true}).waitFor();await page.getByRole('button',{name:'关闭附件预览',exact:true}).click();
  await page.getByRole('button',{name:'移除附件 dropped.txt',exact:true}).focus();await page.keyboard.press('Enter');assert.equal(await page.getByRole('button',{name:'预览附件 dropped.txt',exact:true}).count(),0);
  await page.getByRole('combobox',{name:'执行权限',exact:true}).click();await page.getByRole('option').filter({hasText:'只读访问'}).focus();await page.keyboard.press('Escape');assert.equal(await page.getByRole('combobox',{name:'执行权限',exact:true}).getAttribute('aria-expanded'),'false');
  await page.screenshot({path:'test-results/composer-attachments.png'});
  await page.getByRole('combobox',{name:'对话模型',exact:true}).click();await page.screenshot({path:'test-results/composer-model-menu.png'});await page.keyboard.press('Escape');
  await page.getByRole('combobox',{name:'执行权限',exact:true}).click();await page.screenshot({path:'test-results/composer-permission-menu.png'});await page.keyboard.press('Escape');
  await page.getByRole('textbox',{name:'对话草稿',exact:true}).fill('核实工作区');
  await page.getByRole('textbox',{name:'对话草稿',exact:true}).press('Shift+Enter');assert.equal(await page.getByRole('textbox',{name:'对话草稿',exact:true}).inputValue(),'核实工作区\n');await page.getByRole('textbox',{name:'对话草稿',exact:true}).press('Backspace');
  await page.getByRole('button',{name:'发送消息',exact:true}).waitFor();await page.getByRole('textbox',{name:'对话草稿',exact:true}).press('Enter');
  await page.locator('.chat-message.assistant').filter({hasText:'已通过内部工具核实工作区。'}).waitFor({timeout:45000});
  const records=await call('loop.list',{id:entry.id});assert.equal(records.length,1);const run={taskId:records[0].task.taskId,runId:records[0].runId};
  let result;const deadline=Date.now()+45000;
  do{result=await call('loop.inspect',{id:entry.id,taskId:run.taskId,runId:run.runId});if(result.status!=='running')break;await new Promise(resolve=>setTimeout(resolve,100))}while(Date.now()<deadline);
  assert.equal(modelError,undefined);assert.equal(result.status,'completed',JSON.stringify(result.events.at(-1)));
  assert.ok(result.events.some(e=>e.type==='tool.finished'&&e.data.id==='packaged-identity'));
  assert.equal(result.acceptance,'not_evaluated');assert.equal(result.task.mode,'chat');assert.equal(result.task.agentId,'cbim:main');assert.deepEqual(result.task.moduleIds,[]);assert.equal(result.task.workflowContext,undefined);
  assert.ok(!JSON.stringify(result).includes('packaged-test-secret'));
  const modelFile=await fs.readFile(path.join(user,entry.id,'loop-engine','tasks',run.taskId,run.runId,'provider','models.json'),'utf8');
  assert.ok(!modelFile.includes('packaged-test-secret'));assert.ok(modelFile.includes('$CBIM_LLM_API_KEY'));
  assert.ok(result.events.some(e=>e.type==='message.delta'));
  await page.getByRole('textbox',{name:'对话草稿',exact:true}).fill('继续核实');
  await page.getByRole('button',{name:'发送消息',exact:true}).click();
  await page.getByText('继续核实',{exact:true}).waitFor();
  await page.waitForFunction(()=>document.querySelectorAll('.chat-turn').length===2&&[...document.querySelectorAll('.chat-run-status')].every(x=>x.textContent.includes('本轮完成')));
  await page.reload();await page.getByRole('button',{name:'project · 运行中',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('[aria-label="对话模型"]')?.textContent.includes('test-model'));
  await page.getByText('继续核实',{exact:true}).waitFor();
  await page.getByRole('textbox',{name:'对话草稿',exact:true}).fill('等待中断');
  await page.getByRole('button',{name:'发送消息',exact:true}).click();
  await page.getByText('等待停止测试',{exact:true}).waitFor();
  await page.getByRole('button',{name:'停止执行',exact:true}).click();
  await page.waitForFunction(()=>[...document.querySelectorAll('.chat-run-status')].at(-1)?.textContent.includes('已停止'));
  await page.screenshot({path:'test-results/conversation.png'});
  const thread=await call('loop.thread',{id:entry.id,taskId:run.taskId});assert.equal(thread.length,3);assert.equal(thread[1].events[0].data.message,'继续核实');assert.equal(thread[2].status,'cancelled');
  await assert.rejects(call('loop.resume',{id:entry.id,taskId:run.taskId,runId:run.runId,message:'stale',options:{}}),/已有更新/);
  await page.getByRole('combobox',{name:'执行权限',exact:true}).click();await page.getByRole('option').filter({hasText:'默认权限'}).click();
  for(const [message,answer,file] of [['请写入文件','本次任务全部通过','approved.txt'],['再次写入文件','拒绝','denied.txt']]){
    await page.getByRole('textbox',{name:'对话草稿',exact:true}).fill(message);await page.getByRole('button',{name:'发送消息',exact:true}).click();await page.getByRole('button',{name:answer,exact:true}).waitFor();
    assert.equal(await fs.access(path.join(root,file)).then(()=>true,()=>false),false);
    await page.getByRole('button',{name:answer,exact:true}).click();await page.waitForFunction(()=>[...document.querySelectorAll('.chat-run-status')].at(-1)?.textContent.includes('本轮完成'));
    assert.equal(await fs.access(path.join(root,file)).then(()=>true,()=>false),answer!=='拒绝');
  }
  await page.getByRole('combobox',{name:'执行权限',exact:true}).click();await page.getByRole('option').filter({hasText:'完全访问'}).click();
  await page.getByRole('textbox',{name:'对话草稿',exact:true}).fill('创建一个网页游戏并执行验证');await page.getByRole('button',{name:'发送消息',exact:true}).click();
  await page.getByRole('heading',{name:'已创建游戏',exact:true}).waitFor({timeout:60000});
  await page.waitForFunction(()=>[...document.querySelectorAll('.chat-run-status')].at(-1)?.textContent.includes('本轮完成'));
  const gameThread=await call('loop.thread',{id:entry.id,taskId:run.taskId});const gameRun=gameThread.at(-1);
  for(const name of ['ls','write','bash'])assert.ok(gameRun.events.some(e=>e.type==='tool.finished'&&e.data.name===name&&!e.data.isError),JSON.stringify(gameRun.events));
  assert.ok(JSON.stringify(gameRun.events).includes('GAME_VERIFIED'));
  assert.ok((await fs.readFile(path.join(root,'game/index.html'),'utf8')).includes('Game'));
  assert.equal(await page.locator('.chat-markdown table').count(),1);assert.equal(await page.locator('.chat-code-block').count(),1);assert.ok(await page.locator('.chat-markdown strong').count());
  await app.evaluate(({shell})=>{globalThis.__cbimOpened=[];shell.openPath=async file=>{globalThis.__cbimOpened.push(file);return ''}});
  await page.getByRole('link',{name:'打开游戏',exact:true}).click();
  await page.waitForTimeout(200);assert.deepEqual(await app.evaluate(()=>globalThis.__cbimOpened),[path.join(root,'game/index.html')]);
  await assert.rejects(call('chat.openLink',{id:entry.id,target:'.cbim/README.md'}),/业务产物/);
  await assert.rejects(call('chat.openLink',{id:entry.id,target:'javascript:alert(1)'}));
  const {pathToFileURL}=await import('node:url');const {chromium}=await import('playwright-core');
  const browser=await chromium.launch({channel:'msedge',headless:true});try{const game=await browser.newPage();await game.goto(pathToFileURL(path.join(root,'game/index.html')).href);await game.locator('#play').click();assert.equal(await game.locator('#play').innerText(),'1')}finally{await browser.close()}
  assert.equal(modelError,undefined);
  assert.ok(await page.locator('.chat-footer').innerText().then(t=>t.includes('本任务价值')));
  assert.match(await page.locator('.usage-above').innerText(), /\d+\.\d+ tok\/s/);
  assert.match(await page.getByRole('button',{name:'上下文使用与总上限',exact:true}).innerText(), /\d+%/);
  await page.getByRole('button',{name:'任务时间与平均生成速度',exact:true}).click();
  assert.ok((await page.getByRole('region',{name:'任务时间与平均生成速度',exact:true}).innerText()).includes('累计工作时间'));
  await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'上下文使用与总上限',exact:true}).click();
  assert.ok((await page.getByRole('region',{name:'上下文使用与总上限',exact:true}).innerText()).includes('总上下文上限'));
  await page.keyboard.press('Escape');
  const geometry=await page.evaluate(()=>{const q=s=>document.querySelector(s).getBoundingClientRect(),card=q('.chat-input-card'),input=q('.chat-input-card textarea'),controls=q('.chat-controls'),model=q('.chat-controls-right'),send=q('.chat-send');return {cardWidth:card.width,textareaAboveControls:input.bottom<=controls.top+1,modelRight:model.left>card.left+card.width/2,sendWidth:send.width,sendHeight:send.height}});
  assert.equal(geometry.textareaAboveControls,true);assert.equal(geometry.modelRight,true);assert.equal(geometry.sendWidth,28);assert.equal(geometry.sendHeight,28);
  await page.locator('.chat-turn').last().locator('.chat-run-status').click();await page.locator('.chat-turn').last().locator('.chat-tool').last().locator(':scope > summary').click();
  await page.locator('.chat-message.assistant').last().hover();await page.getByRole('button',{name:'复制回复',exact:true}).last().click();await page.locator('.chat-message.assistant').last().getByRole('status').filter({hasText:'已复制'}).waitFor();
  await page.locator('.chat-turn').last().scrollIntoViewIfNeeded();await page.screenshot({path:'test-results/conversation-cindy.png'});
  await page.getByRole('button',{name:'切换浅色模式',exact:true}).click();await page.screenshot({path:'test-results/conversation-cindy-light.png'});await page.getByRole('button',{name:'切换深色模式',exact:true}).click();
  await page.getByRole('textbox',{name:'对话草稿',exact:true}).fill('让我选择下一步');await page.getByRole('button',{name:'发送消息',exact:true}).click();
  const question=page.locator('.question-card');await question.waitFor({timeout:45000});
  assert.equal(await question.getByRole('button',{name:'提交并继续',exact:true}).isDisabled(),true);
  await question.getByRole('radio',{name:'双人对战 分屏协作'}).check();
  await question.getByRole('textbox',{name:'其它补充 1'}).fill('优先触屏操作');
  await question.scrollIntoViewIfNeeded();await page.screenshot({path:'test-results/question-card.png'});
  await question.getByRole('button',{name:'提交并继续',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('.question-card')&&[...document.querySelectorAll('.chat-run-status')].at(-1)?.textContent.includes('本轮完成'));
  assert.equal(modelError,undefined);assert.equal(requests,14);
  await page.getByRole('textbox',{name:'对话草稿',exact:true}).fill('等待队列测试');await page.getByRole('button',{name:'发送消息',exact:true}).click();
  await page.getByRole('button',{name:'停止执行',exact:true}).waitFor();await page.waitForTimeout(1500);
  assert.equal(await page.getByRole('combobox',{name:'执行权限',exact:true}).isEnabled(),true);assert.equal(await page.getByRole('combobox',{name:'对话模型',exact:true}).isEnabled(),true);
  await page.getByRole('textbox',{name:'对话草稿',exact:true}).fill('随后执行队列A');await page.getByRole('button',{name:'加入队列',exact:true}).click();await page.locator('.queued-message').filter({hasText:'随后执行队列A'}).waitFor();
  await page.getByRole('combobox',{name:'对话模型',exact:true}).click();await page.getByRole('option').filter({hasText:'second-model'}).click();
  await page.getByRole('combobox',{name:'执行权限',exact:true}).click();await page.getByRole('option').filter({hasText:'只读访问'}).click();
  await page.getByRole('textbox',{name:'对话草稿',exact:true}).fill('优先执行队列B');await page.getByRole('button',{name:'加入队列',exact:true}).click();
  const queueB=page.locator('.queued-message').filter({hasText:'优先执行队列B'});await queueB.waitFor();await queueB.locator('.queue-grip').press('Alt+ArrowUp');
  await page.waitForFunction(()=>document.querySelector('.queued-message .queue-text')?.textContent==='优先执行队列B');
  await page.screenshot({path:'test-results/message-queue.png'});
  await page.getByRole('button',{name:'停止执行',exact:true}).click();await page.getByRole('button',{name:'继续队列',exact:true}).waitFor();
  await page.waitForFunction(()=>[...document.querySelectorAll('.chat-run-status')].at(-1)?.textContent.includes('已停止'));
  await page.getByRole('button',{name:'继续队列',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('.message-queue')&&[...document.querySelectorAll('.chat-turn')].at(-1)?.textContent.includes('随后执行队列A')&&[...document.querySelectorAll('.chat-run-status')].at(-1)?.textContent.includes('本轮完成'),null,{timeout:60000});
  assert.equal(modelError,undefined);assert.equal(requests,17);
  const otherTask=await call('loop.chat',{id:entry.id,message:'OTHER_SESSION_SENTINEL',options:{permission:'read'}});
  const otherDeadline=Date.now()+45000;while(Date.now()<otherDeadline){const r=await call('loop.inspect',{id:entry.id,taskId:otherTask.taskId,runId:otherTask.runId});if(r.status!=='running')break;await page.waitForTimeout(100)}
  await page.getByRole('textbox',{name:'对话草稿',exact:true}).fill('任务页签草稿');await page.getByRole('tab',{name:'任务视图',exact:true}).click();
  await page.getByRole('heading',{name:'任务视图',exact:true}).waitFor();assert.ok((await page.locator('.session-task-view').innerText()).includes('随后执行队列A'));assert.ok(!(await page.locator('.session-task-view').innerText()).includes('OTHER_SESSION_SENTINEL'));
  await page.screenshot({path:'test-results/session-task-view.png'});await page.getByRole('tab',{name:'对话',exact:true}).click();assert.equal(await page.getByRole('textbox',{name:'对话草稿',exact:true}).inputValue(),'任务页签草稿');
  assert.equal(await page.getByRole('tab',{name:'对话',exact:true}).count(),1);
  await page.getByRole('button',{name:'新对话 project',exact:true}).click();await page.getByRole('heading',{name:'有什么可以帮你？',exact:true}).waitFor();
  assert.ok(await page.locator('.workspace-conversations button').count()>=2);
  await page.getByRole('button',{name:'更多操作 project',exact:true}).click();await page.getByRole('menuitem',{name:'重命名项目',exact:true}).click();
  await page.getByRole('textbox',{name:'项目名称',exact:true}).fill('renamed-project');await page.getByRole('button',{name:'保存名称',exact:true}).click();
  await page.getByRole('button',{name:'renamed-project · 运行中',exact:true}).waitFor();
  const historyButton=page.locator('.workspace-conversations button').filter({hasText:'核实工作区'}).first();await historyButton.click();
  await page.locator('.workspace-panel:not([hidden])').getByText('随后执行队列A',{exact:true}).waitFor();
  await page.screenshot({path:'test-results/workspace-conversations.png'});
  await page.getByRole('button',{name:'更多操作 renamed-project',exact:true}).click();await page.getByRole('menuitem',{name:'移除项目',exact:true}).click();await page.getByRole('button',{name:'确认移除',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('.workspace-group'));await fs.access(path.join(root,'game/index.html'));
  const evidence={sessionTaskIsolation:true,workspaceConversations:true,projectRenameAndRemove:true,messageQueue:true,structuredQuestions:true,packagedExe:exe,defaultMainAgent:true,emptyWorkspaceChat:true,modelSelection:true,internalKnowledge:true,realPiProcess:true,realProvider:false,businessExecution:true,rootListing:true,htmlCreated:true,commandVerified:true,browserGameVerified:true,markdownRendered:true,customComposerMenus:true,attachmentPreview:true,nativeFileDrop:true,composerPreferencePersistence:true,attachments:true,permissionApproval:true,cindyComposerPort:true,elapsedTime:true,geometry,conversationUi:true,streamedText:true,resume:true,stop:true,reloadHistory:true,modelSettingsUi:true,encryptedCredential:true,defaultModel:true,status:result.status,requests};
  await fs.mkdir('test-results',{recursive:true});await fs.writeFile('test-results/loop-smoke.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));
}finally{await app?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}
