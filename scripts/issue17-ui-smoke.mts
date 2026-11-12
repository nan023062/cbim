import {_electron as electron,type ElectronApplication,type Page} from 'playwright-core';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {Application} from '../src/backend/main/assembly/application';
import {Paths} from '../src/backend/main/platform/paths';
import {seedTeam} from '../tests/team-fixture';
import {summary} from '../tests/data/knowledge';
import {latestExecutable} from './build-artifact.mjs';

// 真实便携 Electron + IPC；仅用独立 Application 准备静态知识和无网络模型配置。
const temp=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-issue17-')),root=path.join(temp,'issue17-project'),user=path.join(temp,'user');
await fs.mkdir(root);await fs.mkdir('test-results',{recursive:true});
const errors:string[]=[],checks:string[]=[];let desktop:ElectronApplication|undefined,setup:Application|undefined,page:Page|undefined;
try{
  setup=new Application(new Paths(user,path.resolve('.')),path.resolve('design'));await setup.init();
  const entry=await setup.dispatch('add',{path:root}),team=await seedTeam(setup.workspace(entry.id));
  await setup.models.save({profile:{name:'No execution fixture',api:'openai-completions',baseUrl:'http://127.0.0.1:1',auth:'none',defaultModel:'fixture',models:[{id:'fixture',name:'Fixture',enabled:true,contextWindow:32768,maxTokens:1024,reasoning:false}]}});
  await setup.shutdown();setup=undefined;
  const executable=await latestExecutable();assert.ok(path.resolve(executable).startsWith(path.resolve('build')+path.sep));
  desktop=await electron.launch({executablePath:executable,env:{...process.env,CBIM_USER_DATA_ROOT:user},timeout:60000});
  assert.equal(path.resolve(await desktop.evaluate(({app})=>app.getPath('userData'))),path.resolve(user,'desktop'));
  // 先等真实窗口和 IPC 装配完成，再包装现有 handler；提前插入 Map 会与主程序注册竞争。
  page=await desktop.firstWindow();await page.waitForFunction(()=>!!(window as any).cbim);
  await desktop.evaluate(({ipcMain})=>{const handlers=(ipcMain as any)._invokeHandlers,original=handlers.get('cbim:call');(globalThis as any).issue17Trace=[];handlers.set('cbim:call',async(event:unknown,action:string,input:unknown)=>{(globalThis as any).issue17Trace.push(action);const result=await original(event,action,input);if((globalThis as any).issue17Drop&&action==='workspace.ownerships.commit'&&result.ok){(globalThis as any).issue17Drop=false;return {ok:false,error:{code:'TEST_RESPONSE_LOST',message:'真实提交后丢失回包'}}}return result})});
  page=await desktop.firstWindow();page.setDefaultTimeout(18000);page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
  await page.setViewportSize({width:1400,height:1000});await page.waitForFunction(()=>!!(window as any).cbim);
  const call=(action:string,args:unknown={})=>page!.evaluate(({action,args})=>(window as any).cbim.call(action,args),{action,args});
  const view=()=>page!.locator('.extension-area:not([hidden]) .extension-content:not([hidden])');
  const snapshot=()=>call('snapshot',{id:entry.id});
  const identity=async()=>({workspaceId:entry.id,instanceId:(await snapshot()).instanceId});
  const detail=async()=>call('workspace.ownerships.get',{...await identity(),moduleId:team.input.moduleId});
  async function until(check:()=>Promise<boolean>,label:string){const end=Date.now()+20000;while(Date.now()<end){try{if(await check())return}catch(error){if(!String(error).includes('OWNERSHIP_REGISTRY_STALE'))throw error}await new Promise(resolve=>setTimeout(resolve,60))}throw Error('等待失败：'+label)}
  async function open(){await page!.getByRole('button',{name:'issue17-project · 运行中',exact:true}).click();const expand=page!.getByRole('button',{name:'展开右侧扩展',exact:true});if(await expand.isVisible())await expand.click();const tab=page!.getByRole('tab',{name:'业务架构',exact:true});if(await tab.count())await tab.click();else{await page!.getByRole('button',{name:'新增扩展页签',exact:true}).click();await view().getByRole('button',{name:'打开业务架构',exact:true}).click()}}
  await open();const select=()=>view().getByRole('combobox',{name:'game 负责人',exact:true});await until(()=>select().isEnabled(),'负责人列表就绪');
  const options=await select().locator('option').allTextContents();assert.ok(options.includes('开发者')&&options.includes('CBIM 默认执行 Agent'));assert.ok(!options.includes('CBIM 主 Agent'));
  const beforeRuns=await call('loop.list',{id:entry.id});
  await select().selectOption('agent:cbim:executor');await until(async()=>!!(await detail()).view.binding?.ownerMemberId,'内置执行者保存');await until(()=>select().isEnabled(),'保存结束');
  const builtin=(await detail()).view.binding.ownerMemberId;assert.equal(await select().inputValue(),'member:'+builtin);assert.equal(await page.getByRole('dialog').count(),0);checks.push('one-level-builtin-selection-registers-and-binds-without-form');
  await select().selectOption('agent:'+team.input.agentId);await until(async()=>(await detail()).view.owner?.agentId===team.input.agentId,'自定义 Agent 保存');await until(()=>select().isEnabled(),'自定义保存结束');
  const custom=(await detail()).view.binding.ownerMemberId;
  await select().selectOption('');await until(async()=>!(await detail()).view.binding?.ownerMemberId,'解除负责人');await until(()=>select().isEnabled(),'解除结束');
  await select().selectOption('member:'+builtin);await until(async()=>(await detail()).view.binding?.ownerMemberId===builtin,'复用岗位');await until(()=>select().isEnabled(),'复用结束');
  assert.equal((await call('workspace.members.list',await identity())).total,2);checks.push('custom-switch-clear-and-reuse-with-two-real-members');
  await desktop.evaluate(()=>{(globalThis as any).issue17Drop=true});await select().selectOption('member:'+custom);
  await view().getByRole('alert').filter({hasText:'尚未确认'}).waitFor();assert.ok(await select().isDisabled());
  const writes=await desktop.evaluate(()=>(globalThis as any).issue17Trace.filter((name:string)=>name.endsWith('.commit')).length);
  await view().getByRole('button',{name:'核实原操作并刷新',exact:true}).click();await until(()=>select().isEnabled(),'原命令核实');assert.equal(await select().inputValue(),'member:'+custom);
  await page.reload();await open();await until(()=>select().isEnabled(),'重载');assert.equal(await select().inputValue(),'member:'+custom);
  assert.equal(await desktop.evaluate(()=>(globalThis as any).issue17Trace.filter((name:string)=>name.endsWith('.commit')).length),writes);checks.push('lost-commit-reply-query-and-reload-do-not-replay');
  await view().getByRole('button',{name:'编辑模块 game',exact:true}).click();await page.getByRole('dialog',{name:'编辑模块',exact:true}).getByRole('button',{name:'关闭',exact:true}).click();
  await view().getByRole('button',{name:'新建子模块 game',exact:true}).click();const create=page.getByRole('dialog',{name:'新建模块',exact:true});
  await create.getByRole('textbox',{name:'目录标识',exact:true}).fill('ui_child');await create.getByRole('textbox',{name:'职责摘要',exact:true}).fill(summary);await create.getByRole('textbox',{name:'维护人 ID',exact:true}).fill('fixture_owner');await create.getByRole('textbox',{name:'维护人姓名',exact:true}).fill('测试维护人');await create.getByRole('checkbox',{name:'确认维护责任',exact:true}).check();
  await create.getByRole('button',{name:'校验并预览',exact:true}).click();await create.getByRole('button',{name:'确认提交到工作区',exact:true}).click();await create.waitFor({state:'hidden'});
  const saved=(await snapshot()).revision;await view().getByRole('button',{name:'删除模块 ui_child',exact:true}).click();const remove=page.getByRole('dialog',{name:'删除模块',exact:true});await remove.getByRole('button',{name:'预览删除影响',exact:true}).click();await remove.getByRole('button',{name:'确认删除知识',exact:true}).waitFor();await remove.getByRole('button',{name:'关闭',exact:true}).click();assert.equal((await snapshot()).revision,saved);
  await view().getByRole('button',{name:'删除模块 ui_child',exact:true}).click();await remove.getByRole('button',{name:'预览删除影响',exact:true}).click();await remove.getByRole('button',{name:'确认删除知识',exact:true}).click();await remove.waitFor({state:'hidden'});await until(async()=>!(await snapshot()).validation.tree.nodes[team.input.moduleId+'/ui_child'],'删除已保存');checks.push('icon-edit-create-delete-and-preview-cancel');
  for(const theme of ['light','dark']){await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);await page.screenshot({path:'test-results/issue17-'+theme+'.png'})}
  await page.locator('.extension-area:not([hidden])').evaluate(node=>{Object.assign((node as HTMLElement).style,{flex:'0 0 320px',width:'320px',minWidth:'320px',maxWidth:'320px'})});await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  assert.equal(Math.round(await page.locator('.extension-area:not([hidden])').evaluate(node=>node.getBoundingClientRect().width)),320);
  const card=view().locator('.module-card').filter({has:page.getByRole('combobox',{name:'game 负责人',exact:true})});const sizes=await card.evaluate(node=>({width:node.clientWidth,scroll:node.scrollWidth}));assert.ok(sizes.scroll<=sizes.width+1,JSON.stringify(sizes));await page.screenshot({path:'test-results/issue17-narrow.png'});checks.push('theme-and-320px-panel-card-controls');
  for(const name of ['game 负责人','child 负责人'])assert.ok(await view().getByRole('combobox',{name,exact:true}).evaluate(node=>node.getBoundingClientRect().width)>=100,'窄面板负责人下拉必须可见且可操作');
  assert.ok(await view().locator('.module-canvas').evaluate(node=>node.scrollWidth<=node.clientWidth+1),'窄面板图内不能横向溢出');
  assert.deepEqual(errors,[]);assert.deepEqual(await call('loop.list',{id:entry.id}),beforeRuns);
  const report={executable,checks,pageErrors:errors,source:'packaged Electron with real IPC, one post-commit reply fault, isolated files',modelRequests:0};await fs.writeFile('test-results/issue17-ui-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}catch(error){const stem='test-results/issue17-ui-failure-'+Date.now();await fs.writeFile(stem+'.json',JSON.stringify({error:String(error),checks,errors,body:await page?.locator('body').innerText()},null,2));await page?.screenshot({path:stem+'.png'});throw error}
finally{await desktop?.close();await setup?.shutdown();const target=path.resolve(temp);if(path.dirname(target)!==path.resolve(os.tmpdir())||!path.basename(target).startsWith('cbim-issue17-'))throw Error('拒绝清理非本次测试目录');await fs.rm(target,{recursive:true,force:true})}
