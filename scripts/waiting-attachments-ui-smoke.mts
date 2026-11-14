import {_electron as electron,type ElectronApplication,type Page} from 'playwright-core';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {Application} from '../src/bridge/server/application';
import {Paths} from '../src/logic/workspace/service/paths';
import type {RunSummary} from '../src/logic/execution/rules/types';
import type {GoalContinuationRequest,GoalContinuationReceipt} from '../src/logic/tasks/rules/scope-continuation';
import {attachmentFixture as data,waitingAttachmentsProvider,requestImages} from '../tests/waiting-attachments-provider';
import {attachmentHash,attachmentWait,seedWaitingAttachments} from '../tests/waiting-attachments-fixture';
import {latestExecutable} from './build-artifact.mjs';

// 真实 Windows Electron/Pi；模型响应由本机确定性 SSE 提供。本脚本不替换原生文件选择器。
// picker.json 是操作协调回执：仅 Cindy computer 可按真实测试 PID/窗口选择所列临时文件。
// --unknown 仅在实际受理后丢弃一次 IPC 回复；恢复必须查询真实原命令，不伪造 receipt。
const unknown=process.argv.includes('--unknown'),mode=unknown?'unknown':'complete',prefix='waiting-attachments-'+mode;
const exe=await latestExecutable(),temp=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-waiting-attachments-ui-')),project=path.join(temp,'project'),user=path.join(temp,'user');
const provider=await waitingAttachmentsProvider(),pageErrors:string[]=[],pickerEvidence:unknown[]=[];
let overLimitRejectedBeforeImport=false;
const ordinaryDraft='普通输入框的下一任务草稿与附件，不是本次目标补充';
let setup:Application|undefined,desktop:ElectronApplication|undefined,page:Page|undefined,keepTemp=false;
await fs.mkdir('test-results',{recursive:true});
try{
  setup=new Application(new Paths(user,path.resolve('.')),path.resolve('design'));await setup.init();
  const seed=await seedWaitingAttachments(setup,project,provider);await setup.shutdown();setup=undefined;
  const start=async()=>{desktop=await electron.launch({executablePath:exe,env:{...process.env,CBIM_USER_DATA_ROOT:user},timeout:60000});page=await desktop.firstWindow();page.setDefaultTimeout(30000);page.on('pageerror',error=>pageErrors.push(error.message));};
  await start();
  const active=()=>page!.locator('.workspace-panel:not([hidden])'),card=()=>active().getByTestId('conversation-goal-summary'),draft=()=>active().getByRole('textbox',{name:'对话草稿',exact:true});
  const call=<T=any,>(action:string,args:unknown={})=>page!.evaluate(({action,args})=>(window as any).cbim.call(action,args),{action,args}) as Promise<T>;
  const waitPicker=async(label:string,files:string[],click:()=>Promise<void>,done:()=>Promise<boolean>)=>{
    const pid=await desktop!.evaluate(()=>process.pid),pending={state:'awaiting_native_picker',mode,label,pid,exe,temp,files};
    await fs.writeFile(`test-results/${prefix}-picker.json`,JSON.stringify(pending,null,2));console.log(JSON.stringify(pending));
    await click();await attachmentWait(done,'真实原生选择器 '+label,600000);
    const selected={...pending,state:'completed',completedAt:new Date().toISOString()};pickerEvidence.push(selected);await fs.writeFile(`test-results/${prefix}-picker.json`,JSON.stringify(selected,null,2));
  };
  await page!.getByRole('button',{name:'project · 运行中',exact:true}).click();await draft().fill(data.mainGoal);await active().getByRole('button',{name:'发送消息',exact:true}).click();
  await active().locator('[data-testid="conversation-goal-summary"][data-goal-state="waiting"]').waitFor();
  const original=(await seed.scopes())[0],identity={workspaceId:seed.entry.id,rootSessionId:original.rootSessionId};
  assert.equal(provider.mainRequests.length,6);assert.equal(provider.memberRequests.length,5);assert.equal((await call('runtime.snapshot')).pressure.activeRuns,0);
  const originalGraph=await call('dispatch.graphSnapshot',{identity});
  await draft().fill(ordinaryDraft);
  await waitPicker('ordinary-draft',[seed.sources.draft],async()=>{await active().getByLabel('添加上下文',{exact:true}).click();await active().getByRole('button',{name:'文件',exact:true}).click()},()=>active().getByRole('button',{name:'移除附件 ordinary-draft.txt',exact:true}).isVisible());
  await card().getByTestId('scope-continuation-input').fill(data.supplement);
  if(!unknown){
    const directory=path.join(project,'over-limit-selection');await fs.mkdir(directory);
    const files=Array.from({length:13},(_,index)=>path.join(directory,'selection-'+String(index+1).padStart(2,'0')+'.txt'));
    await Promise.all(files.map((file,index)=>fs.writeFile(file,'本测试第 '+(index+1)+' 个附件，不应有任何快照被导入')));
    const snapshotDirectory=path.dirname(seed.snapshotPath('unused')),snapshotsBefore=(await fs.readdir(snapshotDirectory)).sort();
    await waitPicker('reject-thirteen-before-import',files,()=>card().getByTestId('scope-continuation-pick').click(),()=>card().getByRole('alert').filter({hasText:'最多选择12个附件'}).isVisible());
    assert.deepEqual((await fs.readdir(snapshotDirectory)).sort(),snapshotsBefore,'超过12项必须在任何快照导入之前拒绝');assert.deepEqual(await seed.scopes(),[original]);assert.deepEqual(await call('dispatch.graphSnapshot',{identity}),originalGraph);
    assert.equal(await card().getByTestId('scope-continuation-attachments').getByRole('button').count(),0);assert.equal(await card().getByTestId('scope-continuation-input').inputValue(),data.supplement);assert.equal(await draft().inputValue(),ordinaryDraft);await active().getByRole('button',{name:'移除附件 ordinary-draft.txt',exact:true}).waitFor();
    assert.equal(provider.mainRequests.length,6);assert.equal(provider.memberRequests.length,5);overLimitRejectedBeforeImport=true;
    await card().getByRole('alert').filter({hasText:'最多选择12个附件'}).scrollIntoViewIfNeeded();await page!.screenshot({path:`test-results/${prefix}-thirteen-rejected.png`});
  }
  await waitPicker('goal-continuation',[seed.sources.text,seed.sources.image],()=>card().getByTestId('scope-continuation-pick').click(),async()=>await card().getByRole('button',{name:'移除附件 reference.txt',exact:true}).isVisible()&&await card().getByRole('button',{name:'移除附件 reference.png',exact:true}).isVisible());
  await card().getByRole('button',{name:'预览附件 reference.txt',exact:true}).click();await page!.getByRole('dialog').getByText(data.text,{exact:true}).waitFor();await page!.getByRole('button',{name:'关闭附件预览',exact:true}).click();
  await active().getByRole('tab',{name:'任务视图',exact:true}).click();await active().getByTestId('dispatch-root-node').click();const root=active().getByTestId('dispatch-root-goal');
  assert.equal(await root.getByTestId('scope-continuation-input').inputValue(),data.supplement);await root.getByRole('button',{name:'移除附件 reference.png',exact:true}).waitFor();
  await root.getByTestId('scope-continuation-attachments').scrollIntoViewIfNeeded();await page!.screenshot({path:`test-results/${prefix}-shared-attachments.png`});
  // 原文件更改/删除发生在真实 picker 导入之后；产品只能继续使用已保存快照。
  await fs.writeFile(seed.sources.text,'原始文件已修改，不能替换用户确认的参考快照');await fs.unlink(seed.sources.image);
  await active().getByRole('tab',{name:'对话',exact:true}).click();assert.equal(await draft().inputValue(),ordinaryDraft);await active().getByRole('button',{name:'移除附件 ordinary-draft.txt',exact:true}).waitFor();
  if(unknown)await desktop!.evaluate(({ipcMain})=>{
    const handlers=(ipcMain as any)._invokeHandlers,original=handlers.get('cbim:call');if(!original)throw Error('Missing actual IPC handler');let dropped=false;
    (globalThis as any).__waitingAttachmentReceiptTrace=[];
    handlers.set('cbim:call',async(event:unknown,action:string,args:unknown)=>{const result=await original(event,action,args);if(action==='loop.goalContinue'){(globalThis as any).__waitingAttachmentReceiptTrace.push({request:args,result});if(!dropped&&result?.ok){dropped=true;return {ok:false,error:{code:'TEST_RESPONSE_LOST',message:'测试在真实补充受理后丢弃一次返回，请查询原命令'}}}}return result});
  });
  await card().getByTestId('scope-continuation-submit').click();
  await card().getByTestId(unknown?'scope-continuation-unknown':'scope-continuation-accepted').waitFor();
  await attachmentWait(async()=>provider.mainRequests.length===7,'真实视觉补充开始');
  const frozen=await page!.evaluate(({workspaceId,rootSessionId,scopeId})=>{const saved=JSON.parse(localStorage.getItem('cbim.goal-continuation.v1.'+JSON.stringify([workspaceId,rootSessionId]))!);return saved.records.find((record:any)=>record.scopeId===scopeId).attempt.request},{...identity,scopeId:original.scopeId}) as GoalContinuationRequest;
  const lookup={...identity,scopeId:original.scopeId,commandId:frozen.commandId},receipt=await call<GoalContinuationReceipt>('loop.goalContinuation',lookup);
  const items=receipt.continuation.attachmentManifest!.items;
  assert.equal(receipt.continuation.input.message,data.supplement);assert.equal(receipt.continuation.input.attachmentIds?.length,2);assert.deepEqual(items.map(item=>item.name).sort(),['reference.png','reference.txt']);assert.deepEqual(items.map(item=>item.attachmentId),receipt.continuation.input.attachmentIds);
  assert.equal(items.find(item=>item.name==='reference.txt')!.contentHash,attachmentHash(data.text));assert.equal(items.find(item=>item.name==='reference.png')!.contentHash,attachmentHash(seed.png));assert.equal(provider.mainRequests.length,7);
  assert.equal(requestImages(provider.mainRequests[6])[0].image_url.url,'data:image/png;base64,'+seed.png.toString('base64'));
  let responseLoss:unknown;
  if(unknown){const trace=await desktop!.evaluate(()=>(globalThis as any).__waitingAttachmentReceiptTrace);assert.equal(trace.length,1);assert.equal(trace[0].result.ok,true);assert.equal(trace[0].result.value.continuation.continuationId,frozen.commandId);responseLoss={boundary:'actual successful loop.goalContinue IPC response',realCalls:trace.length,continuationId:frozen.commandId};await card().getByTestId('scope-continuation-unknown').scrollIntoViewIfNeeded();await page!.screenshot({path:`test-results/${prefix}-unknown.png`})}
  else{assert.deepEqual((await call<GoalContinuationReceipt>('loop.goalContinue',frozen)).continuation,receipt.continuation);await card().getByTestId('scope-continuation-query').click();await card().getByTestId('scope-continuation-accepted').waitFor()}
  assert.equal(await draft().inputValue(),ordinaryDraft);await active().getByRole('button',{name:'移除附件 ordinary-draft.txt',exact:true}).waitFor();provider.release();
  await attachmentWait(async()=>(await seed.scopes())[0].status==='closed','补充后真实成员回注完成');await active().locator('[data-testid="conversation-goal-summary"][data-goal-state="completed"]').waitFor();
  assert.equal(provider.mainRequests.length,13);assert.equal(provider.memberRequests.length,10);assert.equal((await call('runtime.snapshot')).pressure.activeRuns,0);
  const completed=(await seed.scopes())[0],graph=await call('dispatch.graphSnapshot',{identity}),thread=await call<RunSummary[]>('loop.thread',{id:seed.entry.id,taskId:original.rootSessionId});
  assert.deepEqual(graph.root.agent,originalGraph.root.agent);assert.equal(graph.tasks.length,2);assert.equal(thread.length,4);assert.equal(thread[2].source?.kind,'user-continuation');assert.equal(thread[3].source?.kind,'member-results');assert.equal(new Set(thread.map(run=>run.sessionFile)).size,1);
  const native=await fs.readFile(thread[2].sessionFile!,'utf8'),nativeEntries=native.trim().split('\n').map(line=>JSON.parse(line)),imageUsers=nativeEntries.filter(item=>item.type==='message'&&item.message?.role==='user'&&Array.isArray(item.message.content)&&item.message.content.some((part:any)=>part.type==='image'));
  assert.equal(imageUsers.length,1);for(const request of provider.mainRequests.slice(6))assert.equal(requestImages(request).length,1);
  await card().getByTestId('scope-goal-status').scrollIntoViewIfNeeded();await page!.screenshot({path:`test-results/${prefix}-completed.png`});
  const beforeThread=JSON.stringify(thread),nativeHash=attachmentHash(native);await desktop!.close();desktop=undefined;await start();
  await page!.getByRole('button',{name:'project · 运行中',exact:true}).click();await page!.locator('.workspace-conversations button').filter({hasText:data.mainGoal}).first().click();await active().locator('[data-testid="conversation-goal-summary"][data-goal-state="completed"]').waitFor();
  await card().getByTestId('scope-continuation-query').click();await card().getByTestId('scope-continuation-accepted').waitFor();
  assert.deepEqual((await call<GoalContinuationReceipt>('loop.goalContinuation',lookup)).continuation,receipt.continuation);assert.deepEqual(await seed.scopes(),[completed]);assert.deepEqual(await call('dispatch.graphSnapshot',{identity}),graph);assert.equal(JSON.stringify(await call('loop.thread',{id:seed.entry.id,taskId:original.rootSessionId})),beforeThread);assert.equal(attachmentHash(await fs.readFile(thread[2].sessionFile!)),nativeHash);
  assert.equal(await draft().inputValue(),ordinaryDraft);await active().getByRole('button',{name:'移除附件 ordinary-draft.txt',exact:true}).waitFor();assert.equal(provider.mainRequests.length,13);assert.equal(provider.memberRequests.length,10);assert.deepEqual(pageErrors,[]);assert.deepEqual(provider.errors,[]);
  await card().getByTestId('scope-continuation-accepted').scrollIntoViewIfNeeded();await page!.screenshot({path:`test-results/${prefix}-restored.png`});
  const report={packagedExe:exe,mode,realPi:true,onlineProvider:false,isolatedLocalProvider:true,realNativePicker:true,pickerEvidence,overLimitRejectedBeforeImport,scopeId:original.scopeId,rootSessionId:original.rootSessionId,continuationId:frozen.commandId,sourceChangedUsesSnapshot:true,sharedCards:true,ordinaryDraftAndAttachmentPreserved:true,manifestMatchesActualBytes:true,oneNativeAttachmentUserMessage:true,laterFullRequestsContainHistoricalImage:true,memberResultsDoNotReappendImage:true,sameMainAndNativeSession:true,newReadOnlyMember:true,responseLoss,restartNoReplay:true,canonicalAndNativeHistoryUnchangedOnReopen:true,mainRequests:13,memberRequests:10,pageErrors,transportErrors:provider.errors};
  await fs.writeFile(`test-results/${prefix}-ui-smoke.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}catch(error){keepTemp=true;if(page)await page.screenshot({path:`test-results/${prefix}-failure.png`}).catch(()=>{});await fs.writeFile(`test-results/${prefix}-ui-failure.json`,JSON.stringify({exe,temp,error:String(error),mainRequests:provider.mainRequests.length,memberRequests:provider.memberRequests.length,pageErrors,transportErrors:provider.errors,pickerEvidence},null,2));throw error}
finally{provider.release();if(desktop)await desktop.close().catch(()=>{});if(setup)await setup.shutdown();await provider.close();if(!keepTemp){const target=path.resolve(temp);assert.equal(path.dirname(target),path.resolve(os.tmpdir()));assert.ok(path.basename(target).startsWith('cbim-waiting-attachments-ui-'));await fs.rm(target,{recursive:true,force:true})}}
