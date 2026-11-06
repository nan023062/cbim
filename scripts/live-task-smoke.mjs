// Opt-in real-provider desktop test. Uses the locally configured default model;
// copies only encrypted configuration into an isolated profile, never prints keys.
import {_electron as electron,chromium} from 'playwright-core';
import {pathToFileURL} from 'node:url';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {latestExecutable} from './build-artifact.mjs';

const stamp=new Date().toISOString().replace(/[:.]/g,'-');
const output=path.resolve('test-results','live-task-'+stamp),root=path.join(output,'project');
const profile=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-live-profile-'));
await fs.mkdir(root,{recursive:true});
let app,browser,run,entry;const report={startedAt:new Date().toISOString(),output,profile,realProvider:true,screenshotWarnings:[]};
async function screenshot(page,name){try{await page.screenshot({path:path.join(output,name),timeout:5000})}catch{report.screenshotWarnings.push(name)}}
try{
  await fs.copyFile(path.join(os.homedir(),'.cbim','llm.json'),path.join(profile,'llm.json'));
  // Windows safeStorage uses the desktop profile's DPAPI-protected encryption key.
  await fs.mkdir(path.join(profile,'desktop'),{recursive:true});
  await fs.copyFile(path.join(os.homedir(),'.cbim','desktop','Local State'),path.join(profile,'desktop','Local State'));
  report.executable=await latestExecutable();
  app=await electron.launch({executablePath:report.executable,env:{...process.env,CBIM_USER_DATA_ROOT:profile},timeout:60000});
  let page=await app.firstWindow();page.setDefaultTimeout(20000);
  const call=(action,args)=>page.evaluate(({action,args})=>window.cbim.call(action,args),{action,args});
  const models=await call('models.list');const selected=models.profiles.find(p=>p.id===models.selectedId);assert.ok(selected,'No configured default model');report.model=selected.defaultModel;
  entry=await call('add',{path:root});
  await page.getByRole('button',{name:'project · 运行中',exact:true}).click();
  await page.getByRole('combobox',{name:'执行权限',exact:true}).click();
  await page.getByRole('option').filter({hasText:'完全访问'}).click();
  await page.getByRole('textbox',{name:'对话草稿',exact:true}).fill('请在当前空工作区实现一个简单的单文件网页计数器 index.html：初始显示 0，点击加一按钮数值加一，点击重置按钮恢复 0。只做这个小功能，不安装依赖，不联网下载。请实际创建文件并执行必要验证，最后给出交付内容、验证结果与未验证项。控制实现规模，不超过 100 行。');
  await page.getByRole('button',{name:'发送消息',exact:true}).click();
  const deadline=Date.now()+240000;let result,last=0;
  while(Date.now()<deadline){
    const visibleError=await page.locator('[role="alert"]').allTextContents();if(visibleError.some(t=>t.includes('SECRET_STORAGE')))throw Error('隔离测试配置无法解密模型密钥');
    const records=await call('loop.list',{id:entry.id});
    if(records.length){run={taskId:records[0].task.taskId,runId:records[0].runId};result=await call('loop.inspect',{id:entry.id,...run});
      if(Date.now()-last>10000){console.log(JSON.stringify({status:result.status,events:result.events.length,planVersion:result.taskProgress?.version,tools:result.toolReceipts?.map(r=>({name:r.toolName,outcome:r.outcome}))}));last=Date.now()}
      if(result.status!=='running')break;
    }
    await new Promise(r=>setTimeout(r,1000));
  }
  assert.ok(result,'No run started');
  if(result.status==='running'){await call('loop.stop',{id:entry.id,taskId:run.taskId});throw Error('真实模型测试超过 4 分钟，已请求停止')}
  report.status=result.status;report.taskProgress=result.taskProgress;report.acceptance=result.acceptance;
  report.tools=result.toolReceipts?.map(r=>({toolCallId:r.toolCallId,name:r.toolName,outcome:r.outcome}));
  report.finalText=result.events.filter(e=>e.type==='message').at(-1)?.data.text;
  await screenshot(page,'conversation.png');
  await page.getByRole('tab',{name:'任务视图',exact:true}).click();
  await screenshot(page,'task-view.png');
  const file=path.join(root,'index.html');const html=await fs.readFile(file,'utf8');report.fileBytes=Buffer.byteLength(html);
  // Independent real Chromium browser; do not depend on the model's own validation.
  browser=await chromium.launch({channel:'msedge',headless:true});
  const game=await browser.newPage();await game.goto(pathToFileURL(file).href);
  report.buttons=await game.getByRole('button').allTextContents();
  report.pageBefore=await game.locator('body').innerText();
  await game.getByRole('button').filter({hasText:/加一|\+1|增加/}).first().click();
  report.pageAfterIncrement=await game.locator('body').innerText();
  assert.notEqual(report.pageBefore,report.pageAfterIncrement,'加一后页面未变化');
  await game.getByRole('button').filter({hasText:/重置|归零/}).first().click();
  assert.equal(await game.locator('body').innerText(),report.pageBefore,'重置没有恢复初始状态');report.browserVerified=true;
  await screenshot(game,'counter.png');await browser.close();browser=undefined;
  await app.close();app=undefined;
  app=await electron.launch({executablePath:report.executable,env:{...process.env,CBIM_USER_DATA_ROOT:profile},timeout:60000});page=await app.firstWindow();
  await call('open',{id:entry.id});
  const restored=await call('loop.inspect',{id:entry.id,...run});assert.deepEqual(restored.taskProgress,result.taskProgress);report.restartRestored=true;
  assert.equal(result.status,'completed');assert.equal(result.acceptance,'not_evaluated');
  assert.ok(result.taskProgress,'模型没有调用任务计划工具');
  assert.equal(result.taskProgress.state,'awaiting_review','模型未准备交付候选');
  report.passed=true;
}catch(error){report.passed=false;report.error=error.message;process.exitCode=1}
finally{
  if(browser)await browser.close().catch(()=>{});
  if(app)await app.close().catch(()=>{});
  await fs.rm(path.join(profile,'llm.json'),{force:true});
  await fs.rm(path.join(profile,'desktop','Local State'),{force:true});
  report.finishedAt=new Date().toISOString();await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}
