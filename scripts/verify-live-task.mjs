// Verify an existing real-model run without sending another provider request.
import {_electron as electron} from 'playwright-core';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const [outputArg,profile]=process.argv.slice(2);
if(!outputArg||!profile)throw Error('Usage: node scripts/verify-live-task.mjs <report directory> <isolated profile>');
const output=path.resolve(outputArg),report=JSON.parse(await fs.readFile(path.join(output,'report.json'),'utf8'));
let app;const verification={startedAt:new Date().toISOString(),providerRequests:0};
try{
  const workspaceId=(await fs.readdir(profile)).find(id=>id!=='desktop');
  const tasks=path.join(profile,workspaceId,'loop-engine','tasks');
  const [taskId]=await fs.readdir(tasks),[runId]=await fs.readdir(path.join(tasks,taskId));
  app=await electron.launch({executablePath:report.executable,env:{...process.env,CBIM_USER_DATA_ROOT:profile},timeout:60000});
  const page=await app.firstWindow();page.setDefaultTimeout(15000);
  const call=(action,args)=>page.evaluate(({action,args})=>window.cbim.call(action,args),{action,args});
  await call('open',{id:workspaceId});
  const restored=await call('loop.inspect',{id:workspaceId,taskId,runId});
  assert.deepEqual(restored.taskProgress,report.taskProgress);assert.equal(restored.acceptance,'not_evaluated');verification.restartRestored=true;
  verification.denied=restored.events.filter(e=>e.type==='tool.denied').map(e=>({tool:e.data.name,reason:e.data.reason}));
  await page.getByRole('button',{name:'project · 运行中',exact:true}).click();
  // Sidebar history is restored from the persisted application layout.
  const tabs=page.getByRole('tab',{name:'任务视图',exact:true});await tabs.click();
  await page.getByRole('article',{name:'执行计划',exact:true}).waitFor();
  verification.taskView=await page.getByRole('article',{name:'执行计划',exact:true}).innerText();
  assert.ok(verification.taskView.includes('交付待审阅'));assert.ok(verification.taskView.includes('尚未业务验收'));
  const windowPromise=app.waitForEvent('window');
  await app.evaluate(({BrowserWindow},file)=>{const w=new BrowserWindow({width:900,height:700,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true}});void w.loadFile(file)},path.join(output,'project','index.html'));
  const game=await windowPromise;game.setDefaultTimeout(15000);await game.waitForLoadState();
  assert.equal(await game.locator('#value').innerText(),'0');
  for(let i=1;i<=3;i++){await game.getByRole('button',{name:'加一',exact:true}).click();assert.equal(await game.locator('#value').innerText(),String(i))}
  await game.getByRole('button',{name:'重置',exact:true}).click();assert.equal(await game.locator('#value').innerText(),'0');verification.browserVerified=true;
  try{await game.screenshot({path:path.join(output,'counter.png'),timeout:5000});verification.screenshot=true}catch{verification.screenshot=false}
  verification.passed=true;
}catch(error){verification.passed=false;verification.error=error.message;process.exitCode=1}
finally{if(app)await app.close().catch(()=>{});verification.finishedAt=new Date().toISOString();await fs.writeFile(path.join(output,'verification.json'),JSON.stringify(verification,null,2));console.log(JSON.stringify(verification))}
