import {_electron as electron,type ElectronApplication} from 'playwright-core';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {Application} from '../src/bridge/server/application';
import {Paths} from '../src/logic/workspace/service/paths';
import {activeInputData as data,activeInputProvider} from '../tests/active-goal-input-provider';
import {activeInputWait,seedActiveInput} from '../tests/active-goal-input-fixture';
import {latestExecutable} from './build-artifact.mjs';

// Fault modes wrap only the test EXE's own Pi pipe after an actual queued ACK.
// Original command IDs/replies are retained; no scheduler state, tool result or success receipt is fabricated.
const stopping=process.argv.includes('--stop'),unknown=process.argv.includes('--unknown');assert.ok(!(stopping&&unknown));
const mode=stopping?'stop':unknown?'unknown':'complete',artifact='active-goal-input-'+mode,exe=await latestExecutable();
const temp=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-active-input-ui-')),project=path.join(temp,'project'),user=path.join(temp,'user');
const provider=await activeInputProvider(stopping||unknown?'stale-complete':'twice-waiting'),pageErrors:string[]=[];
let desktop:ElectronApplication|undefined,setup:Application|undefined,keepTemp=false,report:Record<string,unknown>|undefined;
try{
  await fs.mkdir(project,{recursive:true});setup=new Application(new Paths(user,path.resolve('.')),path.resolve('design'));await setup.init();const seed=await seedActiveInput(setup,project,user,provider),{entry}=seed;await setup.shutdown();setup=undefined;
  desktop=await electron.launch({executablePath:exe,env:{...process.env,CBIM_USER_DATA_ROOT:user},timeout:60000});let page=await desktop.firstWindow();page.setDefaultTimeout(30000);page.on('pageerror',error=>pageErrors.push(error.message));
  const call=(action:string,args:unknown={})=>page.evaluate(({action,args})=>(window as any).cbim.call(action,args),{action,args}),active=()=>page.locator('.workspace-panel:not([hidden])'),input=()=>active().getByRole('textbox',{name:'对话草稿',exact:true});
  await desktop.evaluate(({ipcMain},{stopping,unknown,model})=>{
    const handlers=(ipcMain as any)._invokeHandlers,original=handlers.get('cbim:call');(globalThis as any).__activeInputIpc=[];
    handlers.set('cbim:call',async(event:unknown,action:string,args:unknown)=>{const tracked=['loop.queueInsert','loop.stop','loop.goalContinue'].includes(action),trace={action,args,result:undefined as unknown};if(tracked)(globalThis as any).__activeInputIpc.push(trace);const pending=original(event,action,args);
      // The real click has invoked stop. Release this already received ACK in the same stack,
      // rather than add a renderer round-trip that could let process close hide it first.
      if(stopping&&action==='loop.stop'){const transport=(globalThis as any).__activeInputTransport;if(transport?.held){transport.records.at(-1).releaseTriggeredBy='real_stop_ipc';transport.release()}}
      const result=await pending;if(tracked)trace.result=result;return result});
    const processModule=process.getBuiltinModule('child_process') as any,spawn=processModule.spawn;
    const state={records:[] as any[],held:false,release(){},restore(){processModule.spawn=spawn}};(globalThis as any).__activeInputTransport=state;
    if(!stopping&&!unknown)return;
    const replacement={spawn(...args:any[]){
      const child=spawn(...args),argv=Array.isArray(args[1])?args[1]:[],modeIndex=argv.indexOf('--mode'),modelIndex=argv.indexOf('--model');
      if(!child.stdin||!child.stdout||modeIndex<0||argv[modeIndex+1]!=='rpc'||modelIndex<0||argv[modelIndex+1]!==model)return child;
      const commands=new Map<string,string>(),write=child.stdin.write,emit=child.stdout.emit;let buffer='',changed=false;
      const input={write(...parts:any[]){try{for(const line of String(parts[0]).split('\n').filter(Boolean)){const command=JSON.parse(line);if(typeof command.id==='string'&&typeof command.type==='string')commands.set(command.id,command.type)}}catch{}return write.apply(child.stdin,parts)}};
      const output={emit(event:string,...parts:any[]){
        if(event!=='data')return emit.call(child.stdout,event,...parts);buffer+=String(parts[0]);let offset:number;const ready:string[]=[];
        while((offset=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,offset+1);buffer=buffer.slice(offset+1);let value:any;try{value=JSON.parse(line)}catch{ready.push(line);continue}
          if(!changed&&value.type==='response'&&commands.get(value.id)==='steer'&&value.success&&value.data?.disposition==='queued'){
            changed=true;state.records.push({pid:child.pid,commandId:value.id,original:structuredClone(value),mode:stopping?'held_until_real_stop':'lost_ack_as_transport_failure'});
            if(stopping){state.held=true;state.release=function(){if(state.held){state.held=false;emit.call(child.stdout,'data',line)}};continue}
            const delivered={...value,success:false,error:'TEST_NATIVE_ACK_LOST_AFTER_REAL_QUEUED'};delete delivered.data;state.records.at(-1).delivered=delivered;ready.push(JSON.stringify(delivered)+'\n');continue;
          }ready.push(line);
        }
        return ready.length?emit.call(child.stdout,event,ready.join('')):true;
      }};
      child.stdin.write=input.write;child.stdout.emit=output.emit;return child;
    }};
    processModule.spawn=replacement.spawn;
  },{stopping,unknown,model:data.model});
  await page.getByRole('button',{name:'project · 运行中',exact:true}).click();await active().getByRole('combobox',{name:'执行权限',exact:true}).click();await active().getByRole('option',{name:/只读访问/}).click();await input().fill(data.goal);await active().getByRole('button',{name:'发送消息',exact:true}).click();
  await activeInputWait(async()=>provider.main.length===6,'真实成员候选与主旧完成审阅已保存');
  const first=(await call('loop.list',{id:entry.id}))[0],rootSessionId=first.task.taskId,identity={workspaceId:entry.id,rootSessionId},thread=()=>call('loop.thread',{id:entry.id,taskId:rootSessionId}),queue=()=>call('loop.queue',{id:entry.id,taskId:rootSessionId}),runId=(await thread()).at(-1).runId;
  const original=(await seed.scopes())[0];assert.equal(original.goal?.review?.decision,'complete');
  const enqueueClick=async(message:string)=>{await input().fill(message);await active().getByRole('button',{name:'加入队列',exact:true}).click();const view=active().locator('.message-queue');await view.getByText(message,{exact:true}).waitFor();await input().fill(data.draft);const item=(await queue()).at(-1);await view.locator('.queue-row').last().hover();await view.getByRole('button',{name:'插入第 1 条到当前任务',exact:true}).click();return item};
  const inserted=await enqueueClick(data.insert);await fs.mkdir('test-results',{recursive:true});
  if(stopping){
    await activeInputWait(async()=>desktop!.evaluate(()=>(globalThis as any).__activeInputTransport.held===true),'真实 Pi queued ACK 被测试管道暂存');assert.equal((await seed.scopes())[0].activeInputs?.[0].status,'pending');
    const stop=active().getByRole('button',{name:'停止执行',exact:true});assert.equal(await stop.isEnabled(),true);await page.screenshot({path:`test-results/${artifact}-pending-stop.png`});await stop.click();
    await activeInputWait(async()=>desktop!.evaluate(()=>(globalThis as any).__activeInputIpc.some((record:any)=>record.action==='loop.stop')),'真实停止按钮发出 stop');await desktop.evaluate(()=>(globalThis as any).__activeInputTransport.release());
    await activeInputWait(async()=>{const scope=(await seed.scopes())[0];return scope.status==='closed'&&scope.outcome==='cancelled'&&(await call('runtime.snapshot')).pressure.activeRuns===0},'迟到真实 ACK 保存后周期取消');
    const scope=(await seed.scopes())[0];assert.equal(scope.activeInputs?.[0].status,'accepted');assert.equal(scope.goal?.inputRevision,2);assert.equal(scope.goal?.review,undefined);assert.equal((await queue()).length,0);assert.equal(provider.main.length,6);provider.release();
  }else if(unknown){
    await activeInputWait(async()=>(await seed.scopes())[0].activeInputs?.[0].status==='unknown','真实原生 ACK 传输故障登记未知');
    await active().getByRole('alert').filter({hasText:'QUEUE_INSERT_UNKNOWN'}).waitFor();assert.equal((await queue())[0].id,inserted.id);assert.equal((await queue())[0].status,'paused');await page.screenshot({path:`test-results/${artifact}-unknown.png`});provider.release();
    await activeInputWait(async()=>{const scope=(await seed.scopes())[0];return scope.status==='closed'&&(await call('runtime.snapshot')).pressure.activeRuns===0},'旧审阅被未知输入门禁阻止');const scope=(await seed.scopes())[0];assert.equal(scope.outcome,'failed');assert.equal(scope.wait,undefined);assert.equal(scope.activeInputs?.[0].status,'unknown');assert.equal(scope.goal?.inputRevision??1,1);
  }else{
    await activeInputWait(async()=>(await seed.scopes())[0].activeInputs?.[0].status==='accepted','首次输入升版');let scope=(await seed.scopes())[0];assert.equal(scope.goal?.inputRevision,2);assert.equal(scope.goal?.review,undefined);assert.deepEqual(scope.goal?.input,original.goal?.input);
    const mainCard=active().getByTestId('conversation-goal-summary');await mainCard.locator('summary').filter({hasText:'查看目标计划与审阅'}).click();await mainCard.getByTestId('scope-active-input').locator('summary').click();await mainCard.getByTestId('scope-active-input-message').filter({hasText:data.insert}).waitFor();await page.screenshot({path:`test-results/${artifact}-accepted-replanning.png`});
    provider.release();await activeInputWait(async()=>provider.main.length===12,'同一主运行的第一条补充重新审阅');await enqueueClick(data.second);await activeInputWait(async()=>{const current=(await seed.scopes())[0];return current.activeInputs?.length===2&&current.activeInputs[1].status==='accepted'&&current.goal?.inputRevision===3},'第二条补充真实受理');scope=(await seed.scopes())[0];assert.equal(scope.goal?.inputRevision,3);assert.equal(scope.goal?.review,undefined);assert.deepEqual(scope.activeInputs?.map(item=>item.runId),[runId,runId]);provider.release(11);
    await activeInputWait(async()=>(await seed.scopes())[0].status==='waiting','两条运行中补充后安全等待');assert.equal((await call('runtime.snapshot')).pressure.activeRuns,0);
    await active().getByRole('tab',{name:'任务视图',exact:true}).click();await active().getByTestId('dispatch-root-node').click();const root=active().getByTestId('dispatch-root-goal');await activeInputWait(async()=>await root.getAttribute('data-goal-state')==='waiting','前端目标卡已同步安全等待');await root.getByTestId('scope-active-input').nth(1).locator('summary').click();await root.getByTestId('scope-active-input-message').filter({hasText:data.second}).waitFor();assert.equal(await root.getByTestId('scope-active-input').count(),2);await page.screenshot({path:`test-results/${artifact}-root-waiting-history.png`});
    await root.getByTestId('scope-continuation-input').fill(data.continuation);await active().getByRole('tab',{name:'对话',exact:true}).click();await active().getByTestId('conversation-goal-summary').getByTestId('scope-continuation-input').filter({visible:true}).waitFor();assert.equal(await active().getByTestId('conversation-goal-summary').getByTestId('scope-continuation-input').inputValue(),data.continuation);assert.equal(await input().inputValue(),data.draft);
    await active().getByTestId('conversation-goal-summary').getByTestId('scope-continuation-submit').click();await activeInputWait(async()=>{const s=(await seed.scopes())[0];return s.status==='closed'&&(await call('runtime.snapshot')).pressure.activeRuns===0},'显式等待补充后按连续输入版本完成');scope=(await seed.scopes())[0];assert.equal(scope.outcome,'completed');assert.equal(scope.goal?.inputRevision,4);assert.equal(scope.continuations?.length,1);assert.equal(scope.activeInputs?.length,2);assert.equal(scope.goal?.review?.inputRevision,4);assert.deepEqual(scope.goal?.input,original.goal?.input);
  }
  assert.equal(await input().inputValue(),data.draft);const savedThread=await thread(),savedQueue=await queue(),scopes=await seed.scopes(),graph=await call('dispatch.graphSnapshot',{identity}),nativeFile=savedThread.at(-1).sessionFile,native=await fs.readFile(nativeFile,'utf8');
  assert.equal(new Set(savedThread.map((run:any)=>run.events.find((event:any)=>event.type==='session.bound')?.data.sessionId)).size,1);assert.equal(provider.member.length,5);assert.equal(provider.main.length,stopping?6:unknown?7:22);assert.equal(provider.errors.length,0);assert.equal(pageErrors.length,0);
  await page.screenshot({path:`test-results/${artifact}-settled.png`});const trace=await desktop.evaluate(()=>(globalThis as any).__activeInputIpc),transport=await desktop.evaluate(()=>(globalThis as any).__activeInputTransport.records);assert.equal(trace.filter((item:any)=>item.action==='loop.queueInsert').length,stopping||unknown?1:2);if(stopping||unknown){assert.equal(transport.length,1);assert.equal(transport[0].original.data.disposition,'queued')}
  const counts={main:provider.main.length,member:provider.member.length};await desktop.evaluate(()=>(globalThis as any).__activeInputTransport.restore());await desktop.close();desktop=undefined;
  desktop=await electron.launch({executablePath:exe,env:{...process.env,CBIM_USER_DATA_ROOT:user},timeout:60000});page=await desktop.firstWindow();page.setDefaultTimeout(30000);page.on('pageerror',error=>pageErrors.push(error.message));await page.getByRole('button',{name:'project · 运行中',exact:true}).click();await page.locator('.workspace-conversations button').filter({hasText:data.goal}).first().click();await input().waitFor();
  assert.deepEqual(await thread(),savedThread);assert.deepEqual(await seed.scopes(),scopes);assert.deepEqual(await call('dispatch.graphSnapshot',{identity}),graph);assert.deepEqual(await queue(),savedQueue.map((item:any)=>({...item,status:'paused',reason:'应用已重启，请确认后继续队列'})));assert.equal(await fs.readFile(nativeFile,'utf8'),native);assert.deepEqual({main:provider.main.length,member:provider.member.length},counts);assert.equal(await input().inputValue(),data.draft);assert.equal((await call('runtime.snapshot')).pressure.activeRuns,0);
  await active().getByRole('tab',{name:'任务视图',exact:true}).click();await active().getByTestId('dispatch-root-node').click();await active().getByTestId('dispatch-root-goal').getByTestId('scope-active-input').first().waitFor();await page.screenshot({path:`test-results/${artifact}-restored.png`});
  report={packagedExe:exe,mode,realPi:true,onlineProvider:false,realQueueInsertClicks:trace.filter((item:any)=>item.action==='loop.queueInsert').length,realStopClick:stopping,nativeAckFaultInjection:unknown,realAckHeldUntilStop:stopping,noFakeSchedulerReceipt:true,runId,queueId:inserted.id,originalGoal:original.goal?.input,scopes,sameNativeSession:true,ordinaryDraftPreserved:true,rootAndMainShareContinuation:!stopping&&!unknown,restartNoReplay:true,recordsAndNativeBytesUnchanged:true,requests:counts,pageErrors,transportErrors:provider.errors,trace,transport,temp};
}catch(error){keepTemp=true;await fs.mkdir('test-results',{recursive:true});if(desktop)await desktop.firstWindow().then(page=>page.screenshot({path:`test-results/${artifact}-failure.png`})).catch(()=>{});const dom=desktop?await desktop.firstWindow().then(page=>page.locator('.workspace-panel:not([hidden])').innerText()).catch(()=>undefined):undefined;const transport=desktop?await desktop.evaluate(()=>(globalThis as any).__activeInputTransport?.records).catch(()=>undefined):undefined;await fs.writeFile(`test-results/${artifact}-ui-failure.json`,JSON.stringify({exe,temp,error:String(error),dom,main:provider.main,member:provider.member,pageErrors,errors:provider.errors,transport},null,2));throw error}
finally{if(desktop)await desktop.evaluate(()=>{(globalThis as any).__activeInputTransport?.release();(globalThis as any).__activeInputTransport?.restore()}).catch(()=>{});provider.release();provider.release(11);if(desktop)await desktop.close().catch(()=>{});if(setup)await setup.shutdown();await provider.close();if(!keepTemp){const target=path.resolve(temp);assert.equal(path.dirname(target),path.resolve(os.tmpdir()));assert.ok(path.basename(target).startsWith('cbim-active-input-ui-'));await fs.rm(target,{recursive:true,force:true});if(report){report.cleanup={desktopClosed:true,providerClosed:true,tempRemoved:await fs.stat(target).then(()=>false,()=>true)};await fs.writeFile(`test-results/${artifact}-ui-smoke.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report))}}}
