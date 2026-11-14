import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {generateKeyPairSync,createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {_electron as electron,type ElectronApplication,type Page} from 'playwright-core';
import {buildRuntimeCode} from './runtime-build';
import {archiveDirectory,collectResources,signRuntimeManifest,coldFingerprint} from './runtime-packaging';
import {RuntimeJournal} from '../src/logic/updates/service/runtime-journal';
import type {ColdRuntime,RuntimeManifest} from '../src/logic/updates/service/runtime-manifest';
import type {} from '../src/bridge/contracts/workspace';

async function main(){
  const require=createRequire(import.meta.url),root=path.resolve('test-results/runtime-smoke-'+Date.now()),program=path.join(root,'program'),appRoot=path.join(program,'app'),resources=path.join(program,'resources'),user=path.join(root,'user'),appData=path.join(root,'appdata'),compiled=path.join(root,'compiled');
  await fs.mkdir(resources,{recursive:true});await fs.mkdir(user);await fs.mkdir(appData);await buildRuntimeCode(compiled);
  const key=generateKeyPairSync('ed25519'),codeVersion='0.2.0',cold:ColdRuntime={schema:1,codeVersion,platform:'win32-x64',coldFingerprint:await coldFingerprint(path.join(compiled,'build/desktop.js')),publicKey:key.publicKey.export({type:'spki',format:'pem'}).toString()};
  const bundled=path.join(resources,'bundled-resources');await collectResources(compiled,bundled);
  const resource=await archiveDirectory(bundled,root,'runtime-c'+codeVersion,'resources-r1');
  const engineRoot=path.join(root,'unused-engine');await fs.mkdir(engineRoot);await fs.writeFile(path.join(engineRoot,'entry.js'),'throw Error("UI startup must not run an engine")');
  const engine=await archiveDirectory(engineRoot,root,'runtime-engines','unused-engine');
  const createdAt=new Date().toISOString(),manifest:RuntimeManifest={schema:1,codeVersion,resourceVersion:1,coldFingerprint:cold.coldFingerprint,platform:cold.platform,createdAt,expiresAt:new Date(Date.now()+86400000).toISOString(),sourceCommit:'a'.repeat(40),notes:'资源切换隔离验证',resource,engines:(['pi','claude-code','codex'] as const).map(kind=>({kind,version:'1.0.0',entry:'entry.js',package:engine}))};
  const initial=await signRuntimeManifest(manifest,key.privateKey,cold);
  const updated=path.join(root,'updated');await fs.cp(bundled,updated,{recursive:true});await fs.writeFile(path.join(updated,'resource-marker.txt'),'R2');
  const nextResource=await archiveDirectory(updated,root,'runtime-c'+codeVersion,'resources-r2');
  const next=await signRuntimeManifest({...manifest,resourceVersion:2,resource:nextResource},key.privateKey,cold);
  await fs.mkdir(path.join(appRoot,'.vite/build'),{recursive:true});await fs.copyFile(path.join(compiled,'build/desktop.js'),path.join(appRoot,'.vite/build/desktop.js'));
  await fs.writeFile(path.join(appRoot,'runtime-cold.json'),JSON.stringify(cold));await fs.writeFile(path.join(resources,'runtime-initial.json'),JSON.stringify(initial));
  await fs.writeFile(path.join(resources,'desktop-release.json'),JSON.stringify({channel:'desktop-stable',version:codeVersion,notes:'测试冷包'}));
  await fs.cp('branding',path.join(resources,'branding'),{recursive:true});
  await fs.writeFile(path.join(program,'Uninstall CBIM Desktop.exe'),'test marker, not executable');
  const fakeExe=path.join(program,'CBIM Desktop.exe'),relaunchReceipt=path.join(root,'relaunch.json');
  const hostConfig={resources,appData,user,codeVersion,fakeExe,relaunchReceipt,next,archive:path.join(root,nextResource.name)};
  await fs.writeFile(path.join(appRoot,'host.json'),JSON.stringify(hostConfig));await fs.writeFile(path.join(appRoot,'package.json'),JSON.stringify({name:'cbim-runtime-smoke',version:codeVersion,main:'host.cjs'}));
  // 只在隔离测试宿主中模拟安装身份与公开下载源；产品没有测试绕过开关或外部路径 IPC。
  await fs.writeFile(path.join(appRoot,'host.cjs'),[
    "const fs=require('node:fs'),path=require('node:path'),{app}=require('electron'),config=require('./host.json');",
    "Object.defineProperty(app,'isPackaged',{get:()=>true});app.getVersion=()=>config.codeVersion;app.setPath('appData',config.appData);",
    "const original=app.getPath.bind(app);app.getPath=name=>name==='exe'?config.fakeExe:original(name);Object.defineProperty(process,'resourcesPath',{value:config.resources});",
    "app.relaunch=options=>fs.writeFileSync(config.relaunchReceipt,JSON.stringify({options,profile:app.getPath('userData')}));",
    "global.fetch=async input=>{const url=new URL(String(input));if(url.hostname==='api.github.com')return new Response('[]');if(url.pathname.endsWith('/latest.json'))return new Response(JSON.stringify(config.next));if(url.pathname.endsWith('/'+path.basename(config.archive))){const bytes=fs.readFileSync(config.archive);return new Response(bytes,{headers:{'content-length':String(bytes.length)}})}throw Error('Unexpected download: '+url);};",
    "require('./.vite/build/desktop.js');"
  ].join('\n'));
  const identity=createHash('sha256').update(path.resolve(fakeExe).toLowerCase()+'\n'+path.resolve(user).toLowerCase()).digest('hex').slice(0,24),cache=path.join(appData,'CBIM-runtime',identity,codeVersion),journal=new RuntimeJournal(path.join(user,'desktop-runtime',identity,codeVersion),{digest:createHash('sha256').update(initial.payload).digest('hex'),resourceVersion:1});
  let desktop:ElectronApplication|undefined,page:Page;const errors:string[]=[],timings:number[]=[];
  const launch=async()=>{const start=Date.now();const env:Record<string,string>=Object.fromEntries(Object.entries(process.env).filter((pair):pair is [string,string]=>pair[1]!==undefined));env.CBIM_USER_DATA_ROOT=user;delete env.ELECTRON_RUN_AS_NODE;desktop=await electron.launch({executablePath:require('electron'),args:[appRoot],env,timeout:45000});page=await desktop.firstWindow();page.on('pageerror',error=>errors.push(error.message));await page.getByRole('button',{name:'用户菜单',exact:true}).waitFor();timings.push(Date.now()-start);return desktop;};
  try{
    await fs.writeFile(path.join(user,'preserved.txt'),'existing user data');await launch();
    const before=await page!.evaluate(()=>window.cbim.call('desktop.updates.status'));assert.equal(before.currentResourceVersion,1);assert.equal(before.enabled,true);
    const prepared=await page!.evaluate(()=>window.cbim.call('desktop.updates.check'));assert.equal(prepared.phase,'ready');assert.equal(prepared.release?.resourceVersion,2);assert.equal(journal.read().pending,undefined);
    assert.equal((await fs.readdir(path.join(cache,'packages'))).length,1,'window startup must not prepare engines');
    await desktop!.close();desktop=undefined;assert.equal(journal.read().pending,undefined,'ordinary exit cannot activate a download');
    await launch();await page!.evaluate(()=>window.cbim.call('desktop.updates.check'));
    const button=page!.getByRole('button',{name:'版本与更新',exact:true});await button.waitFor();
    // controller 用轮询取得真实 ready 快照；等待属性，不在尚未就绪时强行派发点击。
    await page!.waitForFunction(()=>document.querySelector('.software-update-button')?.getAttribute('aria-disabled')==='false');
    await button.hover();await page!.screenshot({path:'test-results/runtime-ready.png'});
    const closed=desktop!.waitForEvent('close');await button.click();await closed;desktop=undefined;
    assert.equal(journal.read().pending?.stage,'authorized');assert.equal(JSON.parse(await fs.readFile(relaunchReceipt,'utf8')).profile,path.join(user,'desktop'));
    await launch();
    const after=await page!.evaluate(()=>window.cbim.call('desktop.updates.status'));assert.equal(after.currentResourceVersion,2);
    assert.equal(journal.read().pending,undefined);assert.equal(journal.read().highestResource,2);assert.equal(await fs.readFile(path.join(user,'preserved.txt'),'utf8'),'existing user data');
    await page!.getByRole('button',{name:'版本与更新',exact:true}).hover();await page!.screenshot({path:'test-results/runtime-r2.png'});assert.deepEqual(errors,[]);
    await fs.writeFile('test-results/runtime-update-smoke.json',JSON.stringify({passed:true,root,checks:['real signed R1 boot','no engine download before UI','background R preparation','ordinary exit leaves R1 active','sidebar explicit apply','drain before relaunch','same profile','real R2 main/preload/renderer boot','confirmation journal','user data retained'],resourceBytes:nextResource.bytes,windowReadyMs:timings,pageErrors:errors,limitations:'isolated Electron host with fixture network/install identity; no NSIS install, real update service, or model execution'},null,2));
    console.log(JSON.stringify({passed:true,resourceBytes:nextResource.bytes,windowReadyMs:timings,pageErrors:errors}));
  }finally{await desktop?.close()}
}
main().catch(error=>{console.error(error);process.exitCode=1});
