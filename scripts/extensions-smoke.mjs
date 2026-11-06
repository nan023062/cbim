import {_electron as electron} from 'playwright-core';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {latestExecutable} from './build-artifact.mjs';
const temp=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-extensions-')),root=path.join(temp,'project');await fs.mkdir(root);let app;
const server=http.createServer((req,res)=>res.end('<html><body><h1>EXTENSION_BROWSER_OK</h1></body></html>'));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
try{
 app=await electron.launch({executablePath:await latestExecutable(),env:{...process.env,CBIM_USER_DATA_ROOT:path.join(temp,'user')},timeout:60000});const page=await app.firstWindow();
 await page.evaluate(async root=>{const entry=await window.cbim.call('add',{path:root});localStorage.setItem('cbim.extensions.'+entry.id,JSON.stringify([{id:'legacy-flow',kind:'flow'}]))},root);await page.getByRole('button',{name:'新对话 project',exact:true}).click();
 await page.getByRole('textbox',{name:'对话草稿',exact:true}).fill('中央草稿保持不变');await page.getByRole('button',{name:'展开右侧扩展',exact:true}).click();
 const pane=page.getByRole('complementary',{name:'右侧扩展区',exact:true});assert.equal(await pane.getByRole('tab').count(),0);
 await pane.getByRole('button',{name:'新增空页签',exact:true}).click();for(const label of ['打开浏览器','打开终端','打开团队架构','打开业务架构'])assert.equal(await pane.getByRole('button',{name:label,exact:true}).count(),1);
 await pane.getByRole('button',{name:'打开终端',exact:true}).click();await pane.getByRole('textbox',{name:'终端命令'}).fill("Write-Output 'PANE_TERMINAL_OK'");await pane.getByRole('button',{name:'执行',exact:true}).click();await pane.getByLabel('终端输出').filter({hasText:'PANE_TERMINAL_OK'}).waitFor();
 await pane.getByRole('button',{name:'新增扩展页签',exact:true}).click();await pane.getByRole('button',{name:'打开浏览器',exact:true}).click();await pane.getByRole('textbox',{name:'浏览器地址'}).fill('http://127.0.0.1:'+server.address().port);await pane.getByRole('button',{name:'打开',exact:true}).click();await page.frameLocator('iframe[title="扩展浏览器"]').getByRole('heading',{name:'EXTENSION_BROWSER_OK'}).waitFor();
 const geometry=await page.evaluate(()=>{const a=document.querySelector('.main-conversation').getBoundingClientRect(),b=document.querySelector('.extension-area').getBoundingClientRect();return {chatRight:a.right,extensionLeft:b.left}});assert.ok(geometry.chatRight<=geometry.extensionLeft+1);
 await pane.getByRole('button',{name:'收起扩展区',exact:true}).click();assert.equal(await page.getByRole('textbox',{name:'对话草稿',exact:true}).inputValue(),'中央草稿保持不变');await page.getByRole('button',{name:'展开右侧扩展',exact:true}).click();assert.equal(await pane.getByRole('tab').count(),2);
 for(const label of ['打开团队架构','打开业务架构']){await pane.getByRole('button',{name:'新增扩展页签',exact:true}).click();await pane.getByRole('button',{name:label,exact:true}).click()}
 assert.equal(await pane.getByRole('button',{name:'打开任务调度视图'}).count(),0);await page.screenshot({path:'test-results/extensions.png'});
 assert.equal(await page.getByRole('textbox',{name:'对话草稿',exact:true}).inputValue(),'中央草稿保持不变');
 console.log(JSON.stringify({legacyTaskPanelRemoved:true,emptyByDefault:true,fourChoices:true,browser:true,terminal:true,independentChat:true,collapseRetainsTabs:true,geometry}));
}finally{await app?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await fs.rm(temp,{recursive:true,force:true})}
