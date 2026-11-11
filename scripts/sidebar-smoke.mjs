import {_electron as electron} from 'playwright-core';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {latestExecutable} from './build-artifact.mjs';
const temp=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-sidebar-')),root=path.join(temp,'project');await fs.mkdir(root);let app;
try{
 app=await electron.launch({executablePath:await latestExecutable(),env:{...process.env,CBIM_USER_DATA_ROOT:path.join(temp,'user')},timeout:60000});const page=await app.firstWindow();
 const entry=await page.evaluate(async root=>window.cbim.call('add',{path:root}),root);
 // 每个会话还包含重命名/删除按钮；只统计真正选择会话的按钮，保持验证新增两个会话。
 const create=page.getByRole('button',{name:'新对话 project',exact:true});await create.waitFor();await create.click();await page.waitForFunction(()=>document.querySelectorAll('.workspace-conversations .conversation-entry-select').length===1);
 await create.click();await page.waitForFunction(()=>document.querySelectorAll('.workspace-conversations .conversation-entry-select').length===2);
 // 侧栏条目先更新，中央会话仍需等待工作区快照和布局恢复；以可见页签作为就绪条件。
 await page.getByRole('tab',{name:'对话',exact:true}).waitFor({state:'visible',timeout:15000});
 assert.equal(await page.getByRole('tab',{name:'对话',exact:true}).count(),1);
 assert.equal(await page.locator('.workspace-conversations .conversation-entry-select').first().evaluate(e=>getComputedStyle(e).justifyContent),'flex-start');
 await page.getByRole('button',{name:'更多操作 project',exact:true}).click();
 assert.equal(await page.getByRole('menuitem',{name:/重启|MCP/}).count(),0);
 await page.getByRole('menuitem',{name:'关闭菜单',exact:true}).click();
 await page.getByRole('button',{name:'工作区设置',exact:true}).click();
 assert.equal(await page.getByRole('button',{name:/重启|MCP/}).count(),0);
 await page.getByRole('button',{name:'工作区状态',exact:true}).click();
 const diagnostics=page.getByRole('region',{name:'project 的工作区状态',exact:true});await diagnostics.waitFor();
 assert.equal(await diagnostics.getByRole('button').count(),1);
 const before=await page.evaluate(id=>window.cbim.call('snapshot',{id}),entry.id);
 await diagnostics.getByRole('button',{name:'重新检查知识',exact:true}).click();
 await diagnostics.getByRole('button',{name:'重新检查知识',exact:true}).waitFor();
 assert.equal((await page.evaluate(id=>window.cbim.call('snapshot',{id}),entry.id)).instanceId,before.instanceId);
 assert.equal(await page.locator('.mcp-summary,.mcp-service-panel').count(),0);
 console.log(JSON.stringify({newConversationCount:2,sessionChatTab:1,leftAligned:true,noRestartUi:true,noMcpUi:true,knowledgeCheckRetainsInstance:true}));
}finally{await app?.close();
 const resolved=path.resolve(temp);if(path.dirname(resolved)!==path.resolve(os.tmpdir())||!path.basename(resolved).startsWith('cbim-sidebar-'))throw Error('拒绝清理非本次侧栏测试目录');
 await fs.rm(resolved,{recursive:true,force:true});
}
