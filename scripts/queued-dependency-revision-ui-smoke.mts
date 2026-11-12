import {_electron as electron,type ElectronApplication} from 'playwright-core';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {Application} from '../src/backend/main/assembly/application';
import {Paths} from '../src/backend/main/platform/paths';
import {dependencyRevisionProvider,dependencyRevisionData as data} from '../tests/queued-dependency-revision-provider';
import {seedDependencyRevision,assertDependencyRevision,revisionRecords,revisionWait,revisionRunBytes,revisionRunByteEvidence} from '../tests/queued-dependency-revision-pi-fixture';
import {latestExecutable} from './build-artifact.mjs';

// Real packaged EXE and Pi, with an isolated deterministic HTTP provider; no production user directory is used.
const stopping=process.argv.includes('--stop'),restartHeld=process.argv.includes('--restart-held');assert.ok(!(stopping&&restartHeld));
const mode=stopping?'stop':restartHeld?'restart-held':'complete',artifact='dependency-revision-'+mode,exe=await latestExecutable(),temp=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-dependency-revise-ui-')),project=path.join(temp,'project'),user=path.join(temp,'user');
const provider=await dependencyRevisionProvider(),pageErrors:string[]=[];let setup:Application|undefined,desktop:ElectronApplication|undefined,keepTemp=false,report:Record<string,unknown>|undefined;
try{
 setup=new Application(new Paths(user,path.resolve('.')),path.resolve('design'));await setup.init();const {entry}=await seedDependencyRevision(setup,project,provider);await setup.shutdown();setup=undefined;
 const launch=()=>electron.launch({executablePath:exe,env:{...process.env,CBIM_USER_DATA_ROOT:user},timeout:60000});desktop=await launch();let page=await desktop.firstWindow();
 const watch=()=>{page.setDefaultTimeout(30000);page.on('pageerror',e=>pageErrors.push(e.message))};watch();
 const call=(action:string,args:unknown={})=>page.evaluate(({action,args})=>(window as any).cbim.call(action,args),{action,args}),active=()=>page.locator('.workspace-panel:not([hidden])'),input=()=>active().getByRole('textbox',{name:'对话草稿',exact:true}),records=()=>revisionRecords(user,entry.id);
 const select=async()=>{await page.getByRole('button',{name:'project · 运行中',exact:true}).click();await page.locator('.workspace-conversations button').filter({hasText:'DEPENDENCY_REVISE_MAIN:'}).first().click();await input().waitFor()};
 await page.getByRole('button',{name:'project · 运行中',exact:true}).click();await active().getByRole('combobox',{name:'执行权限',exact:true}).click();await active().getByRole('option',{name:/只读访问/}).click();await input().fill(data.goal);await active().getByRole('button',{name:'发送消息',exact:true}).click();await input().fill(data.draft);
 await revisionWait(async()=>provider.main.length===provider.heldTurn+1&&!!provider.state.receipt,'真实多边修订已保存且主轮保持');assert.deepEqual(provider.errors,[]);assert.equal(provider.member.length,0);
 const before=provider.state.before!,receipt=provider.state.receipt!,scope=(await records()).scopes[0],identity={workspaceId:entry.id,rootSessionId:scope.rootSessionId},graph=()=>call('dispatch.graphSnapshot',{identity}),held=await graph(),nodes=assertDependencyRevision(held,before,receipt,false);assert.equal((await records()).runs.length,0);
 const shot=(suffix:string)=>page.screenshot({path:`test-results/${artifact}-${suffix}.png`}),audit=()=>active().locator('.member-task-detail').getByTestId('member-dependency-revision');
 const openAudit=async()=>{
  await active().getByRole('tab',{name:'任务视图',exact:true}).click();await active().locator(`[data-testid="dispatch-task-node"][data-task-id="${nodes.c.taskId}"]`).click();await audit().waitFor();assert.equal(await audit().getAttribute('data-task-id'),nodes.c.taskId);
  const detail=audit().locator(`details[data-revision-id="${receipt.commandId}"]`);if(await detail.getAttribute('open')===null)await detail.locator('summary').click();const text=await detail.innerText();for(const s of [data.reason,'退役 1 条，新增 2 条',nodes.a.taskId,nodes.b.taskId,nodes.d.taskId])assert.ok(text.includes(s));assert.equal(await active().getByTestId('member-dependency-invalid').count(),0);
  for(const source of [nodes.a,nodes.d])assert.equal(await active().locator(`[data-testid="dispatch-graph-edge"][data-kind="dependency"][data-from="${source.nodeId}"][data-to="${nodes.c.nodeId}"]`).count(),1);
 };
 const openCommand=async()=>{
  await active().getByRole('tab',{name:'对话',exact:true}).click();const target='details.chat-tool[data-tool-call-id="revision-exact"]',tool=active().locator(target).first(),work=active().locator('details.chat-work').filter({has:page.locator(target)}).first();await work.waitFor({state:'attached'});if(await work.getAttribute('open')===null)await work.locator('summary').first().click();await tool.waitFor();if(await tool.getAttribute('open')===null)await tool.locator('summary').first().click();
  const panel=tool.locator(`[data-testid="command-verification-panel"][data-run-id="${receipt.mainRunId}"][data-tool-call-id="revision-exact"]`);await panel.waitFor();return panel;
 };
 const queryCommand=async()=>{const panel=await openCommand();await panel.getByRole('button',{name:/核实原命令/,exact:false}).click();await revisionWait(async()=>await panel.getAttribute('data-command-state')==='committed','原修订命令已核实');assert.ok((await panel.innerText()).includes('退役 1 条，新增 2 条'));await panel.scrollIntoViewIfNeeded();return panel};
 await openAudit();assert.equal(await active().locator(`[data-testid="dispatch-task-node"][data-task-id="${nodes.c.taskId}"]`).getAttribute('data-status'),'waiting');await audit().scrollIntoViewIfNeeded();await shot('held-audit');await active().getByTestId('dispatch-root-node').click();await shot('held-graph');
 const heldRecords=await records(),heldSequence=[...provider.sequence];await queryCommand();await shot('original-command');assert.deepEqual(await records(),heldRecords);assert.deepEqual(await graph(),held);assert.deepEqual(provider.sequence,heldSequence);assert.equal(await input().inputValue(),data.draft);
 if(stopping)await active().getByRole('button',{name:'停止执行',exact:true}).click();
 else if(restartHeld){await desktop.close();desktop=undefined;provider.releaseMain();desktop=await launch();page=await desktop.firstWindow();watch();await select();assert.deepEqual(provider.sequence,heldSequence)}
 provider.releaseMain();await revisionWait(async()=>(await records()).scopes[0].status==='closed'&&(await call('runtime.snapshot')).pressure.activeRuns===0,'周期完成或停止');
 const finalRecords=await records(),closed=finalRecords.scopes[0],finished=await graph(),after=assertDependencyRevision(finished,before,receipt,mode==='complete');
 if(mode==='complete'){
  assert.equal(closed.outcome,'completed');assert.equal(provider.main.length,provider.heldTurn+4);assert.equal(provider.member.length,20);assert.equal(finalRecords.runs.length,4);
  const run=(taskId:string)=>finalRecords.runs.find(r=>r.binding.taskId===taskId)!;assert.deepEqual(run(after.b.taskId).prerequisites,[]);assert.deepEqual(run(after.c.taskId).prerequisites,[after.a,after.d].map(t=>({taskId:t.taskId,planRevision:t.planRevision,result:t.result})));
 }else{assert.ok(['cancelled','interrupted'].includes(closed.outcome??''));assert.equal(provider.main.length,provider.heldTurn+1);assert.equal(provider.member.length,0);assert.equal(finalRecords.runs.length,0)}
 await openAudit();await revisionWait(async()=>await active().locator(`[data-testid="dispatch-task-node"][data-task-id="${nodes.c.taskId}"]`).getAttribute('data-status')===after.c.status,'目标节点同步终态');await audit().scrollIntoViewIfNeeded();await shot('settled-audit');await active().getByTestId('dispatch-root-node').click();await shot('settled-graph');await active().getByRole('tab',{name:'对话',exact:true}).click();assert.equal(await input().inputValue(),data.draft);
 const thread=await call('loop.thread',{id:entry.id,taskId:identity.rootSessionId}),bytes=await revisionRunBytes(user,entry.id,identity.rootSessionId,thread,finalRecords.runs),sequence=[...provider.sequence];await desktop.close();desktop=undefined;desktop=await launch();page=await desktop.firstWindow();watch();await select();
 assert.deepEqual(await records(),finalRecords);assert.deepEqual(await graph(),finished);assert.deepEqual(await call('loop.thread',{id:entry.id,taskId:identity.rootSessionId}),thread);assert.deepEqual(await revisionRunBytes(user,entry.id,identity.rootSessionId,thread,finalRecords.runs),bytes);assert.deepEqual(provider.sequence,sequence);assert.equal(await input().inputValue(),data.draft);await openAudit();await audit().scrollIntoViewIfNeeded();await shot('restored-audit');await queryCommand();await shot('restored-command');assert.deepEqual(await records(),finalRecords);assert.deepEqual(provider.sequence,sequence);
 for(let i=0;i<data.files.length;i++)assert.equal(await fs.readFile(path.join(project,data.files[i]),'utf8'),data.facts[i]);assert.deepEqual(pageErrors,[]);assert.deepEqual(provider.errors,[]);
 report={packagedExe:exe,mode,realPi:true,onlineProvider:false,receipt,originalTaskInstancesAndEnvelopes:true,noRunsBeforeMainSettled:true,retiredEdgePreserved:true,actualNewPrerequisites:mode==='complete',stopClicked:stopping,closedWhileHeld:restartHeld,restartNoReplay:true,queryNoMutation:true,ordinaryDraftPreserved:true,canonicalAndNativeBytesUnchanged:true,runBytes:revisionRunByteEvidence(bytes),requests:{main:provider.main.length,member:provider.member.length},sequence,pageErrors,transportErrors:provider.errors,temp};
}catch(error){keepTemp=true;if(desktop)await desktop.firstWindow().then(p=>p.screenshot({path:`test-results/${artifact}-failure.png`})).catch(()=>{});const dom=desktop?await desktop.firstWindow().then(p=>p.locator('body').innerText()).catch(()=>undefined):undefined;await fs.writeFile(`test-results/${artifact}-ui-failure.json`,JSON.stringify({packagedExe:exe,temp,mode,error:String(error),dom,sequence:provider.sequence,providerState:provider.state,pageErrors,transportErrors:provider.errors},null,2));throw error}
finally{
 provider.releaseMain();if(desktop)await desktop.close().catch(()=>{});if(setup)await setup.shutdown();await provider.close();
 if(!keepTemp){const target=path.resolve(temp);assert.equal(path.dirname(target),path.resolve(os.tmpdir()));assert.ok(path.basename(target).startsWith('cbim-dependency-revise-ui-'));await fs.rm(target,{recursive:true,force:true});if(report){report.cleanup={desktopClosed:true,providerClosed:true,tempRemoved:await fs.stat(target).then(()=>false,()=>true)};await fs.writeFile(`test-results/${artifact}-ui-smoke.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report))}}
}
