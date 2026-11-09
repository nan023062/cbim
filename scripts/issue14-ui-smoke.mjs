import {_electron as electron} from 'playwright-core';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {latestExecutable} from './build-artifact.mjs';

// 只启动本次便携构建，数据与项目位于独立临时目录；不安装或操作用户的正式客户端。
const temp=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-issue14-')),root=path.join(temp,'issue14-project'),user=path.join(temp,'user');
await fs.mkdir(root);await fs.mkdir('test-results',{recursive:true});
const errors=[],checks=[];let app,page;
try{
  const executable=await latestExecutable();
  assert.ok(path.resolve(executable).startsWith(path.resolve('build')+path.sep),'必须使用仓库本次便携构建');
  app=await electron.launch({executablePath:executable,env:{...process.env,CBIM_USER_DATA_ROOT:user},timeout:60000});
  assert.equal(path.resolve(await app.evaluate(({app})=>app.getPath('userData'))),path.resolve(user,'desktop'));
  page=await app.firstWindow();page.setDefaultTimeout(20000);page.on('pageerror',error=>errors.push(error.message));
  await page.setViewportSize({width:1400,height:1000});await page.waitForFunction(()=>!!window.cbim);
  const call=(action,args={})=>page.evaluate(({action,args})=>window.cbim.call(action,args),{action,args});
  const entry=await call('add',{path:root});
  const view=()=>page.locator('.extension-area:not([hidden]) .extension-content:not([hidden])');
  async function open(){
    await page.getByRole('button',{name:'issue14-project · 运行中',exact:true}).click();
    const expand=page.getByRole('button',{name:'展开右侧扩展',exact:true});if(await expand.isVisible())await expand.click();
    const tab=page.getByRole('tab',{name:'业务架构',exact:true});
    if(await tab.count())await tab.click();else{await page.getByRole('button',{name:'新增扩展页签',exact:true}).click();await view().getByRole('button',{name:'打开业务架构',exact:true}).click()}
    await view().getByTestId('project-root-module').waitFor();
  }
  await open();const initial=await call('snapshot',{id:entry.id});
  assert.deepEqual(initial.validation.tree.roots,[]);assert.equal(await view().getByTestId('project-root-module').count(),1);
  assert.match(await view().getByTestId('project-root-module').innerText(),/可直接开始开发/);
  assert.equal((await call('snapshot',{id:entry.id})).revision,initial.revision);checks.push('empty-project-root-visible-without-knowledge-write');
  await view().getByRole('button',{name:'按需创建第一个工程模块',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'新建模块',exact:true});
  await dialog.getByRole('textbox',{name:'目录标识',exact:true}).fill('game');
  await dialog.getByRole('textbox',{name:'职责摘要',exact:true}).fill('管理团队客户端资源加载、卸载与缓存，提供加载器和实例生命周期接口。包含异步请求取消、对象池复用、回调有效性检查与过期资源清理，支持定位加载失败、实例释放和重复请求问题。底层资源传输由相关系统提供，本模块负责运行期调用与生命周期管理。');
  await dialog.getByRole('textbox',{name:'维护人 ID',exact:true}).fill('fixture_owner');
  await dialog.getByRole('textbox',{name:'维护人姓名',exact:true}).fill('测试维护人');
  await dialog.getByRole('checkbox',{name:'确认维护责任',exact:true}).check();
  await dialog.getByRole('button',{name:'校验并预览',exact:true}).click();
  await dialog.getByRole('region',{name:'知识变更预览',exact:true}).waitFor();
  assert.ok(await dialog.getByRole('button',{name:'确认提交到工作区',exact:true}).isEnabled(),await dialog.innerText());
  await dialog.getByRole('button',{name:'确认提交到工作区',exact:true}).click();await dialog.waitFor({state:'hidden'});
  await view().locator('.module-card-content').filter({hasText:'game'}).waitFor();
  assert.equal(await view().getByTestId('project-root-module').count(),1);
  await view().getByTestId('project-root-module').getByRole('button').click();assert.equal(await view().locator('.inspector').count(),0);
  const saved=await call('snapshot',{id:entry.id});assert.deepEqual(saved.validation.tree.roots,['.cbim/workspace/game']);
  assert.ok(!saved.files.some(file=>file.path.includes('cbim:project')));checks.push('real-module-created-under-persistent-readonly-root');
  for(const theme of ['light','dark']){await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);await page.screenshot({path:'test-results/issue14-'+theme+'.png'})}
  await page.reload();await open();await view().locator('.module-card-content').filter({hasText:'game'}).waitFor();
  assert.equal((await call('snapshot',{id:entry.id})).revision,saved.revision);checks.push('reload-retains-root-and-real-module-without-new-write');
  assert.deepEqual(errors,[]);
  const report={executable,checks,pageErrors:errors,source:'packaged Electron with real IPC and isolated files',modelRequests:0};
  await fs.writeFile('test-results/issue14-ui-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}catch(error){const stem='test-results/issue14-ui-failure-'+Date.now();await fs.writeFile(stem+'.json',JSON.stringify({error:String(error),checks,errors,body:await page?.locator('body').innerText()},null,2));await page?.screenshot({path:stem+'.png'});throw error}
finally{await app?.close();const target=path.resolve(temp);if(path.dirname(target)!==path.resolve(os.tmpdir())||!path.basename(target).startsWith('cbim-issue14-'))throw Error('拒绝清理非本次测试目录');await fs.rm(target,{recursive:true,force:true})}
