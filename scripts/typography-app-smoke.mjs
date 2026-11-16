// 完整 App 使用既有隔离 IPC，只读浏览主对话、工具、帮助和更新。
import fs from 'node:fs/promises';import path from 'node:path';import assert from 'node:assert/strict';import {createServer} from 'vite';import {chromium} from 'playwright-core';
const root=process.cwd(),out=path.join(root,'test-results/typography-pages');await fs.mkdir(out,{recursive:true});
await fs.writeFile(path.join(out,'app.html'),'<html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/scripts/office-team-ui-fixture.tsx"></script></html>');
const server=await createServer({root,configFile:false,esbuild:{jsx:'automatic'},server:{host:'127.0.0.1',port:0},logLevel:'error'});let browser;const results=[],errors=[];
try{await server.listen();browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage({viewport:{width:1440,height:1000}});page.on('pageerror',e=>errors.push(e.message));
await page.goto('http://127.0.0.1:'+server.httpServer.address().port+'/test-results/typography-pages/app.html');await page.getByText('象棋研发办公室',{exact:true}).click();await page.getByText('已派发，等待成员回传后继续处理。',{exact:true}).first().waitFor();
for(const theme of ['light','dark'])for(const width of [1440,390,320]){
await page.setViewportSize({width,height:1000});await page.evaluate(t=>{document.documentElement.dataset.theme=t;document.documentElement.style.colorScheme=t},theme);
await page.mouse.move(1000,700);await page.waitForTimeout(300);await page.screenshot({animations:'disabled',path:path.join(out,'full-conversation-'+theme+'-'+width+'.png')});
const metric=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,font:getComputedStyle(document.querySelector('.chat-message')).fontSize,input:getComputedStyle(document.querySelector('textarea')).fontSize}));
results.push({theme,...metric});assert.equal(metric.font,'15px');assert.equal(metric.input,'15px');assert.ok(metric.scroll<=width+1);
}
await page.setViewportSize({width:1440,height:1000});
await page.locator('.chat-tool summary').first().click();await page.screenshot({animations:'disabled',path:path.join(out,'full-tool-expanded.png')});
await page.getByRole('button',{name:'查看当前页面操作说明',exact:true}).click();await page.getByRole('dialog').waitFor();await page.screenshot({animations:'disabled',path:path.join(out,'full-help-open.png')});await page.keyboard.press('Escape');
assert.deepEqual(errors,[]);assert.deepEqual(await page.evaluate(()=>window.fixture.unexpected),[]);
await fs.writeFile(path.join(out,'app-results.json'),JSON.stringify({results,errors},null,2));console.log(JSON.stringify({results,errors}));
}finally{await browser?.close();await server.close()}
