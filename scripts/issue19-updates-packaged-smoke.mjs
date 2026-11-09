import {_electron as electron} from 'playwright-core';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {latestExecutable} from './build-artifact.mjs';
const temp=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-issue19-')),user=path.join(temp,'user'),project=path.join(temp,'project'),checks=[],errors=[];
let desktop,page;
try{
  await fs.mkdir(project);await fs.writeFile(path.join(project,'keep.txt'),'existing project');await fs.mkdir('test-results',{recursive:true});
  const executable=await latestExecutable();assert.ok(path.resolve(executable).startsWith(path.resolve('build')+path.sep));
  const launch=async()=>{desktop=await electron.launch({executablePath:executable,env:{...process.env,CBIM_USER_DATA_ROOT:user},timeout:60000});assert.equal(path.resolve(await desktop.evaluate(({app})=>app.getPath('userData'))),path.resolve(user,'desktop'));page=await desktop.firstWindow();page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(15000);await page.getByRole('button',{name:'用户菜单',exact:true}).waitFor()};
  await launch();const call=(action,args)=>page.evaluate(({action,args})=>window.cbim.call(action,args),{action,args});
  const entry=await call('add',{path:project}),snapshot=await call('snapshot',{id:entry.id});
  const before=await call('desktop.updates.status');assert.equal(before.enabled,false);assert.equal(before.phase,'disabled');
  for(const action of ['check','download','install'])assert.equal((await call('desktop.updates.'+action)).phase,'disabled');
  const rejected=await page.evaluate(async()=>{try{await window.cbim.call('desktop.updates.download',{url:'https://invalid.example/installer.exe'});return false}catch{return true}});assert.equal(rejected,true);checks.push('portable-does-not-check-download-or-install-and-rejects-custom-source');
  const profile=page.getByRole('button',{name:'用户菜单',exact:true});await profile.click();assert.equal(await page.getByRole('menuitem',{name:'版本与更新',exact:true}).count(),1);assert.equal(await page.getByRole('menuitem',{name:'最近一次更新',exact:true}).count(),0);assert.equal(await page.getByRole('menuitem',{name:'检查更新',exact:true}).count(),0);
  await page.keyboard.press('End');await page.keyboard.press('Enter');const dialog=page.getByRole('dialog',{name:'版本与更新',exact:true});await dialog.waitFor();assert.equal(await dialog.getByRole('button',{name:'检查更新',exact:true}).count(),0);assert.equal(await page.getByRole('img',{name:'有新版本可更新',exact:true}).count(),0);
  await page.screenshot({path:'test-results/issue19-packaged-updates.png'});await page.keyboard.press('Escape');assert.equal(await profile.evaluate(node=>node===document.activeElement),true);checks.push('real-ipc-single-menu-notes-and-keyboard-focus');
  await desktop.close();desktop=undefined;await launch();const after=await call('snapshot',{id:entry.id});assert.equal(after.revision,snapshot.revision);assert.equal(await fs.readFile(path.join(project,'keep.txt'),'utf8'),'existing project');assert.deepEqual(await call('loop.list',{id:entry.id}),[]);assert.deepEqual(errors,[]);checks.push('normal-exit-and-reopen-preserve-project-without-execution');
  const report={executable,checks,pageErrors:errors,realInstallation:false,source:'real packaged Electron and IPC, isolated portable profile; no installed client touched'};await fs.writeFile('test-results/issue19-packaged-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}catch(error){const stem='test-results/issue19-packaged-failure-'+Date.now();await fs.writeFile(stem+'.json',JSON.stringify({error:String(error),checks,errors,body:await page?.locator('body').innerText()},null,2));await page?.screenshot({path:stem+'.png'});throw error}
finally{await desktop?.close();const target=path.resolve(temp);if(path.dirname(target)!==path.resolve(os.tmpdir())||!path.basename(target).startsWith('cbim-issue19-'))throw Error('拒绝清理非本次测试目录');await fs.rm(target,{recursive:true,force:true})}
