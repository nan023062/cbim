// Exercise the real engine menu with deterministic desktop receipts; no real package installation.
import fs from 'node:fs/promises';import path from 'node:path';import assert from 'node:assert/strict';
import {createServer} from 'vite';import {chromium} from 'playwright-core';
const root=await fs.realpath(process.env.CBIM_UI_ROOT||process.cwd()),out=path.join(root,'test-results');await fs.mkdir(out,{recursive:true});
await fs.writeFile(path.join(out,'engine-menu.html'),'<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/test-results/engine-menu.tsx"></script>');
await fs.writeFile(path.join(out,'engine-menu.tsx'),`
import React from 'react';import {createRoot} from 'react-dom/client';
import '/src/view/styles';import '/src/view/conversation/conversation.css';
window.fixture={calls:[],selection:[],items:[{engine:'pi',state:'ready',installedVersion:'1.0.0',version:'1.0.0'},{engine:'claude-code',state:'install',version:'1.0.0'},{engine:'codex',state:'update',installedVersion:'1.0.0',version:'2.0.0'}],resolve:undefined};
window.cbim={call:async(action,args)=>{const f=window.fixture;f.calls.push({action,args});if(action==='desktop.engines.status')return structuredClone(f.items);if(action==='desktop.engines.prepare'){const row=f.items.find(i=>i.engine===args.engine);row.state='preparing';row.progress=36;return new Promise(resolve=>{f.resolve=()=>{row.state='ready';row.installedVersion=row.version;delete row.progress;resolve({...row})}})}throw Error(action)}};
const {EnginePicker}=await import('/src/view/conversation/EnginePicker.tsx');
createRoot(document.getElementById('root')).render(<main style={{position:'fixed',bottom:20,right:20}}><textarea aria-label="Draft" defaultValue="Keep draft"/><EnginePicker value="pi" onChange={value=>window.fixture.selection.push(value)}/></main>);
`);
const server=await createServer({root,configFile:false,optimizeDeps:{entries:['test-results/engine-menu.tsx']},esbuild:{jsx:'automatic'},server:{host:'127.0.0.1',port:0},logLevel:'error'});let browser;const errors=[],checks=[];
try{
 await server.listen();browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage({viewport:{width:1200,height:800}});page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:'+server.httpServer.address().port+'/test-results/engine-menu.html');
 await page.getByRole('button',{name:'Loop 引擎',exact:true}).click();const menu=page.getByRole('dialog',{name:'引擎选择与安装'});
 await menu.getByRole('button',{name:'安装',exact:true}).waitFor();assert.equal(await menu.locator('.engine-picker-row').count(),4);
 assert.equal(await page.evaluate(()=>window.fixture.calls.filter(c=>c.action==='desktop.engines.prepare').length),0);checks.push('all-engines-no-install-on-open');
 await menu.getByRole('button',{name:'更新',exact:true}).click();await page.getByRole('progressbar',{name:'Codex 准备进度'}).waitFor();
 await page.waitForFunction(()=>document.querySelector('[role=progressbar]')?.getAttribute('aria-valuenow')==='36');
 await page.keyboard.press('Escape');await menu.waitFor({state:'hidden'});assert.deepEqual(await page.evaluate(()=>window.fixture.selection),[]);
 await page.getByRole('button',{name:'Loop 引擎',exact:true}).click();await page.getByRole('progressbar').waitFor();
 assert.equal(await page.evaluate(()=>window.fixture.calls.filter(c=>c.action==='desktop.engines.prepare').length),1);checks.push('update-progress-close-reopen-no-replay');
 await page.setViewportSize({width:320,height:760});const bounds=await menu.boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=320);
 await page.emulateMedia({reducedMotion:'reduce'});await page.screenshot({path:path.join(out,'engine-menu-mobile.png')});checks.push('320px-ring-and-reduced-motion');
 await page.evaluate(()=>window.fixture.resolve());await menu.locator('[data-engine-choice]').filter({hasText:'Codex'}).click();
 assert.deepEqual(await page.evaluate(()=>window.fixture.selection),['codex']);assert.equal(await page.getByRole('textbox',{name:'Draft'}).inputValue(),'Keep draft');checks.push('install-does-not-select-select-after-ready');
 await page.evaluate(()=>{window.fixture.items[1]={engine:'claude-code',state:'failed',error:'下载失败，请重试',version:'1.0.0'}});
 await page.getByRole('button',{name:'Loop 引擎',exact:true}).click();await menu.getByRole('button',{name:'重试',exact:true}).click();
 assert.equal(await page.evaluate(()=>window.fixture.calls.filter(c=>c.action==='desktop.engines.prepare').length),2);await page.evaluate(()=>window.fixture.resolve());checks.push('explicit-failure-retry');
 assert.deepEqual(errors,[]);const report={checks,pageErrors:errors};await fs.writeFile(path.join(out,'engine-menu-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await browser?.close();await server.close()}
