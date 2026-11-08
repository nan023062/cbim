import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {chromium} from 'playwright-core';
const root=process.cwd(),out=path.join(root,'test-results');await fs.mkdir(out,{recursive:true});
await fs.writeFile(path.join(out,'desktop-updates-ui.html'),'<div id="root"></div><script type="module" src="/test-results/desktop-updates-ui.mjs"></script>');
const fixture=String.raw`
import React from 'react';import {createRoot} from 'react-dom/client';import '/src/frontend/shell/shell.css';
let status={currentVersion:'0.1.0',currentNotes:'修复反馈工具诊断\n支持手动更新\n<img src=x onerror=alert(1)>',enabled:true,phase:'idle'};
window.fixture={calls:[],unexpected:[],hasUpdate:false,failDownload:false,failStatus:false,holdRead:false,set:value=>status={...status,...value}};
window.cbim={call:async(action,args)=>{const f=window.fixture;f.calls.push({action,args});
 if(action==='desktop.updates.status'){if(f.failStatus)throw Error('read failed');const snapshot=structuredClone(status);if(f.holdRead){f.holdRead=false;return new Promise(resolve=>f.releaseRead=()=>resolve(snapshot))}return snapshot}
 if(action==='desktop.updates.check'){status={...status,phase:f.hasUpdate?'available':'current',checkedAt:'2026-11-09T01:00:00Z',release:f.hasUpdate?{version:'0.2.0',notes:'修复 BUG\n<img src=x onerror=alert(1)>',tag:'desktop-v0.2.0',publishedAt:'2026-11-09T00:00:00Z'}:undefined};return structuredClone(status)}
 if(action==='desktop.updates.download'){if(f.failDownload)throw Error('offline');status={...status,phase:'downloading',progress:25};return new Promise(resolve=>f.finishDownload=()=>{status={...status,phase:'ready',progress:100};resolve(structuredClone(status))})}
 if(action==='desktop.updates.install'){status={...status,phase:'installing'};return structuredClone(status)}
 if(action==='list')return {entries:[]};
 if(action==='models.list')return {profiles:[],secureStorage:true};
 if(action==='resources.status')return {source:'local',session:{state:'signedOut'}};
 if(action==='admission.settings')return {revision:1,maxConcurrentRuns:4};
 if(action==='admission.read')return {kind:'snapshot',snapshot:{cursor:{streamId:'update-ui',revision:1},policy:{revision:1,maxConcurrentRuns:4},occupied:[],waiting:[]}};
 if(action==='budget.settings')return {revision:1,enabled:false,limits:{}};
 if(action==='github.feedback.status')return {config:{clientId:'public-test-client',owner:'nan023062',repo:'cbim',visibility:'public'},secureStorage:true};
 f.unexpected.push(action);throw Error('Unexpected IPC '+action);
}};
const {App}=await import('/src/frontend/shell/App.tsx');createRoot(document.getElementById('root')).render(React.createElement(App));
`;
await fs.writeFile(path.join(out,'desktop-updates-ui.mjs'),fixture);
const server=await createServer({root,configFile:false,esbuild:{jsx:'automatic'},server:{host:'127.0.0.1',port:0},logLevel:'error'});let browser;
const checks=[],errors=[];
try{
 await server.listen();browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage({viewport:{width:1100,height:850}});page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:'+server.httpServer.address().port+'/test-results/desktop-updates-ui.html');
 const profile=page.getByRole('button',{name:'用户菜单',exact:true}),dialog=page.getByRole('dialog');
 const openMenu=async()=>{await profile.click();await page.getByRole('menu',{name:'用户菜单',exact:true}).waitFor()};
 const close=async()=>{await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});assert.equal(await profile.evaluate(e=>e===document.activeElement),true)};
 const count=async action=>(await page.evaluate(()=>window.fixture.calls)).filter(x=>x.action===action).length;
 await openMenu();await page.getByLabel('当前版本',{exact:true}).filter({hasText:'0.1.0'}).waitFor();
 assert.equal(await page.getByRole('menuitem',{name:'设置',exact:true}).evaluate(e=>e===document.activeElement),true);
 await page.keyboard.press('End');assert.equal(await page.getByRole('menuitem',{name:'最近一次更新',exact:true}).evaluate(e=>e===document.activeElement),true);
 await page.keyboard.press('Enter');await page.getByRole('dialog',{name:'最近一次更新',exact:true}).waitFor();
 assert.match(await dialog.innerText(),/修复反馈工具诊断/);assert.equal(await dialog.locator('img').count(),0);
 assert.equal(await count('desktop.updates.check'),0);assert.equal(await count('desktop.updates.download'),0);
 // 原生 dialog 允许 Tab 到浏览器 chrome（activeElement 为 body）；应核对背景控件不可聚焦及框内导航。
 assert.equal(await dialog.evaluate(e=>e.matches(':modal')),true);await profile.evaluate(e=>e.focus());assert.equal(await profile.evaluate(e=>e===document.activeElement),false);
 await dialog.getByRole('button',{name:'关闭版本与更新',exact:true}).focus();await page.keyboard.press('Tab');assert.equal(await dialog.getByRole('button',{name:'检查更新',exact:true}).evaluate(e=>e===document.activeElement),true);
 await page.keyboard.press('Shift+Tab');assert.equal(await dialog.getByRole('button',{name:'关闭版本与更新',exact:true}).evaluate(e=>e===document.activeElement),true);
 await close();checks.push('account-menu-keyboard-focus-return','installed-notes-without-check','release-notes-plain-text');

 // 真实 App 的设置表单用于验证弹窗不会切屏或重挂载，避免只测试孤立展示组件。
 await openMenu();await page.getByRole('menuitem',{name:'设置',exact:true}).click();await page.getByRole('button',{name:'添加供应商',exact:true}).click();
 const draft=page.getByPlaceholder('我的模型服务');await draft.fill('尚未保存的供应商草稿');await draft.evaluate(e=>window.fixture.draftNode=e);
 assert.equal(await page.getByRole('heading',{name:'版本与更新',exact:true}).count(),0);
 await openMenu();await page.getByRole('menuitem',{name:'最近一次更新',exact:true}).click();await dialog.waitFor();await close();
 assert.equal(await draft.inputValue(),'尚未保存的供应商草稿');assert.equal(await draft.evaluate(e=>e===window.fixture.draftNode),true);
 checks.push('settings-entry-removed','original-page-and-unsaved-draft-retained');

 await openMenu();await page.getByRole('menuitem',{name:'检查更新',exact:true}).click();await dialog.getByText('当前没有更高版本的桌面正式发布。',{exact:true}).waitFor();
 assert.match(await dialog.locator('.software-release-notes').innerText(),/修复反馈工具诊断/);assert.equal(await count('desktop.updates.check'),1);checks.push('current-version-still-shows-notes');
 await page.evaluate(()=>{window.fixture.hasUpdate=true;window.fixture.holdRead=true});await page.waitForFunction(()=>typeof window.fixture.releaseRead==='function');
 await dialog.getByRole('button',{name:'检查更新',exact:true}).click();await dialog.getByRole('button',{name:'下载更新',exact:true}).waitFor();
 await page.evaluate(()=>window.fixture.releaseRead());await dialog.getByRole('heading',{name:'可用版本 0.2.0',exact:true}).waitFor();
 assert.equal(await dialog.locator('img').count(),0);assert.equal(await count('desktop.updates.download'),0);checks.push('old-status-does-not-replace-action-result','new-release-without-implicit-download');

 await page.evaluate(()=>window.fixture.failDownload=true);await dialog.getByRole('button',{name:'下载更新',exact:true}).click();await dialog.getByRole('alert').waitFor();
 assert.equal(await dialog.getByRole('button',{name:'下载更新',exact:true}).isEnabled(),true);
 await page.evaluate(()=>window.fixture.failDownload=false);await dialog.getByRole('button',{name:'下载更新',exact:true}).click();await dialog.getByText('正在下载并校验… 25%',{exact:true}).waitFor();
 await page.evaluate(()=>window.fixture.set({progress:60}));await dialog.getByText('正在下载并校验… 60%',{exact:true}).waitFor();await close();
 assert.equal(await draft.inputValue(),'尚未保存的供应商草稿');await page.evaluate(()=>window.fixture.finishDownload());
 await page.locator('.software-update-notice').filter({hasText:'新版已下载'}).waitFor();assert.equal(await count('desktop.updates.install'),0);
 checks.push('download-error-retry','download-progress-keeps-polling','dialog-close-keeps-download');

 const checksBeforeNotice=await count('desktop.updates.check');await page.getByRole('button',{name:'查看更新',exact:true}).click();await dialog.getByRole('button',{name:'停止任务并重启安装',exact:true}).waitFor();
 assert.equal(await count('desktop.updates.check'),checksBeforeNotice);assert.equal(await count('desktop.updates.install'),0);
 await page.screenshot({path:path.join(out,'desktop-updates-account-dark.png')});await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});
 await page.getByRole('button',{name:'稍后提醒',exact:true}).click();await page.locator('.software-update-notice').waitFor({state:'hidden'});
 await openMenu();await page.getByRole('menuitem',{name:'切换浅色模式',exact:true}).click();await openMenu();await page.screenshot({path:path.join(out,'desktop-updates-account-menu.png')});
 await page.getByRole('menuitem',{name:'最近一次更新',exact:true}).click();await dialog.getByRole('button',{name:'停止任务并重启安装',exact:true}).waitFor();
 await page.screenshot({path:path.join(out,'desktop-updates-account-light.png')});
 await page.setViewportSize({width:320,height:720});assert.equal(await dialog.evaluate(e=>e.scrollWidth<=e.clientWidth),true);const box=await dialog.boundingBox();assert.ok(box.x>=0&&box.x+box.width<=320);
 await page.screenshot({path:path.join(out,'desktop-updates-account-narrow.png')});checks.push('notice-opens-same-dialog','dismiss-keeps-account-entry','light-dark-and-320px-dialog');
 await page.setViewportSize({width:1100,height:850});

 await page.evaluate(()=>window.fixture.failStatus=true);await dialog.getByRole('alert').filter({hasText:'无法读取更新状态'}).waitFor();
 await page.evaluate(()=>window.fixture.failStatus=false);await dialog.getByRole('button',{name:'重试读取状态',exact:true}).click();await dialog.getByRole('alert').waitFor({state:'hidden'});checks.push('status-read-error-recovery');
 await dialog.getByRole('button',{name:'停止任务并重启安装',exact:true}).click();await dialog.getByText('正在关闭任务并启动安装…',{exact:true}).waitFor();assert.equal(await count('desktop.updates.install'),1);checks.push('install-only-after-explicit-second-action');
 await close();await page.evaluate(()=>window.fixture.set({enabled:false,phase:'disabled',release:undefined,currentNotes:''}));await openMenu();await page.getByRole('menuitem',{name:'最近一次更新',exact:true}).click();
 await dialog.getByText('此构建未附带正式更新日志。',{exact:true}).waitFor();assert.equal(await dialog.getByRole('button',{name:'检查更新',exact:true}).count(),0);checks.push('portable-empty-notes-without-update-action');
 assert.deepEqual(await page.evaluate(()=>window.fixture.unexpected),[]);assert.deepEqual(errors,[]);
 await fs.writeFile(path.join(out,'desktop-updates-ui-report.json'),JSON.stringify({success:true,kind:'real-app-react-with-mocked-ipc',checks,pageErrors:errors},null,2));
 console.log('Account update UI checks passed: '+checks.length+' (real App, mocked IPC).');
}catch(error){await fs.writeFile(path.join(out,'desktop-updates-ui-report.json'),JSON.stringify({success:false,kind:'real-app-react-with-mocked-ipc',checks,pageErrors:errors,error:String(error)},null,2));throw error}
finally{await browser?.close();await server.close()}
