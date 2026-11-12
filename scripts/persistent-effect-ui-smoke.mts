import {_electron as electron,type ElectronApplication,type Page,type Locator} from 'playwright-core';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Application} from '../src/backend/main/assembly/application';
import {Paths} from '../src/backend/main/platform/paths';
import {hash} from '../src/backend/core/foundation/serialization';
import {effectObservationReportSchema,effectDispositionReceiptSchema} from '../src/backend/core/tasks/effect-observation';
import {preparePersistentEffect,type PersistentEffectMode} from '../tests/persistent-effect-fixture';
import {moduleGovernanceToolsLogBytes,moduleGovernanceToolsJournalBytes} from '../tests/module-governance-tools-fixture';
import {latestExecutable} from './build-artifact.mjs';

// 真实源码运行保存后丢回包；最终包使用隔离数据，所有核实和处置均由真实桌面按钮发起。
const mode:PersistentEffectMode=process.argv.includes('--ownership')?'ownership':process.argv.includes('--observe')?'observe':'propose',artifact='persistent-effect-'+mode,exe=await latestExecutable();
const temp=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-persistent-effect-ui-')),user=path.join(temp,'user'),project=path.join(temp,'persistent-effect-project');await fs.mkdir(project);
const pageErrors:string[]=[],transportErrors:string[]=[],screenshots:string[]=[];let setup:Application|undefined,desktop:ElectronApplication|undefined,page!:Page,keep=false,report:Record<string,unknown>|undefined,source:Awaited<ReturnType<typeof preparePersistentEffect>>|undefined;
const cleanup={desktopClosed:false,providerClosed:false,tempRemoved:false};
try{
 setup=new Application(new Paths(user,path.resolve('.')),path.resolve('design'));await setup.init();source=await preparePersistentEffect(setup,user,project,temp,mode);
 const {id,started,selection,callId,provider}=source,identity={workspaceId:id,rootSessionId:started.taskId},name=path.basename(source.seeded.entry.path),expectedRequests=provider.requests.length;
 const dispatchFile=path.join(user,id,'dispatch','dispatch.jsonl'),originalDispatch=await fs.readFile(dispatchFile),archive='test-results/'+artifact+'-ui-original';await fs.mkdir(archive,{recursive:true});
 await fs.writeFile(path.join(archive,'dispatch.jsonl'),originalDispatch);await fs.writeFile(path.join(archive,'module-ledger.json'),source.ledgerBytes);await fs.writeFile(path.join(archive,'native.jsonl'),source.native);await fs.writeFile(path.join(archive,'canonical-native-logs.json'),JSON.stringify(source.canonical,null,2));
 await setup.shutdown();setup=undefined;
 const until=async(check:()=>Promise<boolean>,label:string)=>{const end=Date.now()+60000;while(Date.now()<end){assert.deepEqual(provider.errors,[]);if(await check())return;await new Promise(resolve=>setTimeout(resolve,35))}throw Error('Persistent effect UI timeout: '+label)};
 const launch=async()=>{desktop=await electron.launch({executablePath:exe,env:{...process.env,CBIM_USER_DATA_ROOT:user},timeout:60000});page=await desktop.firstWindow();page.setDefaultTimeout(30000);page.on('pageerror',e=>pageErrors.push(e.message));page.on('requestfailed',r=>transportErrors.push(r.url()+': '+r.failure()?.errorText))};
 const active=()=>page.locator('.workspace-panel:not([hidden])'),draft=()=>active().getByRole('textbox',{name:'对话草稿',exact:true}),draftText='原治理或责任结果待核实，普通对话草稿保留。';
 const call=(action:string,args:unknown={})=>page.evaluate(({action,args})=>(window as any).cbim.call(action,args),{action,args});
 const shot=async(label:string,target:Locator)=>{await target.scrollIntoViewIfNeeded();const filename='test-results/'+artifact+'-'+label+'.png';await page.screenshot({path:filename});screenshots.push(filename)};
 const choose=async()=>{await page.getByRole('button',{name:name+' · 运行中',exact:true}).click();await page.locator(`[aria-label="${name} 的对话"] button`).filter({hasText:mode==='ownership'?'MODULE_OWNERSHIP_CONTROL_MAIN':'MODULE_GOVERNANCE_TOOLS_MAIN'}).first().click();await active().getByRole('tab',{name:'对话',exact:true}).click()};
 const panel=async()=>{const selector=`details.chat-tool[data-tool-call-id="${callId}"]`,work=active().locator('details.chat-work').filter({has:page.locator(selector)}).first(),tool=active().locator(selector).first();if(await work.getAttribute('open')===null)await work.locator('summary').first().click();if(await tool.getAttribute('open')===null)await tool.locator('summary').first().click();assert.ok((await tool.locator('summary').first().innerText()).includes('执行失败'));return tool.getByTestId('effect-observation-panel')};
 const observe=async(target:Locator)=>{await target.getByTestId('effect-observe').click();await target.getByTestId('effect-persistent-record').waitFor();await until(async()=>await target.getByTestId('effect-observe').isEnabled(),'observation settled');return effectObservationReportSchema.parse(await call('dispatch.effectObserve',selection))};
 const unchanged=async()=>{
  assert.deepEqual(await moduleGovernanceToolsLogBytes(user,id),source!.canonical);assert.deepEqual(await moduleGovernanceToolsJournalBytes(user,id),source!.journals);assert.deepEqual(await fs.readFile(source!.summary.sessionFile!),source!.native);assert.deepEqual(await fs.readFile(source!.ledger),source!.ledgerBytes);assert.deepEqual(await fs.readFile(source!.ledger+'.anchor'),source!.anchorBytes);assert.equal(provider.requests.length,expectedRequests);
  const bytes=await fs.readFile(dispatchFile);assert.deepEqual(bytes.subarray(0,originalDispatch.length),originalDispatch);const added=bytes.subarray(originalDispatch.length).toString('utf8').split('\n').filter(Boolean).map(line=>JSON.parse(line));
  assert.equal(added.length,1);assert.deepEqual(Object.keys(added[0].body.mutation).sort(),['effectDispositions','receipt']);return bytes;
 };
 await launch();await choose();await draft().fill(draftText);let target=await panel();assert.equal(await target.locator('.effect-call').count(),0);const first=await observe(target),fact=first.calls[0].persistent!;
 assert.equal(first.calls[0].outcome,'failed');assert.equal(fact.state,'recorded');assert.equal(fact.record?.kind,mode==='ownership'?'ownership':mode==='observe'?'observation':'proposal');assert.equal(await target.getByTestId('effect-persistent-record').getAttribute('data-state'),'recorded');assert.ok((await target.innerText()).includes('保存不等于批准'));assert.ok(!(await target.innerText()).includes('TEST_RESPONSE_LOST'));await shot('original-record',target.getByTestId('effect-persistent-record'));
 await target.getByTestId('effect-decision').selectOption('inspect_more');await target.getByTestId('effect-reason').fill('原保存已经核实，原工具失败保留；批准、实施与后续交接另行检查。');await target.getByTestId('effect-save').click();await until(async()=>await target.getByTestId('effect-disposition-form').getAttribute('data-phase')==='accepted','explicit disposition saved');
 const commandId=(await target.getByTestId('effect-selected-disposition').locator('code').innerText()).trim(),saved=effectDispositionReceiptSchema.parse(await call('dispatch.effectDispositionReceipt',{...identity,commandId}));assert.deepEqual(saved.record.observation.calls[0].persistent,fact);await target.getByTestId('effect-query').click();await until(async()=>await target.getByTestId('effect-query').isEnabled(),'original disposition queried');await shot('explicit-disposition',target.getByTestId('effect-selected-disposition'));const finalDispatch=await unchanged();assert.equal(await draft().inputValue(),draftText);
 await desktop!.close();desktop=undefined;await launch();await choose();assert.equal(await draft().inputValue(),draftText);target=await panel();assert.equal(await target.locator('.effect-call').count(),0);await target.getByTestId('effect-history-load').click();await target.locator(`[data-disposition-id="${commandId}"]`).click();await target.getByTestId('effect-selected-disposition').waitFor();const reopened=await observe(target);assert.deepEqual(reopened.calls,first.calls);assert.equal(reopened.basis,first.basis);await shot('restored-original',target.getByTestId('effect-persistent-record'));
 assert.deepEqual(await call('dispatch.effectDispositionReceipt',{...identity,commandId}),saved);assert.deepEqual(await unchanged(),finalDispatch);assert.deepEqual(pageErrors,[]);assert.deepEqual(transportErrors,[]);
 report={mode,exe,identity,runId:started.runId,requests:provider.requests.length,actualOriginalWrites:source.writes,finalObservation:first,reopened,receipt:saved,originalDispatchHash:hash(originalDispatch),originalLedgerHash:hash(source.ledgerBytes),originalNativeHash:hash(source.native),originalCanonicalUnchanged:true,onlyDispositionAppended:true,reopenAddedRequests:0,pageErrors,transportErrors,providerErrors:provider.errors,screenshots,cleanup};
}catch(error){keep=true;await fs.mkdir('test-results',{recursive:true});if(page)await page.screenshot({path:'test-results/'+artifact+'-failure.png'}).catch(()=>{});await fs.writeFile('test-results/'+artifact+'-failure.json',JSON.stringify({mode,exe,temp,error:String(error),providerErrors:source?.provider.errors,pageErrors,transportErrors},null,2));throw error}
finally{
 await setup?.shutdown();if(desktop)await desktop.close();cleanup.desktopClosed=true;await source?.provider.close();cleanup.providerClosed=true;
 if(!keep){const target=path.resolve(temp);if(path.dirname(target)!==path.resolve(os.tmpdir())||!path.basename(target).startsWith('cbim-persistent-effect-ui-'))throw Error('Refusing unexpected test cleanup');await fs.rm(target,{recursive:true,force:true});cleanup.tempRemoved=true}
 if(report)await fs.writeFile('test-results/'+artifact+'-ui-smoke.json',JSON.stringify(report,null,2));
}
console.log(JSON.stringify(report));
