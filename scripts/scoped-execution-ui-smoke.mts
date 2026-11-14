import {_electron as electron,type ElectronApplication} from 'playwright-core';
import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import assert from 'node:assert/strict';
import {Application} from '../src/bridge/server/application';import {Paths} from '../src/logic/workspace/service/paths';
import {scopedData,scopedProvider} from '../tests/scoped-execution-provider';
import {seedScopedExecution,scopedRecords,scopedLogBytes} from '../tests/scoped-execution-fixture';
import {FileRunStorage} from '../src/logic/execution/storage/run-storage';
import {latestExecutable} from './build-artifact.mjs';
const mode=process.argv.includes('--stop')?'stop':process.argv.includes('--ask')?'ask':'complete',tag=process.env.CBIM_SCOPED_REPORT_PREFIX??'scoped-'+mode;
assert.match(tag,/^scoped-[a-z0-9-]+$/);const report='test-results/'+tag+'-desktop.json';
await fs.access(report).then(()=>{throw Error('报告已存在，拒绝覆盖')},e=>{if(e.code!=='ENOENT')throw e});
const executable=await latestExecutable(),root=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-scoped-ui-')),project=path.join(root,'project'),user=path.join(root,'user');await fs.mkdir(project);
const provider=await scopedProvider(mode==='stop'?'stop':'complete');let setup:Application|undefined,desktop:ElectronApplication|undefined,keep=false;const errors:string[]=[],approved:string[]=[],ownedPids:number[]=[];let isolatedRoot:string|undefined;
try{
 setup=new Application(new Paths(user,path.resolve('.')),path.resolve('design'));await setup.init();const seed=await seedScopedExecution(setup,project,provider.url,mode==='stop'?'stop':'complete');provider.bind(seed.agentId,seed.moduleId,seed.selection);await setup.shutdown();setup=undefined;
 desktop=await electron.launch({executablePath:executable,env:{...process.env,CBIM_USER_DATA_ROOT:user},timeout:60000});let page=await desktop.firstWindow();page.setDefaultTimeout(30000);page.on('pageerror',error=>errors.push(error.message));
 const call=(action:string,args:unknown={})=>page.evaluate(({action,args})=>(window as any).cbim.call(action,args),{action,args});
 const until=async(check:()=>Promise<boolean>,label:string)=>{const end=Date.now()+90000;while(Date.now()<end){assert.deepEqual(provider.errors,[]);if(await check())return;await new Promise(resolve=>setTimeout(resolve,40))}throw Error('等待验收超时：'+label)};
 await page.getByRole('button',{name:'project · 运行中',exact:true}).click();const active=()=>page.locator('.workspace-panel:not([hidden])'),draft=()=>active().getByRole('textbox',{name:'对话草稿',exact:true});
 await active().getByRole('combobox',{name:'执行权限',exact:true}).click();await active().getByRole('option',{name:mode==='ask'?/默认权限/:/完全访问/}).click();await draft().fill(scopedData.goal);await active().getByRole('button',{name:'发送消息',exact:true}).click();await draft().fill(scopedData.draft);
 await until(async()=>!!(await scopedRecords(user,seed.entry.id)).runs[0],'正式成员已领取');const initial=await scopedRecords(user,seed.entry.id),run=initial.runs[0],identity={workspaceId:seed.entry.id,rootSessionId:run.binding.rootSessionId},taskIdentity={...identity,taskId:run.binding.taskId};
 if(mode==='ask'){
  for(const name of ['cbim_scoped_node','cbim_file_write_controlled']){let approval:any;await until(async()=>{const pending=await call('dispatch.approvals',taskIdentity);if(pending.length){assert.equal(pending.length,1);approval=pending[0];assert.equal(approval.name,name);return true}return false},'原调用审批 '+name);approved.push(approval.name);await call('dispatch.approve',{...taskIdentity,approvalId:approval.id,allow:true})}
 }
 if(mode==='stop'){
  // Windows 启动器 PID 可能不同于实际 Electron 主进程；只匹配宿主自身报告的身份与实际 ready 文件。
  const hostPid=await desktop.evaluate(()=>process.pid);
  await until(async()=>{for(const name of await fs.readdir(os.tmpdir())){if(!/^cbim-isolated-[A-Za-z0-9]+$/.test(name))continue;const dir=path.join(os.tmpdir(),name);try{const owner=JSON.parse(await fs.readFile(path.join(dir,'owner.json'),'utf8'));if(owner.pid!==hostPid)continue;const ready=JSON.parse(await fs.readFile(path.join(dir,'output','ready.json'),'utf8'));process.kill(ready.pid,0);process.kill(ready.child,0);ownedPids.push(ready.pid,ready.child);isolatedRoot=dir;return true}catch{}}return false},'原LPAC主进程与后代实际存活');
  await active().getByRole('button',{name:'停止执行',exact:true}).click();
 }
 await until(async()=>{const records=await scopedRecords(user,seed.entry.id);return records.scopes[0].status==='closed'&&(await call('runtime.snapshot')).pressure.activeRuns===0},'原周期与实际运行均结束');
 const records=await scopedRecords(user,seed.entry.id),summary=await new FileRunStorage().read(path.join(user,seed.entry.id,'dispatch','runs','tasks',run.binding.taskId,run.binding.runId));
 assert.equal(records.scopes[0].outcome,mode==='stop'?'cancelled':'completed');assert.deepEqual(run.prepared.modules[0].workflowContract,seed.contract);assert.equal(await fs.readFile(path.join(project,scopedData.file),'utf8'),mode==='stop'?scopedData.before:scopedData.after);assert.equal(await fs.readFile(path.join(project,'private.txt'),'utf8'),'PRIVATE_SENTINEL');
 for(const id of ['outside-read','outside-write','forged-native'])assert.ok(!summary.events.some(e=>e.type==='tool.allowed'&&e.data.id===id));
 if(mode!=='stop'){assert.equal(provider.main.length,6);assert.equal(provider.member.length,14);assert.equal(provider.state.node.exitCode,0);assert.equal(provider.state.node.allProcessesExited,true);assert.equal(provider.state.capture.baseline.sourceCalls[0].toolName,'cbim_scoped_read');assert.equal(summary.status,'completed')}
 else{for(const pid of ownedPids)assert.throws(()=>process.kill(pid,0));assert.ok(isolatedRoot);await assert.rejects(fs.access(isolatedRoot));assert.equal((await call('dispatch.graphSnapshot',{identity})).tasks.find((task:any)=>task.taskId===run.binding.taskId)?.result,undefined)}
 assert.equal(await draft().inputValue(),scopedData.draft);await page.screenshot({path:'test-results/'+tag+'-finished.png'});
 const bytes=await scopedLogBytes(user,seed.entry.id),counts={main:provider.main.length,member:provider.member.length};await desktop.close();desktop=undefined;
 desktop=await electron.launch({executablePath:executable,env:{...process.env,CBIM_USER_DATA_ROOT:user},timeout:60000});page=await desktop.firstWindow();page.on('pageerror',error=>errors.push(error.message));await page.getByRole('button',{name:'project · 运行中',exact:true}).click();await call('dispatch.graphSnapshot',{identity});assert.deepEqual(await scopedLogBytes(user,seed.entry.id),bytes);assert.equal(provider.main.length,counts.main);assert.equal(provider.member.length,counts.member);assert.deepEqual(errors,[]);await page.screenshot({path:'test-results/'+tag+'-reopened.png'});
 await fs.writeFile(report,JSON.stringify({mode,executable,root,identity,binding:run.binding,scope:seed.contract.executionScope,status:summary.status,outcome:records.scopes[0].outcome,counts,approved,ownedPids,isolatedRoot,node:provider.state.node,receipts:summary.toolReceipts,reopenUnchanged:true,pageErrors:errors},null,2));
}catch(error){keep=true;await fs.writeFile('test-results/'+tag+'-failure.json',JSON.stringify({error:String(error),stack:(error as Error).stack,root,providerErrors:provider.errors,counts:{main:provider.main.length,member:provider.member.length},errors},null,2));throw error}
finally{await desktop?.close();await setup?.shutdown();await provider.close();if(!keep){const resolved=path.resolve(root);assert.equal(path.dirname(resolved),path.resolve(os.tmpdir()));assert.ok(path.basename(resolved).startsWith('cbim-scoped-ui-'));assert.equal((await fs.lstat(resolved)).isSymbolicLink(),false);await fs.rm(resolved,{recursive:true,force:true,maxRetries:5})}}
