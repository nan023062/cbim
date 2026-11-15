// 仅隔离 GitHub Windows runner：安装真实 C，候选模式显式暂存签名 R，在线模式不改下载源或缓存。
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync,execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {runtimeAcceptanceInputs} from './runtime-acceptance-inputs.mjs';
import {ownLaunchedDesktop,type DesktopAcceptanceProcess} from './desktop-acceptance-process.mjs';
import {_electron as electron,type Page} from 'playwright-core';
import {RuntimeStore} from '../src/logic/updates/service/runtime-store';
import {RuntimeJournal} from '../src/logic/updates/service/runtime-journal';
import {verifyRuntimeManifest,type ColdRuntime} from '../src/logic/updates/service/runtime-manifest';
import {selectBootResources} from '../src/bridge/server/bootstrap/selection';
import type {} from '../src/bridge/contracts/workspace';

async function main(){
  assert.equal(process.env.GITHUB_ACTIONS,'true');assert.equal(process.env.GITHUB_REPOSITORY,'nan023062/cbim');assert.equal(process.platform,'win32');
  const {mode,tag,source,expected,coldVersion,resourceVersion,coldTag,installerName}=runtimeAcceptanceInputs(process.env);
  const root=path.resolve('test-results/runtime-acceptance'),install=path.join(root,'app'),exe=path.join(install,'CBIM Desktop.exe'),user=path.join(root,'user'),downloads=path.join(root,'candidate');
  await fs.mkdir(downloads,{recursive:true});
  const run=(command:string,args:string[])=>execFileSync(command,args,{encoding:'utf8',windowsHide:true,maxBuffer:16*1024*1024,timeout:180000}).trim();
  const gh=(args:string[])=>run('gh',args),ps=(script:string)=>run('pwsh',['-NoProfile','-NonInteractive','-Command',script]);
  const save=(name:string,value:unknown)=>fs.writeFile(path.join(root,name+'.json'),JSON.stringify(value,null,2));
  const hash=async(file:string)=>createHash('sha256').update(await fs.readFile(file)).digest('hex');
  const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
  const until=async<T>(read:()=>Promise<T>,test:(value:T)=>boolean,timeout=180000)=>{const end=Date.now()+timeout;for(;;){const value=await read();if(test(value))return value;if(Date.now()>end)throw Error('Timed out: '+JSON.stringify(value));await pause(500)}};
  assert.equal(ps("@(Get-Process -Name 'CBIM Desktop' -ErrorAction SilentlyContinue).Count"),'0');
  assert.equal(ps("$k='HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall'; if(Test-Path $k){@(Get-ChildItem $k | Get-ItemProperty | Where-Object DisplayName -Like '*CBIM*').Count}else{0}"),'0');
  const coldRelease=JSON.parse(gh(['api','repos/nan023062/cbim/releases/tags/'+coldTag]));assert.equal(coldRelease.draft,false);
  const asset=coldRelease.assets.find((a:any)=>a.name===installerName);assert.ok(asset);
  gh(['release','download',coldTag,'--repo','nan023062/cbim','--pattern',asset.name,'--dir',root]);
  const installer=path.join(root,asset.name);assert.equal('sha256:'+await hash(installer),asset.digest);
  // 草稿不能依赖公开 tags 路由，按有权限的分页列表核实唯一对象，不把 404 当作未创建。
  const drafts=JSON.parse(gh(['api','--paginate','--slurp','repos/nan023062/cbim/releases?per_page=100'])).flat().filter((item:any)=>item.tag_name===tag);assert.equal(drafts.length,1);const draft=drafts[0];assert.equal(draft.draft,true);assert.equal(draft.target_commitish,source);
  gh(['release','download',tag,'--repo','nan023062/cbim','--dir',downloads]);
  const env:Record<string,string>={...Object.fromEntries(Object.entries(process.env).filter((entry):entry is [string,string]=>entry[1]!==undefined)),CBIM_USER_DATA_ROOT:user};for(const key of ['GH_TOKEN','GITHUB_TOKEN','ELECTRON_RUN_AS_NODE','CBIM_GITHUB_CLIENT_ID'])delete env[key];
  await save('install-intent',{coldRelease:coldRelease.id,installerSha256:await hash(installer),source,expected,mode});
  await new Promise<void>((resolve,reject)=>{const child=spawn(installer,['/S','/D='+install],{env,windowsHide:true,stdio:'ignore'});child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(Error('NSIS '+code)))});
  let app:DesktopAcceptanceProcess|undefined,page!:Page;const errors:string[]=[];let requests=0;
  const server=http.createServer(async(req,res)=>{for await(const _ of req){}requests++;res.writeHead(200,{'Content-Type':'text/event-stream'});for(const [delta,finish_reason] of [[{role:'assistant',content:'Retained completed task.'},null],[{},'stop']])res.write('data: '+JSON.stringify({id:'runtime-acceptance',object:'chat.completion.chunk',created:1,model:'acceptance',choices:[{index:0,delta,finish_reason}]})+'\n\n');res.end('data: [DONE]\n\n')});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const processLifecycle:unknown[]=[];
  const waitForDesktopExit=async(pid:number,{signal,timeoutMs}:{signal:AbortSignal;timeoutMs:number})=>{
    const script=fileURLToPath(new URL('./desktop-acceptance-process.ps1',import.meta.url));
    await promisify(execFile)('pwsh.exe',['-NoProfile','-NonInteractive','-File',script,'-TargetProcessId',String(pid),'-ExpectedPath',exe,'-TimeoutMilliseconds',String(timeoutMs)],{windowsHide:true,signal,timeout:timeoutMs+5000});
  };
  const launch=async()=>{
    assert.ok(!app,'Previous connection must be released');
    const launched=await electron.launch({executablePath:exe,env,timeout:60000});
    try{app=await ownLaunchedDesktop(launched,{executablePath:exe,waitForExit:waitForDesktopExit,record:(event:unknown)=>processLifecycle.push(event)})}catch(error){await launched.close().catch(()=>{});throw error}
    page=await app!.firstWindow();page.on('pageerror',(e:Error)=>errors.push(e.message));page.setDefaultTimeout(45000);await page.getByRole('button',{name:'用户菜单',exact:true}).waitFor();return page;
  };
  const close=async()=>{const current=app;try{await current?.close()}finally{app=undefined}};
  const status=()=>page.evaluate(()=>window.cbim.call('desktop.updates.status'));
  try{
    await launch();assert.equal((await status()).currentResourceVersion,1);
    const native=await app!.evaluate(({app})=>({version:app.getVersion(),packaged:app.isPackaged,exe:app.getPath('exe'),appData:app.getPath('appData'),cold:JSON.parse(process.getBuiltinModule('fs').readFileSync(process.getBuiltinModule('path').join(app.getAppPath(),'runtime-cold.json'),'utf8'))}));
    assert.equal(native.packaged,true);assert.equal(native.version,coldVersion);assert.equal(native.exe,exe);
    const cold=native.cold as ColdRuntime,envelope=JSON.parse(await fs.readFile(path.join(downloads,'latest.json'),'utf8')),checked=verifyRuntimeManifest(envelope,cold);
    assert.equal(checked.digest,expected);assert.equal(checked.manifest.sourceCommit,source);assert.equal(checked.manifest.codeVersion,coldVersion);assert.equal(checked.manifest.resourceVersion,resourceVersion);
    const initial=verifyRuntimeManifest(JSON.parse(await fs.readFile(path.join(install,'resources/runtime-initial.json'),'utf8')),cold,{installed:true});
    assert.deepEqual(checked.manifest.engines,initial.manifest.engines,'R-only must preserve original E identities');
    const identity=createHash('sha256').update(path.resolve(exe).toLowerCase()+'\n'+path.resolve(user).toLowerCase()).digest('hex').slice(0,24),cache=path.join(native.appData,'CBIM-runtime',identity,coldVersion),state=path.join(user,'desktop-runtime',identity,coldVersion);
    const journal=new RuntimeJournal(state,{digest:initial.digest,resourceVersion:1});
    const address=server.address();assert.ok(address&&typeof address!=='string');
    const models=await page.evaluate(profile=>window.cbim.call('models.save',{profile}),{name:'R acceptance',api:'openai-completions' as const,baseUrl:`http://127.0.0.1:${address.port}/v1`,auth:'none' as const,defaultModel:'acceptance',models:[{id:'acceptance',name:'Acceptance',enabled:true,contextWindow:32768,maxTokens:1024,reasoning:false,pricing:{input:0,output:0,cacheRead:0,cacheWrite:0}}]});
    const workspace=path.join(root,'project');await fs.mkdir(workspace);const entry=await page.evaluate(path=>window.cbim.call('add',{path}),workspace);
    const beforeKnowledge=await page.evaluate(id=>window.cbim.call('snapshot',{id}),entry.id);
    await fs.writeFile(path.join(workspace,'retained.txt'),'R1 business data');await page.evaluate(()=>{localStorage.setItem('runtime-retention','R1');localStorage.setItem('cbim.theme','light')});
    const task=await page.evaluate(id=>window.cbim.call('loop.chat',{id,message:'Record completed acceptance task',options:{permission:'read',turnTimeoutMs:60000}}),entry.id);
    await until(()=>page.evaluate(args=>window.cbim.call('loop.inspect',args),{id:entry.id,taskId:task.taskId,runId:task.runId}),v=>v.status==='completed');assert.equal(requests,1);
    // C 0.1.18 已核实使用跨 C 的官方 E 缓存；真实下载完成后保存安装记录和逐文件证据，不手填缓存。
    const engineSnapshot=async()=>{
      const descriptor=initial.manifest.engines.find(engine=>engine.kind==='pi');assert.ok(descriptor?.adapter);
      const directory=path.join(native.appData,'CBIM-runtime',identity,'engines','packages',descriptor.package.sha256),files=[];
      for(const item of descriptor.package.files){const file=path.join(directory,item.path),stat=await fs.stat(file);assert.equal(stat.size,item.bytes);assert.equal(await hash(file),item.sha256);files.push({path:item.path,bytes:stat.size,sha256:item.sha256,mtimeMs:stat.mtimeMs})}
      const state=await page.evaluate(()=>window.cbim.call('engines.settings')),pi=state.items.find(item=>item.kind==='pi');assert.equal(pi?.active?.identity,descriptor.package.sha256);
      return {files,installation:await fs.readFile(path.join(user,'engine-installations.json'),'utf8'),enabled:pi.enabled,version:pi.active.version,nativeVersion:pi.active.nativeVersion};
    };
    let retainedEngine:Awaited<ReturnType<typeof engineSnapshot>>|undefined;
    if(coldVersion==='0.1.18'){
      const settings=await page.evaluate(()=>window.cbim.call('engines.settings'));
      await page.evaluate(revision=>window.cbim.call('engines.configure',{kind:'pi',revision,action:'disable'}),settings.revision);
      retainedEngine=await engineSnapshot();assert.equal(retainedEngine.enabled,false);await save('engine-cache-before',retainedEngine);
    }
    if(mode==='candidate'){
      await close();
      const store=new RuntimeStore(cache,cold,async(pkg,target,_signal,progress)=>{const file=path.join(downloads,pkg.name);assert.equal(await hash(file),pkg.sha256);await fs.copyFile(file,target);progress(100)});
      await store.saveManifest(envelope);await store.prepare(checked.manifest.resource,new AbortController().signal);
      await launch();assert.equal((await status()).currentResourceVersion,1);await close();assert.equal(journal.read().pending,undefined);
      // 候选预发布阶段由测试明确授权缓存中的真实签名包；不冒充公开下载或真实 UI 点击。
      journal.authorize({digest:expected,resourceVersion:checked.manifest.resourceVersion});await launch();
    }else{
      const ready=await until(status,v=>v.phase==='ready',300000);assert.equal(ready.release?.resourceVersion,checked.manifest.resourceVersion);assert.equal(ready.release?.delivery,'resources');
      await save('ready',ready);await page.screenshot({path:path.join(root,'ready.png')});assert.equal(journal.read().pending,undefined);
      await close();await launch();assert.equal((await status()).currentResourceVersion,1);assert.equal(journal.read().pending,undefined);
      await until(status,v=>v.phase==='ready',300000);const oldPid=app!.pid;
      await page.waitForFunction(()=>document.querySelector('.software-update-button')?.getAttribute('aria-disabled')==='false');try{await app!.exitAfter(()=>page.getByRole('button',{name:'版本与更新',exact:true}).click(),'resource-ui-install')}finally{app=undefined}
      await until(async()=>journal.read(),v=>v.confirmed===expected&&!v.pending);
      const escaped=exe.replaceAll("'","''");
      const restarted=await until(async()=>{const raw=ps(`Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq '${escaped}' -and $_.ProcessId -ne ${oldPid} -and $_.CommandLine -notlike '*--type=*' } | Select-Object ProcessId,ExecutablePath,CommandLine | ConvertTo-Json -Compress`);return raw?JSON.parse(raw):undefined},v=>!!v);
      assert.ok(!Array.isArray(restarted));await save('actual-restart',restarted);
      ps(`$p=Get-Process -Id ${restarted.ProcessId}; if($p.Path -ne '${escaped}' -or $p.MainWindowHandle -eq 0){throw 'Wrong restarted process'}; if(-not $p.CloseMainWindow()){throw 'Close refused'}; if(-not $p.WaitForExit(30000)){throw 'Close timeout'}`);
      await launch();
    }
    assert.equal((await status()).currentResourceVersion,checked.manifest.resourceVersion);
    await until(()=>page.evaluate(()=>window.cbim.call('list')),v=>v.entries.some(e=>e.id===entry.id&&e.state==='running'&&!!e.instanceId));
    assert.equal(await page.evaluate(()=>localStorage.getItem('runtime-retention')),'R1');assert.equal(await fs.readFile(path.join(workspace,'retained.txt'),'utf8'),'R1 business data');
    assert.deepEqual(await page.evaluate(()=>window.cbim.call('models.list')),models);
    const knowledge=await page.evaluate(id=>window.cbim.call('snapshot',{id}),entry.id);assert.equal(knowledge.revision,beforeKnowledge.revision);assert.deepEqual(knowledge.files,beforeKnowledge.files);
    const summary=await page.evaluate(args=>window.cbim.call('loop.inspect',args),{id:entry.id,taskId:task.taskId,runId:task.runId});assert.equal(summary.status,'completed');assert.equal(requests,1);
    assert.equal(journal.read().confirmed,expected);assert.equal(journal.read().pending,undefined);assert.deepEqual(errors,[]);
    await page.screenshot({path:path.join(root,'upgraded.png')});
    if(coldVersion==='0.1.17'){
      // 实际安装版验证新设置中心、旧主题迁移和保存；不连接生产账号或改动模型。
      await page.getByRole('button',{name:'用户菜单',exact:true}).click();await page.getByRole('menuitem',{name:'主题与个性化',exact:true}).click();
      await page.getByRole('heading',{name:'主题与个性化',exact:true}).waitFor();assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme),'light');
      await page.getByLabel('对话正文字号',{exact:true}).selectOption('17');await page.screenshot({path:path.join(root,'settings-center.png')});
      await page.getByRole('button',{name:'返回工作空间',exact:true}).click();
      assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('cbim.appearance.v1')!).textSize),17);
    }
    if(coldVersion==='0.1.18'){
      const after=await engineSnapshot();assert.deepEqual(after,retainedEngine,'R update must retain disabled installation and every cached engine file');await save('engine-cache-after',after);
      await page.getByRole('button',{name:'用户菜单',exact:true}).click();await page.getByRole('menuitem',{name:'主题与个性化',exact:true}).click();
      await page.getByRole('navigation',{name:'设置分类',exact:true}).getByRole('button',{name:'引擎',exact:true}).click();
      const selector=page.getByRole('combobox',{name:'选择引擎',exact:true}),overview=page.getByRole('region',{name:'全部引擎总览',exact:true});
      assert.equal(await selector.inputValue(),'all');await overview.getByRole('heading',{name:'已安装引擎 · 1',exact:true}).waitFor();
      const pi=overview.getByRole('button',{name:'查看 Pi 引擎详情',exact:true});
      await pi.getByText('当前版本 '+after.version,{exact:true}).waitFor();await pi.getByText('运行库 '+after.nativeVersion,{exact:true}).waitFor();
      await pi.getByText('已停用',{exact:true}).waitFor();await pi.getByText('未运行',{exact:true}).waitFor();await page.screenshot({path:path.join(root,'engine-overview.png')});
      await pi.click();assert.equal(await selector.inputValue(),'pi');
      const detail=page.getByRole('article',{name:'Pi 引擎详情',exact:true});await detail.getByRole('button',{name:'启用',exact:true}).click();
      await detail.getByText('安装状态：已安装 · 已启用',{exact:true}).waitFor();await selector.selectOption('all');await pi.getByText('空闲',{exact:true}).waitFor();
      assert.deepEqual((await engineSnapshot()).files,after.files,'Viewing and enabling must reuse the same cached files');assert.equal(requests,1);
      await page.getByRole('button',{name:'返回工作空间',exact:true}).click();
    }
    await close();
    const recoveryChecks:string[]=[];
    if(mode==='candidate'){
      // 独立状态目录验证同一真实包的加载前损坏回退与数据访问后拒绝降级，不触碰已升级 profile。
      const failureState=path.join(root,'failure-state'),testCache=path.join(root,'failure-cache');const failureStore=new RuntimeStore(testCache,cold,async(pkg,target)=>fs.copyFile(path.join(downloads,pkg.name),target));
      await failureStore.saveManifest(envelope);const prepared=await failureStore.prepare(checked.manifest.resource,new AbortController().signal);
      const failureJournal=new RuntimeJournal(failureState,{digest:initial.digest,resourceVersion:1});failureJournal.authorize({digest:expected,resourceVersion:checked.manifest.resourceVersion});
      const first=checked.manifest.resource.files[0],target=path.join(prepared,first.path),original=await fs.readFile(target);await fs.writeFile(target,'corrupted');
      const selected=selectBootResources(cold,testCache,path.join(install,'resources/bundled-resources'),path.join(install,'resources/runtime-initial.json'),failureState);assert.equal(selected.manifest.resourceVersion,1);assert.ok(failureJournal.read().quarantined.includes(expected));recoveryChecks.push('before-data corruption quarantined and R1 selected');
      await fs.writeFile(target,original);const afterState=path.join(root,'after-data-state'),afterJournal=new RuntimeJournal(afterState,{digest:initial.digest,resourceVersion:1});afterJournal.authorize({digest:expected,resourceVersion:checked.manifest.resourceVersion});afterJournal.accessData(expected);
      assert.throws(()=>selectBootResources(cold,testCache,path.join(install,'resources/bundled-resources'),path.join(install,'resources/runtime-initial.json'),afterState),/RESOURCE_RECOVERY_REQUIRED/);recoveryChecks.push('after-data unconfirmed launch refuses downgrade');
    }
    await save('report',{success:true,mode,source,digest:expected,resourceVersion:checked.manifest.resourceVersion,coldVersion,coldInstallerSha256:await hash(installer),resourceSha256:checked.manifest.resource.sha256,resourceBytes:checked.manifest.resource.bytes,native,retained:{workspace:true,knowledge:true,models:true,completedTask:true,businessFile:true,localStorage:true,noReplay:true,engineInstallationAndCache:!!retainedEngine},engineOverviewVerified:coldVersion==='0.1.18',requests,pageErrors:errors,recoveryChecks,limitations:mode==='candidate'?'Signed candidate staged by harness; public discovery/UI apply tested separately. Failure branches use actual package with selector, not native recovery dialog.':'Real anonymous public channel and UI apply; deterministic localhost model validates retention, not model quality.',completedAt:new Date().toISOString()});
  }catch(error){await save('failure',{error:String(error),stack:error instanceof Error?error.stack:undefined,requests,errors});if(app)await page!.screenshot({path:path.join(root,'failure.png')}).catch(()=>{});throw error}
  finally{try{await close()}finally{await save('process-lifecycle',processLifecycle);server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))}}
}
main().catch(error=>{console.error(error);process.exitCode=1});
