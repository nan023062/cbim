import {_electron as electron} from 'playwright-core';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {latestExecutable} from './build-artifact.mjs';
const temp=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-sidebar-')),root=path.join(temp,'project');await fs.mkdir(root);let app;
try{
 app=await electron.launch({executablePath:await latestExecutable(),env:{...process.env,CBIM_USER_DATA_ROOT:path.join(temp,'user')},timeout:60000});const page=await app.firstWindow();
 await page.evaluate(async root=>window.cbim.call('add',{path:root}),root);
 const create=page.getByRole('button',{name:'新对话 project',exact:true});await create.waitFor();await create.click();await page.waitForFunction(()=>document.querySelectorAll('.workspace-conversations button').length===1);
 await create.click();await page.waitForFunction(()=>document.querySelectorAll('.workspace-conversations button').length===2);
 assert.equal(await page.getByRole('tab',{name:'对话',exact:true}).count(),1);
 assert.equal(await page.locator('.workspace-conversations button').first().evaluate(e=>getComputedStyle(e).justifyContent),'flex-start');
 console.log(JSON.stringify({newConversationCount:2,sessionChatTab:1,leftAligned:true}));
}finally{await app?.close();await fs.rm(temp,{recursive:true,force:true})}
