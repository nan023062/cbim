import {_electron as electron,type ElectronApplication,type Page} from 'playwright-core';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {Application} from '../src/backend/main/application';
import {Paths} from '../src/backend/main/platform/paths';
import {seedTeam} from '../tests/team-fixture';
import {request,summary} from '../tests/data/knowledge';
import {latestExecutable} from './build-artifact.mjs';

const temp=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-issue18-')),root=path.join(temp,'issue18-project'),user=path.join(temp,'user');
await fs.mkdir(root);await fs.mkdir('test-results',{recursive:true});
let desktop:ElectronApplication|undefined,setup:Application|undefined,page:Page|undefined;
const checks:string[]=[],errors:string[]=[];
try{
  setup=new Application(new Paths(user,path.resolve('.')),path.resolve('design'));await setup.init();
  const entry=await setup.dispatch('add',{path:root}),workspace=setup.workspace(entry.id),team=await seedTeam(workspace);
  await workspace.commit(request(await workspace.snapshot(),[{path:'.cbim/team/design/skills.json',text:JSON.stringify({skills:[]})}]));
  const plan=await team.call('cbim_object_preview',{revision:(await workspace.snapshot()).revision,operations:[{kind:'agent',action:'create',parentId:'.cbim/team/design',slug:'designer',data:{name:'嵌套设计师',summary,capabilities:['交互设计']},body:'# 工作原则\n核对界面与项目约束。'}]});await team.call('cbim_object_commit',{planId:plan.planId},true);
  await setup.shutdown();setup=undefined;
  const executable=await latestExecutable();assert.ok(path.resolve(executable).startsWith(path.resolve('build')+path.sep));
  desktop=await electron.launch({executablePath:executable,env:{...process.env,CBIM_USER_DATA_ROOT:user},timeout:60000});
  assert.equal(path.resolve(await desktop.evaluate(({app})=>app.getPath('userData'))),path.resolve(user,'desktop'));
  page=await desktop.firstWindow();page.setDefaultTimeout(18000);page.on('pageerror',error=>errors.push(error.message));await page.setViewportSize({width:1400,height:1000});await page.waitForFunction(()=>!!(window as any).cbim);
  const call=(action:string,args:unknown={})=>page!.evaluate(({action,args})=>(window as any).cbim.call(action,args),{action,args});
  const view=()=>page!.locator('.extension-area:not([hidden]) .extension-content:not([hidden])');
  async function open(name:'业务架构'|'团队架构'){
    await page!.getByRole('button',{name:'issue18-project · 运行中',exact:true}).click();
    const expand=page!.getByRole('button',{name:'展开右侧扩展',exact:true});if(await expand.isVisible())await expand.click();const tab=page!.getByRole('tab',{name,exact:true});
    if(await tab.count())await tab.click();else{await page!.getByRole('button',{name:'新增扩展页签',exact:true}).click();await view().getByRole('button',{name:'打开'+name,exact:true}).click()}
    await view().getByRole('heading',{name:name==='业务架构'?'业务架构':'团队组织架构',exact:true}).waitFor();
  }
  const before=await call('snapshot',{id:entry.id}),runs=await call('loop.list',{id:entry.id});
  await open('业务架构');const canvas=()=>view().locator('.module-canvas'),controls=()=>canvas().getByRole('group',{name:'业务架构图视图操作',exact:true});
  await controls().waitFor();assert.equal(await controls().getByRole('button').count(),4);
  for(const button of await controls().getByRole('button').all()){assert.equal(await button.innerText(),'');assert.equal(await button.locator('svg').count(),1);assert.ok(await button.getAttribute('aria-label'))}
  assert.equal(await view().locator('.business-transfer-actions').getByRole('button',{name:'新建工程模块',exact:true}).count(),0);
  assert.equal(await view().getByRole('button',{name:'模块负责人',exact:true}).count(),0);
  const rootCard=view().getByTestId('project-root-module');await rootCard.getByRole('button',{name:'新建工程模块',exact:true}).click();await page.getByRole('dialog',{name:'新建模块',exact:true}).getByRole('button',{name:'关闭',exact:true}).click();
  await rootCard.getByRole('button',{name:'查看负责人记录',exact:true}).click();await view().getByTestId('module-ownership-panel').waitFor();await view().getByRole('button',{name:'返回架构',exact:true}).click();checks.push('top-duplicates-removed-root-icons-and-four-in-graph-controls');
  const child=()=>view().getByRole('combobox',{name:'child 负责人',exact:true});await child().waitFor();
  await controls().getByRole('button',{name:'全部折叠',exact:true}).focus();await page.keyboard.press('Enter');assert.equal(await child().count(),0);
  await controls().getByRole('button',{name:'全部展开',exact:true}).click();await child().waitFor();
  await controls().getByRole('button',{name:'放大知识图文字',exact:true}).click();assert.equal(await canvas().evaluate(node=>getComputedStyle(node).fontSize),'15px');
  for(let i=0;i<5;i++)await controls().getByRole('button',{name:'放大知识图文字',exact:true}).click();assert.ok(await controls().getByRole('button',{name:'放大知识图文字',exact:true}).isDisabled());
  for(let i=0;i<8;i++)await controls().getByRole('button',{name:'缩小知识图文字',exact:true}).click();assert.ok(await controls().getByRole('button',{name:'缩小知识图文字',exact:true}).isDisabled());
  await controls().getByRole('button',{name:'放大知识图文字',exact:true}).click();await controls().getByRole('button',{name:'放大知识图文字',exact:true}).click();
  assert.ok((await view().getByRole('combobox',{name:'game 负责人',exact:true}).locator('option').allTextContents()).includes('CBIM 默认执行 Agent'));checks.push('business-collapse-keyboard-zoom-bounds-and-builtin-owner-option');
  await page.screenshot({path:'test-results/issue18-business-light.png'});
  await open('团队架构');const tree=()=>view().locator('.team-definition-tree'),nodes=()=>tree().getByTestId('team-static-node');await nodes().first().waitFor();
  assert.equal(await tree().locator('[data-agent-id="cbim:main"],[data-agent-id="cbim:executor"]').count(),0);
  const node=(text:string)=>nodes().filter({hasText:text});await node('嵌套设计师').waitFor();
  const rect=async(text:string)=>node(text).evaluate(element=>({x:element.getBoundingClientRect().x,align:getComputedStyle(element).justifyContent,text:getComputedStyle(element).textAlign}));
  const rootRect=await rect('Team 根'),groupRect=await rect('design'),nestedRect=await rect('嵌套设计师'),devRect=await rect('开发者');assert.ok(rootRect.x<groupRect.x&&groupRect.x<nestedRect.x);assert.equal(groupRect.x,devRect.x);
  for(const value of [rootRect,groupRect,nestedRect,devRect]){assert.equal(value.align,'flex-start');assert.equal(value.text,'left')}
  const treeControls=()=>tree().getByRole('group',{name:'团队组织图视图操作',exact:true});await treeControls().getByRole('button',{name:'全部折叠',exact:true}).click();assert.equal(await nodes().count(),1);await treeControls().getByRole('button',{name:'全部展开',exact:true}).click();await node('嵌套设计师').waitFor();
  await treeControls().getByRole('button',{name:'放大组织架构文字',exact:true}).click();assert.equal(await tree().evaluate(element=>getComputedStyle(element).fontSize),'15px');
  const search=view().getByRole('textbox',{name:'搜索团队成员或 Skill',exact:true});await search.fill('嵌套设计师');assert.equal(await node('开发者').count(),0);assert.equal(await node('design').count(),1);await search.fill('cbim:executor');await tree().getByText('没有匹配的团队成员或 Skill。',{exact:true}).waitFor();await search.fill('');
  await node('嵌套设计师').click();assert.match(await view().locator('.team-skill-list').innerText(),/review[\s\S]*继承/);checks.push('custom-only-left-aligned-tree-search-collapse-and-inherited-skill');
  await view().getByTestId('team-workspace-members').click();await view().getByTestId('workspace-member-register').click();assert.ok((await view().getByRole('combobox',{name:'静态 Agent',exact:true}).locator('option').allTextContents()).includes('CBIM 默认执行 Agent'));await view().getByRole('button',{name:'取消编辑',exact:true}).click();await view().getByRole('button',{name:'返回团队定义',exact:true}).click();checks.push('hidden-builtin-remains-available-for-real-position-registration');
  for(const theme of ['light','dark']){await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);await page.screenshot({path:'test-results/issue18-team-'+theme+'.png'})}
  await page.locator('.extension-area:not([hidden])').evaluate(node=>Object.assign((node as HTMLElement).style,{flex:'0 0 320px',width:'320px',minWidth:'320px',maxWidth:'320px'}));
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));assert.equal(Math.round(await page.locator('.extension-area:not([hidden])').evaluate(node=>node.getBoundingClientRect().width)),320);
  assert.ok(await tree().evaluate(node=>node.scrollWidth<=node.clientWidth+1));await page.screenshot({path:'test-results/issue18-team-narrow.png'});
  await open('业务架构');await controls().waitFor();assert.ok(await canvas().evaluate(node=>node.scrollWidth<=node.clientWidth+1));for(const name of ['game 负责人','child 负责人'])assert.ok(await view().getByRole('combobox',{name,exact:true}).evaluate(node=>node.getBoundingClientRect().width)>=100);
  const positions=await controls().evaluate(node=>{const control=node.getBoundingClientRect(),graph=node.closest('.module-canvas')!.getBoundingClientRect();return {right:graph.right-control.right,top:control.top-graph.top}});assert.ok(positions.right>=0&&positions.right<=16&&positions.top>=0&&positions.top<80,JSON.stringify(positions));await page.screenshot({path:'test-results/issue18-business-narrow.png'});checks.push('320px-controls-stay-top-right-and-content-does-not-overflow');
  await page.reload();await open('团队架构');await node('嵌套设计师').waitFor();assert.equal(await tree().locator('[data-agent-id="cbim:main"],[data-agent-id="cbim:executor"]').count(),0);
  assert.equal((await call('snapshot',{id:entry.id})).revision,before.revision);assert.deepEqual(await call('loop.list',{id:entry.id}),runs);assert.deepEqual(errors,[]);checks.push('reload-keeps-project-tree-without-knowledge-or-execution-write');
  const report={executable,checks,pageErrors:errors,source:'real packaged Electron, IPC, isolated nested project definitions',modelRequests:0};await fs.writeFile('test-results/issue18-ui-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}catch(error){const stem='test-results/issue18-ui-failure-'+Date.now();await fs.writeFile(stem+'.json',JSON.stringify({error:String(error),checks,errors,body:await page?.locator('body').innerText()},null,2));await page?.screenshot({path:stem+'.png'});throw error}
finally{await desktop?.close();await setup?.shutdown();const target=path.resolve(temp);if(path.dirname(target)!==path.resolve(os.tmpdir())||!path.basename(target).startsWith('cbim-issue18-'))throw Error('拒绝清理非本次测试目录');await fs.rm(target,{recursive:true,force:true})}
