import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {chromium} from 'playwright-core';
const root=process.cwd(),out=path.join(root,'test-results');await fs.mkdir(out,{recursive:true});
await fs.writeFile(path.join(out,'desktop-updates-ui.html'),'<div id="root"></div><script type="module" src="/test-results/desktop-updates-ui.mjs"></script>');
await fs.writeFile(path.join(out,'desktop-updates-ui.mjs'),`
import React from 'react';import {createRoot} from 'react-dom/client';
let status={currentVersion:'0.1.0',currentNotes:'当前日志',enabled:true,phase:'idle'};
window.fixture={calls:[],opened:0,fail:false,set:value=>status={...status,...value}};
window.cbim={call:async(action,args)=>{window.fixture.calls.push({action,args});
 if(action==='desktop.updates.status')return structuredClone(status);
 if(action==='desktop.updates.check'){status={...status,phase:'available',release:{version:'0.2.0',notes:'修复 BUG\\n<img src=x onerror=alert(1)>',tag:'desktop-v0.2.0',publishedAt:'2026-11-08'}};return status}
 if(action==='desktop.updates.download'){if(window.fixture.fail)throw Error('offline');status={...status,phase:'ready',progress:100};return status}
 if(action==='desktop.updates.install'){status={...status,phase:'installing'};return status}
 throw Error('Unexpected IPC '+action);
}};
const {SoftwareUpdates,SoftwareUpdateNotice}=await import('/src/frontend/settings/SoftwareUpdates.tsx');
createRoot(document.getElementById('root')).render(React.createElement(React.Fragment,null,React.createElement(SoftwareUpdateNotice,{openSettings:()=>window.fixture.opened++}),React.createElement(SoftwareUpdates)));
`);
const server=await createServer({root,configFile:false,esbuild:{jsx:'automatic'},server:{host:'127.0.0.1',port:0},logLevel:'error'});let browser;
try{
 await server.listen();browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage({viewport:{width:900,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/test-results/desktop-updates-ui.html`);
 await page.getByRole('button',{name:'检查更新',exact:true}).waitFor();
 assert.ok((await page.evaluate(()=>window.fixture.calls)).every(x=>x.action==='desktop.updates.status'));
 await page.getByRole('button',{name:'检查更新',exact:true}).click();await page.getByRole('button',{name:'下载更新',exact:true}).waitFor();
 assert.equal(await page.locator('.software-release-notes img').count(),0);
 assert.ok((await page.evaluate(()=>window.fixture.calls)).every(x=>!['desktop.updates.download','desktop.updates.install'].includes(x.action)));
 await page.getByRole('button',{name:'查看更新',exact:true}).click();assert.equal(await page.evaluate(()=>window.fixture.opened),1);
 await page.evaluate(()=>window.fixture.fail=true);await page.getByRole('button',{name:'下载更新',exact:true}).click();await page.getByRole('alert').waitFor();
 assert.equal(await page.getByRole('button',{name:'下载更新',exact:true}).isEnabled(),true);
 await page.evaluate(()=>window.fixture.fail=false);await page.getByRole('button',{name:'下载更新',exact:true}).click();await page.getByRole('button',{name:'停止任务并重启安装',exact:true}).waitFor();
 assert.equal((await page.evaluate(()=>window.fixture.calls)).filter(x=>x.action==='desktop.updates.install').length,0);
 await page.screenshot({path:path.join(out,'desktop-updates-ui-ready.png')});
 await page.getByRole('button',{name:'停止任务并重启安装',exact:true}).click();await page.getByText('正在关闭任务并启动安装…',{exact:true}).waitFor();
 assert.equal((await page.evaluate(()=>window.fixture.calls)).filter(x=>x.action==='desktop.updates.install').length,1);assert.deepEqual(errors,[]);
 await fs.writeFile(path.join(out,'desktop-updates-ui-report.json'),JSON.stringify({success:true,kind:'real-react-with-mocked-ipc',checks:['no-implicit-network-or-download','plain-text-release-notes','notice-navigation-only','retry-on-error','two-explicit-update-actions'],pageErrors:errors},null,2));
 console.log('Desktop update React checks passed (mocked IPC).');
}finally{await browser?.close();await server.close()}
