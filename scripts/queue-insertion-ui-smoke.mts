import {_electron as electron,type ElectronApplication} from 'playwright-core';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {Application} from '../src/backend/main/application';
import {Paths} from '../src/backend/main/platform/paths';
import {insertionData as data,insertionProvider} from '../tests/queue-insertion-provider';
import {insertionWait,seedInsertion} from '../tests/queue-insertion-fixture';
import {latestExecutable} from './build-artifact.mjs';

// 仅本测试进程/快照的读取返回可延迟；文件、Pi、队列以及停止按钮均为真实生产路径。
// --unknown 丢弃已成功插入的桌面 IPC 回复，区别于 Pi ACK 未知时保留暂停队列的定向测试。
const stopping=process.argv.includes('--stop'),unknown=process.argv.includes('--unknown');assert.ok(!(stopping&&unknown));
const mode=stopping?'stop':unknown?'unknown':'complete',artifact='queue-insertion-'+mode,exe=await latestExecutable(),temp=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-queue-insertion-ui-')),project=path.join(temp,'project'),user=path.join(temp,'user');
const provider=await insertionProvider(),pageErrors:string[]=[];let desktop:ElectronApplication|undefined,setup:Application|undefined,keepTemp=false,report:Record<string,unknown>|undefined;
try{
  setup=new Application(new Paths(user,path.resolve('.')),path.resolve('design'));await setup.init();const seed=await seedInsertion(setup,project,provider),{entry}=seed;await setup.shutdown();setup=undefined;
  desktop=await electron.launch({executablePath:exe,env:{...process.env,CBIM_USER_DATA_ROOT:user},timeout:60000});let page=await desktop.firstWindow();page.setDefaultTimeout(30000);page.on('pageerror',error=>pageErrors.push(error.message));
  const call=(action:string,args:unknown={})=>page.evaluate(({action,args})=>(window as any).cbim.call(action,args),{action,args}),active=()=>page.locator('.workspace-panel:not([hidden])'),input=()=>active().getByRole('textbox',{name:'对话草稿',exact:true});
  await desktop.evaluate(({ipcMain},{unknown})=>{const handlers=(ipcMain as any)._invokeHandlers,original=handlers.get('cbim:call');let dropped=false;(globalThis as any).__queueInsertionTrace=[];handlers.set('cbim:call',async(event:unknown,action:string,args:unknown)=>{
    const trace=action==='loop.queueInsert'||action==='loop.stop'?{action,args,phase:'entered',result:undefined as unknown}:undefined;if(trace)(globalThis as any).__queueInsertionTrace.push(trace);
    const result=await original(event,action,args);if(trace){trace.phase='returned';trace.result=result}if(unknown&&action==='loop.queueInsert'&&!dropped&&result?.ok){dropped=true;return {ok:false,error:{code:'TEST_RESPONSE_LOST',message:'测试丢弃一次已成功插入的 IPC 回复；请查看原运行，不自动重插'}}}return result;
  })},{unknown});
  await page.getByRole('button',{name:'project · 运行中',exact:true}).click();await active().getByRole('combobox',{name:'执行权限',exact:true}).click();await active().getByRole('option',{name:/只读访问/}).click();await input().fill(data.goal);await active().getByRole('button',{name:'发送消息',exact:true}).click();await insertionWait(async()=>provider.requests.length===1,'首轮实际模型请求保持进行');
  const first=(await call('loop.list',{id:entry.id}))[0],rootSessionId=first.task.taskId,runId=first.runId,identity={workspaceId:entry.id,rootSessionId},queue=()=>call('loop.queue',{id:entry.id,taskId:rootSessionId}),thread=()=>call('loop.thread',{id:entry.id,taskId:rootSessionId});
  if(stopping){
    // 真实 API 预先建立含自己 PNG 快照的排队项，避免把原生选择器测试重复成此片前提。
    await call('loop.enqueue',{id:entry.id,taskId:rootSessionId,message:data.insert,attachments:[seed.image.id],options:seed.queuedOptions});
  }else{
    await active().getByRole('combobox',{name:'执行权限',exact:true}).click();await active().getByRole('option',{name:/完全访问/}).click();await active().getByRole('combobox',{name:'对话模型',exact:true}).click();await active().getByRole('option',{name:new RegExp(data.otherModel)}).click();await input().fill(data.insert);await active().getByRole('button',{name:'加入队列',exact:true}).click();
  }
  const queueView=active().locator('.message-queue');await queueView.getByText(data.insert,{exact:true}).waitFor();const queued=(await queue())[0];assert.equal(queued.options.permission,'execute');assert.equal(queued.options.model,data.otherModel);
  await input().fill(data.draft);await fs.mkdir('test-results',{recursive:true});await queueView.scrollIntoViewIfNeeded();await page.screenshot({path:`test-results/${artifact}-queued.png`});
  if(stopping)await desktop.evaluate(async(_,{snapshot})=>{
    const actual=process.getBuiltinModule('fs/promises') as typeof import('node:fs/promises'),original=actual.readFile;let release!:()=>void,entered=false;const gate=new Promise<void>(resolve=>release=resolve);
    (globalThis as any).__queueSnapshotDelay={get entered(){return entered},release,restore(){actual.readFile=original}};
    actual.readFile=(async(...args:Parameters<typeof original>)=>{const result=await (original as any)(...args);if(!entered&&String(args[0])===snapshot){entered=true;await gate}return result}) as typeof original;
  },{snapshot:seed.snapshot});
  await queueView.locator('.queue-row').first().hover();await queueView.getByRole('button',{name:'插入第 1 条到当前任务',exact:true}).click();
  if(stopping){
    await insertionWait(async()=>desktop!.evaluate(()=>(globalThis as any).__queueSnapshotDelay?.entered===true),'真实附件读取已完成、返回待放行');assert.equal(await active().getByRole('button',{name:'停止执行',exact:true}).isEnabled(),true);await page.screenshot({path:`test-results/${artifact}-inserting-stop-available.png`});await active().getByRole('button',{name:'停止执行',exact:true}).click();
    await insertionWait(async()=>desktop!.evaluate(()=>(globalThis as any).__queueInsertionTrace.some((item:any)=>item.action==='loop.stop')),'真实停止按钮已发出原会话 stop');await desktop.evaluate(()=>{(globalThis as any).__queueSnapshotDelay.release();(globalThis as any).__queueSnapshotDelay.restore()});
    await insertionWait(async()=>(await thread())[0].status==='cancelled'&&(await queue())[0]?.status==='paused','停止拒绝迟到插入并保留排队项');assert.equal(provider.requests.length,1);assert.equal((await queue())[0].id,queued.id);provider.release();
  }else{
    await insertionWait(async()=>(await queue()).length===0,'实际插入已消费原队列');assert.equal(provider.requests.length,1);assert.equal((await thread())[0].status,'running');if(unknown){await active().getByRole('alert').filter({hasText:'TEST_RESPONSE_LOST'}).waitFor();await page.screenshot({path:`test-results/${artifact}-response-lost.png`})}provider.release();
    await insertionWait(async()=>(await thread())[0].status==='completed'&&(await call('runtime.snapshot')).pressure.activeRuns===0,'原工具与插入同run结束');
    const summary=(await thread())[0];assert.equal(summary.toolReceipts.find((item:any)=>item.toolCallId==='queue-original-read').outcome,'succeeded');assert.equal(summary.events.filter((event:any)=>event.type==='engine.status'&&event.data.metric==='insertion'&&event.data.state==='accepted').length,1);assert.equal(provider.requests.length,2);assert.ok(JSON.stringify(provider.requests[1].messages).includes(data.insert));assert.equal(provider.earlyClosed,0);
    assert.ok(provider.requests.every(request=>request.model===data.model));assert.ok(provider.requests.every(request=>!request.tools?.some(tool=>['write','edit','bash'].includes(tool.function.name))));
  }
  assert.equal(await input().inputValue(),data.draft);let freshRunId:string|undefined;
  if(stopping){
    // 暂停队列存在时普通输入按既有语义继续排队；这里通过真实显式 IPC 建新轮验证迟到身份，非普通草稿直发。
    await call('loop.resume',{id:entry.id,taskId:rootSessionId,runId,message:data.fresh,options:seed.options});await insertionWait(async()=>provider.requests.length===2,'测试显式 IPC 创建真实新主轮');freshRunId=(await thread()).at(-1).runId;assert.notEqual(freshRunId,runId);
    await assert.rejects(call('loop.queueInsert',{id:entry.id,taskId:rootSessionId,queueId:queued.id,expectedRunId:runId}),/QUEUE_INSERT_STALE/);assert.equal((await queue())[0].id,queued.id);assert.ok(!JSON.stringify(provider.requests[1].messages).includes(data.insert));provider.releaseFresh();await insertionWait(async()=>(await thread()).at(-1).status==='completed'&&(await call('runtime.snapshot')).pressure.activeRuns===0,'新主轮结束但旧队列仍暂停');
  }
  await page.screenshot({path:`test-results/${artifact}-settled.png`});const savedThread=await thread(),savedQueue=await queue(),scopes=await seed.scopes(),graph=await call('dispatch.graphSnapshot',{identity}),native=await fs.readFile(savedThread.at(-1).sessionFile,'utf8'),counts=provider.requests.length;
  const trace=await desktop.evaluate(()=>(globalThis as any).__queueInsertionTrace),attempts=trace.filter((item:any)=>item.action==='loop.queueInsert');assert.equal(attempts.length,stopping?2:1);assert.equal(attempts[0].args.expectedRunId,runId);assert.equal(attempts[0].result.ok,!stopping);if(stopping)assert.equal(trace.filter((item:any)=>item.action==='loop.stop').length,1);
  await desktop.close();desktop=undefined;desktop=await electron.launch({executablePath:exe,env:{...process.env,CBIM_USER_DATA_ROOT:user},timeout:60000});page=await desktop.firstWindow();page.setDefaultTimeout(30000);page.on('pageerror',error=>pageErrors.push(error.message));await page.getByRole('button',{name:'project · 运行中',exact:true}).click();await page.locator('.workspace-conversations button').filter({hasText:data.goal}).first().click();await input().waitFor();
  assert.deepEqual(await thread(),savedThread);assert.deepEqual(await queue(),savedQueue.map((item:any)=>({...item,status:'paused',reason:'应用已重启，请确认后继续队列'})));assert.deepEqual(await seed.scopes(),scopes);assert.deepEqual(await call('dispatch.graphSnapshot',{identity}),graph);assert.equal(await fs.readFile(savedThread.at(-1).sessionFile,'utf8'),native);assert.equal(provider.requests.length,counts);assert.equal(await input().inputValue(),data.draft);assert.equal((await call('runtime.snapshot')).pressure.activeRuns,0);
  if(stopping)await active().locator('.message-queue').getByText(data.insert,{exact:true}).waitFor();await page.screenshot({path:`test-results/${artifact}-restored.png`});assert.equal(await fs.readFile(path.join(project,'queue-original.txt'),'utf8'),data.fact);assert.deepEqual(pageErrors,[]);assert.deepEqual(provider.errors,[]);
  report={packagedExe:exe,mode,realPi:true,onlineProvider:false,expectedRunId:runId,freshRunId,freshRunStartedViaExplicitTestIpc:stopping,queueId:queued.id,actualUIInsert:true,stopClickedDuringActualSnapshotRead:stopping,stopBeforeNativeInjection:stopping,oldMessageAbsentFromFreshRun:stopping,oldQueuePaused:stopping,realQueuedAckBeforeDesktopReplyLoss:unknown,noAutomaticReinsert:true,originalReadUninterrupted:!stopping,noPermissionOrModelEscalation:!stopping,ordinaryDraftPreserved:true,restartNoReplay:true,recordsAndNativeBytesUnchanged:true,requests:counts,pageErrors,transportErrors:provider.errors,trace,temp};
}catch(error){keepTemp=true;await fs.mkdir('test-results',{recursive:true});if(desktop)await desktop.firstWindow().then(page=>page.screenshot({path:`test-results/${artifact}-failure.png`})).catch(()=>{});const dom=desktop?await desktop.firstWindow().then(page=>page.locator('.workspace-panel:not([hidden])').innerText()).catch(()=>undefined):undefined;await fs.writeFile(`test-results/${artifact}-ui-failure.json`,JSON.stringify({exe,temp,error:String(error),dom,requests:provider.requests,pageErrors,providerErrors:provider.errors},null,2));throw error}
finally{if(desktop)await desktop.evaluate(()=>{(globalThis as any).__queueSnapshotDelay?.release();(globalThis as any).__queueSnapshotDelay?.restore()}).catch(()=>{});provider.release();provider.releaseFresh();if(desktop)await desktop.close().catch(()=>{});if(setup)await setup.shutdown();await provider.close();if(!keepTemp){const target=path.resolve(temp);assert.equal(path.dirname(target),path.resolve(os.tmpdir()));assert.ok(path.basename(target).startsWith('cbim-queue-insertion-ui-'));await fs.rm(target,{recursive:true,force:true});if(report){report.cleanup={desktopClosed:true,providerClosed:true,tempRemoved:await fs.stat(target).then(()=>false,()=>true)};await fs.writeFile(`test-results/${artifact}-ui-smoke.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report))}}}
