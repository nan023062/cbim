import {clickKnowledgeTreeAction,clickArchitectureAction} from './knowledge-tree-actions.mjs';
import {_electron as electron,type ElectronApplication,type Locator,type Page} from 'playwright-core';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {Snapshot} from '../src/bridge/contracts/workspace';
import type {ResourceLibrarySnapshot,WorkspacePackage} from '../src/bridge/contracts/resources';
import {latestExecutable} from './build-artifact.mjs';
import {desktopDispatchFixture,pollDesktop} from './desktop-dispatch-fixture.mjs';

// Exercise the packaged UI, not a browser mock: only setup/observations use IPC.
// Two real main runs establish scoped queued tasks through a deterministic localhost provider.
// The provider holds those main turns; static editing/import/export must not execute members or change runtime facts.
const temp=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-architecture-ui-'));
const source=path.join(temp,'source-project'),target=path.join(temp,'target-project'),repository=path.join(temp,'repository'),user=path.join(temp,'user');
await Promise.all([source,target,repository,user].map(folder=>fs.mkdir(folder)));
await Promise.all([source,target].map(folder=>fs.mkdir(path.join(folder,'business-src'))));
await fs.writeFile(path.join(source,'business-src/index.ts'),'export const sourceBusiness = "UNCHANGED_SOURCE";');
await fs.writeFile(path.join(target,'business-src/index.ts'),'export const targetBusiness = "UNCHANGED_TARGET";');
await fs.mkdir('test-results',{recursive:true});
const summary='管理团队客户端资源加载、卸载与缓存，提供加载器和实例生命周期接口。包含异步请求取消、对象池复用、回调有效性检查与过期资源清理，支持定位加载失败、实例释放和重复请求问题。底层资源传输由相关系统提供，本模块负责运行期调用与生命周期管理。';
const moduleBody='# 游戏工程\n\n## 定位\n实现当前项目的游戏业务。\n\n## 子模块和 source 节点\n业务源码位于 business-src，模块维护人负责日常修复。\n\n## 结构关系图与抽象设计决策\n```mermaid\nclassDiagram\nclass Game\nclass CbimDirectContent["直属内容（虚拟子模块）"]\n<<virtual>> CbimDirectContent\nGame --> CbimDirectContent\n```\n以单一模块保持明确责任。\n\n## 雷区与排障\n实现后验证实际产物。\n\n## 观察模式-待抽象\n当前未发现需要抽象的重复模式。\n';
const resourceNames={team:'UI 整体团队',agent:'UI 独立成员',skill:'UI 共享能力',architecture:'UI 完整业务架构'};
const pageErrors:string[]=[],unexpectedDialogs:string[]=[];
let desktop:ElectronApplication|undefined,page:Page|undefined,step='启动打包程序';
let fixture:Awaited<ReturnType<typeof desktopDispatchFixture>>|undefined;
const startedAt=new Date().toISOString();
const completed:string[]=[];
function checkpoint(value:string){step=value;console.log('ARCHITECTURE_UI '+value)}
async function poll<T>(read:()=>Promise<T>,accept:(value:T)=>boolean,label:string){
  const deadline=Date.now()+25000;let value=await read();
  while(!accept(value)&&Date.now()<deadline){await new Promise(resolve=>setTimeout(resolve,80));value=await read()}
  assert.ok(accept(value),label);return value;
}

try{
  const exe=await latestExecutable();
  desktop=await electron.launch({executablePath:exe,env:{...process.env,CBIM_USER_DATA_ROOT:user},timeout:60000});
  assert.equal(await desktop.evaluate(({app})=>app.isPackaged),true);
  assert.equal(path.resolve(await desktop.evaluate(({app})=>app.getPath('exe'))),path.resolve(exe));
  assert.equal(path.resolve(await desktop.evaluate(({app})=>app.getPath('userData'))),path.resolve(user,'desktop'));
  page=await desktop.firstWindow();page.setDefaultTimeout(25000);
  await page.setViewportSize({width:1500,height:1000});
  page.on('pageerror',error=>pageErrors.push(error.message));
  page.on('dialog',async dialog=>{if(dialog.type()==='confirm'&&dialog.message()==='放弃尚未提交的修改？')await dialog.accept();else{unexpectedDialogs.push(dialog.message());await dialog.dismiss()}});
  await page.waitForFunction(()=>!!(window as any).cbim);
  const call=<T=any>(action:string,args:unknown={}):Promise<T>=>page!.evaluate(({action,args})=>(window as any).cbim.call(action,args),{action,args});
  const sourceEntry=await call('add',{path:source}),targetEntry=await call('add',{path:target});
  await call('resources.configure',{mode:'local',location:repository});
  const snapshot=(id:string)=>call<Snapshot>('snapshot',{id});
  const currentView=()=>page!.locator('.extension-area:not([hidden]) .extension-content:not([hidden])');
  // 0.1.7 起使用知识文件树；按真实对象路径定位，文件按钮与同名对象不能混为一项。
  const knowledgePath=(objectPath:string)=>currentView().locator(`[data-knowledge-path="${objectPath}"]`);
  async function selectWorkspace(name:string){await page!.getByRole('button',{name:name+' · 运行中',exact:true}).click()}
  async function extension(name:'团队架构'|'业务架构'){
    const open=page!.getByRole('button',{name:'展开右侧扩展',exact:true});if(await open.isVisible())await open.click();
    const tab=page!.getByRole('tab',{name,exact:true});
    if(await tab.count())await tab.click();
    else{await page!.getByRole('button',{name:'新增扩展页签',exact:true}).click();await currentView().getByRole('button',{name:'打开'+name,exact:true}).click()}
    await currentView().getByRole('heading',{name:name==='团队架构'?'团队组织架构':'业务架构',exact:true}).waitFor();
  }
  const editor=(name:string)=>page!.getByRole('dialog',{name,exact:true});
  async function preview(dialog:Locator){
    await dialog.getByRole('button',{name:'校验并预览',exact:true}).click();
    await dialog.getByRole('region',{name:'知识变更预览',exact:true}).waitFor();
    assert.ok(await dialog.getByRole('button',{name:'确认提交到工作区',exact:true}).isEnabled(),await dialog.innerText());
  }
  async function save(dialog:Locator){await preview(dialog);await dialog.getByRole('button',{name:'确认提交到工作区',exact:true}).click();await dialog.waitFor({state:'hidden'})}
  async function createAgent(slug:string,name:string,commit=true){
    await clickArchitectureAction(currentView(),'新建 Agent');const dialog=editor('新建Agent');
    await dialog.getByRole('textbox',{name:'目录标识',exact:true}).fill(slug);
    await dialog.getByRole('textbox',{name:'对象名称',exact:true}).fill(name);
    await dialog.getByRole('textbox',{name:'职责摘要',exact:true}).fill(summary);
    await dialog.getByRole('textbox',{name:'专业能力',exact:true}).fill('实现业务需求\n核实成果');
    await dialog.getByRole('textbox',{name:'能力限制',exact:true}).fill('尊重模块责任与本次授权');
    await dialog.getByRole('textbox',{name:'知识正文',exact:true}).fill('# 工作原则\n按实际目标实现，记录验证证据，不将执行结束视为业务验收。');
    if(commit){await save(dialog);await knowledgePath('.cbim/team/'+slug).waitFor()}
    else{await preview(dialog);await dialog.getByRole('button',{name:'关闭',exact:true}).click();await dialog.waitFor({state:'hidden'})}
  }
  async function teamRoot(){await knowledgePath('.cbim/team').click()}
  async function publish(trigger:string,name:string){
    await clickArchitectureAction(currentView(),trigger);const dialog=editor('发布静态资源');
    await dialog.getByRole('textbox',{name:'发布资源名称',exact:true}).fill(name);
    await dialog.getByRole('textbox',{name:'发布资源说明',exact:true}).fill('真实打包界面的静态定义跨项目复用验证。');
    await dialog.getByRole('button',{name:'确认发布到当前仓库',exact:true}).click();
    await dialog.getByRole('heading',{name:'静态定义已发布到当前仓库。',exact:true}).waitFor();
    assert.ok((await dialog.innerText()).includes('只改变静态定义，不启动成员或任务。'));
    await dialog.getByRole('button',{name:'完成',exact:true}).click();await dialog.waitFor({state:'hidden'});
  }
  async function importResource(trigger:string,name:string,slug?:string,commit=true){
    await clickArchitectureAction(currentView(),trigger);const dialog=editor('使用仓库资源');
    await dialog.getByRole('list',{name:'可用静态资源',exact:true}).getByRole('button').filter({hasText:name}).click();
    if(slug)await dialog.getByRole('textbox',{name:'资源目录标识',exact:true}).fill(slug);
    await dialog.getByRole('button',{name:'预览应用到工作区',exact:true}).click();
    await dialog.getByRole('region',{name:'资源应用预览',exact:true}).waitFor();
    assert.ok(await dialog.getByRole('button',{name:'确认应用到此工作区',exact:true}).isEnabled(),await dialog.innerText());
    if(commit){await dialog.getByRole('button',{name:'确认应用到此工作区',exact:true}).click();await dialog.getByRole('heading',{name:'资源包已应用到此工作区。',exact:true}).waitFor();await dialog.getByRole('button',{name:'完成',exact:true}).click();await dialog.waitFor({state:'hidden'})}
    else{await dialog.getByRole('button',{name:'关闭',exact:true}).click();await dialog.waitFor({state:'hidden'})}
  }

  checkpoint('通过团队表单验证预览取消、新建成员与共享 Skill');
  await selectWorkspace('source-project');await extension('团队架构');
  const initial=(await snapshot(sourceEntry.id)).revision;
  await createAgent('cancelled_agent','取消的成员',false);
  assert.equal((await snapshot(sourceEntry.id)).revision,initial);
  await createAgent('developer','架构测试开发者');
  await poll(()=>snapshot(sourceEntry.id),s=>s.files.some(file=>file.path==='.cbim/team/developer/agent.json'),'UI 新建 Agent 没有落盘');
  await teamRoot();await clickArchitectureAction(currentView(),'新增 Skill');
  const skill=editor('新建Skill');await skill.getByRole('textbox',{name:'目录标识',exact:true}).fill('shared_review');
  await skill.getByRole('textbox',{name:'对象名称',exact:true}).fill('架构审阅能力');
  await skill.getByRole('textbox',{name:'适用目的',exact:true}).fill('审查职责、依赖与真实证据');
  await skill.getByRole('textbox',{name:'知识正文',exact:true}).fill('# 静态审阅方法\n核实职责边界、单向依赖及成果证据。');await save(skill);
  await knowledgePath('.cbim/team/developer').click();
  await currentView().locator('.team-skill-list').getByText('架构审阅能力',{exact:true}).waitFor();
  assert.ok((await currentView().locator('.team-skill-list').innerText()).includes('继承'));
  await page.screenshot({path:'test-results/architecture-team-created.png'});
  await page.setViewportSize({width:1100,height:1000});
  const teamBounds=await currentView().locator('.team-management').boundingBox(),detailBounds=await currentView().locator('.team-definition-detail').boundingBox();
  assert.ok(teamBounds&&teamBounds.width>=300,'窄扩展区中的团队容器宽度发生坍缩');
  assert.ok(detailBounds&&detailBounds.width>=180,'窄扩展区中的团队详情被压为单字列');
  await currentView().evaluate(element=>{element.scrollTop=0});
  await page.screenshot({path:'test-results/architecture-team-narrow-dark.png'});
  await page.getByRole('button',{name:'切换浅色模式',exact:true}).click();await page.screenshot({path:'test-results/architecture-team-narrow-light.png'});
  await page.getByRole('button',{name:'切换深色模式',exact:true}).click();await page.setViewportSize({width:1500,height:1000});
  completed.push('团队 UI 新建 Agent、根共享 Skill 和继承；取消预览不写入');

  checkpoint('通过业务表单创建静态模块和 Workflow');
  await extension('业务架构');await clickArchitectureAction(currentView(),'新建工程模块');
  const module=editor('新建模块');await module.getByRole('textbox',{name:'目录标识',exact:true}).fill('game');
  await module.getByRole('textbox',{name:'职责摘要',exact:true}).fill(summary);
  await module.getByRole('button',{name:'添加源目录',exact:true}).click();
  await module.getByRole('textbox',{name:'源目录 1',exact:true}).fill('business-src');
  await module.getByRole('textbox',{name:'目录职责 1',exact:true}).fill('游戏业务源码与验证入口');
  assert.equal(await module.getByRole('textbox',{name:'维护人 ID',exact:true}).count(),0);
  assert.equal(await module.getByRole('checkbox',{name:'确认维护责任',exact:true}).count(),0);
  await module.getByRole('textbox',{name:'知识正文',exact:true}).fill(moduleBody);
  await preview(module);await page.screenshot({path:'test-results/architecture-module-preview.png'});
  assert.ok(!(await snapshot(sourceEntry.id)).files.some(file=>file.path==='.cbim/workspace/game/module.json'));
  await module.getByRole('button',{name:'确认提交到工作区',exact:true}).click();await module.waitFor({state:'hidden'});
  await knowledgePath('.cbim/workspace/game').click();
  await clickArchitectureAction(currentView(),'新建 Workflow');const workflow=editor('新建Workflow');
  await workflow.getByRole('textbox',{name:'目录标识',exact:true}).fill('implement');await workflow.getByRole('textbox',{name:'对象名称',exact:true}).fill('实现与验证');
  await workflow.getByRole('textbox',{name:'知识正文',exact:true}).fill('# 实现与验证\n实现业务目标，运行针对性验证，留下可审阅证据。');await save(workflow);
  await currentView().getByText('实现与验证',{exact:true}).waitFor();
  const beforeEdit=(await snapshot(sourceEntry.id)).revision;
  await currentView().getByRole('button',{name:'编辑 Workflow',exact:true}).click();const editFlow=editor('编辑Workflow');
  await editFlow.getByRole('textbox',{name:'对象名称',exact:true}).fill('未提交的流程名称');await preview(editFlow);
  await editFlow.getByRole('button',{name:'关闭',exact:true}).click();await editFlow.waitFor({state:'hidden'});
  assert.equal((await snapshot(sourceEntry.id)).revision,beforeEdit);
  await page.screenshot({path:'test-results/architecture-business-created.png'});
  completed.push('业务 UI 新建静态模块和 Workflow；岗位责任独立登记；编辑预览取消保留原知识');

  checkpoint('设置项目绑定与两张独立运行图，作为导出隔离对照');
  const beforeBindings=await snapshot(sourceEntry.id),agentDefinition=JSON.parse(beforeBindings.files.find(file=>file.path==='.cbim/team/developer/agent.json')!.text),moduleDefinition=JSON.parse(beforeBindings.files.find(file=>file.path==='.cbim/workspace/game/module.json')!.text);
  for(const definition of [agentDefinition,moduleDefinition]){definition.authors=['source_owner'];definition.connectors=['.cbim/connectors/source_tool']}
  const request={workspaceId:sourceEntry.id,instanceId:beforeBindings.instanceId,revision:beforeBindings.revision,requestId:randomUUID(),changes:[{path:'.cbim/team/developer/agent.json',text:JSON.stringify(agentDefinition)},{path:'.cbim/workspace/game/module.json',text:JSON.stringify(moduleDefinition)},{path:'.cbim/connectors/registry.json',text:JSON.stringify({connectors:[{id:'.cbim/connectors/source_tool',name:'源项目工具',summary:'仅用于测试绑定移除',plugin:{ghost_id:'source-only-fixture',namespace:null}}]})}]};
  assert.equal((await call('preview',request)).validation.structural,true);await call('commit',request);
  fixture=await desktopDispatchFixture(call);
  const owner=await fixture.register(sourceEntry.id,'.cbim/team/developer',['.cbim/workspace/game']);
  const sourceBaseline=await snapshot(sourceEntry.id);
  assert.equal(JSON.parse(sourceBaseline.files.find(file=>file.path==='.cbim/workspace/game/module.json')!.text).maintenance,undefined);
  const sourceOwner=await call('workspace.ownerships.get',{workspaceId:sourceEntry.id,instanceId:sourceBaseline.instanceId,moduleId:'.cbim/workspace/game'});
  assert.equal(sourceOwner.view.binding.ownerMemberId,owner.memberId);
  const planned=[];
  for(let index=0;index<2;index++){
    const plan=await fixture.plan(owner,'DO_NOT_EXPORT_RUNTIME_'+index);planned.push(plan);
    const sent=await call('dispatch.task',{...plan.identity,scopeId:plan.scopeId,commandId:'assign-'+index,expectedParentRevision:1,task:{assigneeAgentId:owner.agentId,moduleIds:owner.moduleIds,ownerSelection:plan.ownerSelection,goal:'DO_NOT_EXPORT_RUNTIME_'+index,acceptance:[{id:'verify',text:'仅创建待办，不启动成员执行'}]}});
    assert.equal(sent.disposition,'queued');
  }
  const graphIdentities=planned.map(plan=>plan.identity);
  const graphs=await Promise.all(graphIdentities.map(identity=>call('dispatch.graphSnapshot',{identity})));
  assert.ok(graphs.every(graph=>graph.tasks.length===1&&graph.tasks[0].status==='queued'&&graph.tasks[0].runIds.length===0));
  const providerBefore=fixture.evidence();assert.equal(providerBefore.modelCalls,6);
  const runtimeBefore=await call('runtime.snapshot');
  await page.reload();await selectWorkspace('source-project');await extension('团队架构');

  checkpoint('通过团队/业务界面发布四类静态资源');
  await teamRoot();await publish('发布整个团队',resourceNames.team);
  await knowledgePath('.cbim/team/developer').click();await publish('发布 Agent 到人才市场',resourceNames.agent);
  await teamRoot();await currentView().locator('.team-skill-list').getByRole('button').filter({hasText:'架构审阅能力'}).click();await publish('发布 Skill 到人才市场',resourceNames.skill);
  await extension('业务架构');await publish('发布架构',resourceNames.architecture);
  const library=await call<ResourceLibrarySnapshot>('resources.list');assert.equal(library.items.length,4);
  const packs=library.items.map(item=>JSON.parse(item.content) as WorkspacePackage);
  for(const pack of packs){
    assert.equal(pack.format,'cbim-workspace-package');assert.ok(!JSON.stringify(pack).includes('DO_NOT_EXPORT_RUNTIME_'));
    assert.ok(!JSON.stringify(pack).includes(sourceEntry.id));assert.ok(!JSON.stringify(pack).includes('source_owner'));
    for(const value of [owner.memberId,sourceOwner.view.binding.bindingId,...planned.flatMap(plan=>[plan.scopeId,plan.run.runId,plan.run.taskId])])assert.ok(!JSON.stringify(pack).includes(value),'静态包泄露运行或岗位身份：'+value);
    for(const file of pack.files){
      assert.ok(!/(^|\/)(people\.json|registry\.json|sessions?|logs|tasks|dispatch|credentials)(\/|$)/i.test(file.path),file.path);
      if(file.path.endsWith('/agent.json')||file.path.endsWith('/module.json')){const definition=JSON.parse(file.text);assert.deepEqual(definition.authors,[]);assert.deepEqual(definition.connectors,[]);assert.equal(definition.maintenance,undefined);if(file.path.endsWith('/module.json'))assert.deepEqual(definition.sources,[])}
    }
  }
  assert.equal((await snapshot(sourceEntry.id)).revision,sourceBaseline.revision);
  completed.push('UI 发布 team/agent/skill/architecture；剥离人员、源码、连接器、维护和运行绑定；源知识不变');

  checkpoint('通过目标项目团队界面导入 Team、Agent 和 Skill');
  await selectWorkspace('target-project');await extension('团队架构');
  await createAgent('skill_receiver','独立技能接收者');await teamRoot();
  const beforeImport=(await snapshot(targetEntry.id)).revision;
  await importResource('从人才市场下载',resourceNames.team,'cancelled_team',false);
  assert.equal((await snapshot(targetEntry.id)).revision,beforeImport);
  await importResource('从人才市场下载',resourceNames.team,'copied_team');
  await poll(()=>snapshot(targetEntry.id),s=>s.files.some(file=>file.path==='.cbim/team/copied_team/developer/agent.json'),'完整团队没有导入目标项目');
  await knowledgePath('.cbim/team/copied_team').waitFor();
  await teamRoot();await importResource('从人才市场下载',resourceNames.agent,'copied_developer');
  await knowledgePath('.cbim/team/copied_developer').waitFor();await knowledgePath('.cbim/team/copied_team/developer').waitFor();
  await knowledgePath('.cbim/team/skill_receiver').click();
  await importResource('从人才市场下载',resourceNames.skill,'imported_review');
  await currentView().locator('.team-skill-list').getByText('架构审阅能力',{exact:true}).waitFor();
  await page.screenshot({path:'test-results/architecture-team-imported.png'});
  const teamSnapshot=await snapshot(targetEntry.id);
  assert.equal(JSON.parse(teamSnapshot.files.find(file=>file.path==='.cbim/team/copied_developer/agent.json')!.text).skills.length,1);
  assert.ok(teamSnapshot.files.some(file=>file.path==='.cbim/team/copied_team/skills/shared_review/SKILL.md'));
  assert.ok(teamSnapshot.files.some(file=>file.path==='.cbim/team/skill_receiver/skills/imported_review/SKILL.md'));
  completed.push('UI 下载完整团队为子组、独立 Agent 和 Skill；预览取消不写入');

  checkpoint('通过目标项目业务界面应用完整架构并核实重新绑定要求');
  await extension('业务架构');const targetBeforeArchitecture=(await snapshot(targetEntry.id)).revision;
  await importResource('使用模板',resourceNames.architecture,undefined,false);
  assert.equal((await snapshot(targetEntry.id)).revision,targetBeforeArchitecture);
  await importResource('使用模板',resourceNames.architecture);
  const imported=await poll(()=>snapshot(targetEntry.id),s=>s.files.some(file=>file.path==='.cbim/workspace/game/module.json'),'完整业务架构没有导入目标项目');
  const importedModule=JSON.parse(imported.files.find(file=>file.path==='.cbim/workspace/game/module.json')!.text);
  assert.equal(importedModule.maintenance,undefined);assert.deepEqual(importedModule.sources,[]);assert.deepEqual(importedModule.connectors,[]);assert.deepEqual(importedModule.authors,[]);
  assert.equal(importedModule.workflows[0].name,'实现与验证');
  const people=imported.files.find(file=>file.path==='.cbim/team/people.json');
  assert.deepEqual(people?JSON.parse(people.text).people:[],[]);
  const targetIdentity={workspaceId:targetEntry.id,instanceId:imported.instanceId};
  const targetOwner=await call('workspace.ownerships.get',{...targetIdentity,moduleId:'.cbim/workspace/game'});
  assert.equal(targetOwner.view.status,'unassigned');assert.ok(!targetOwner.view.binding?.ownerMemberId);
  assert.deepEqual((await call('workspace.members.list',targetIdentity)).items,[]);
  await knowledgePath('.cbim/workspace/game').click();
  const ownerSelect=currentView().getByRole('combobox',{name:'game 负责人',exact:true});
  await poll(()=>ownerSelect.isEnabled(),Boolean,'导入模块负责人未完成读取');
  assert.equal(await ownerSelect.inputValue(),'');
  // 0.1.7 未显式绑定时先解析父级/匹配岗位，再回退主 Agent；静态导入不建立负责人记录。
  assert.equal(await ownerSelect.locator('option:checked').innerText(),'自动解析（未显式设置）');
  await page.screenshot({path:'test-results/architecture-business-imported.png'});
  await page.getByRole('button',{name:'切换浅色模式',exact:true}).click();await page.screenshot({path:'test-results/architecture-business-light.png'});
  await page.getByRole('button',{name:'切换深色模式',exact:true}).click();

  checkpoint('从全局人才市场选择目标工作区并应用静态 Agent');
  await page.getByRole('button',{name:'人才市场',exact:true}).click();
  await page.locator('.definition-card').filter({hasText:resourceNames.agent}).getByRole('button',{name:'应用到工作区',exact:true}).click();
  const targetDialog=editor('选择应用目标工作区');
  await targetDialog.getByRole('combobox',{name:'应用目标工作区',exact:true}).selectOption(targetEntry.id);
  await page.screenshot({path:'test-results/architecture-global-target.png'});
  await targetDialog.getByRole('button',{name:'继续并预览',exact:true}).click();
  const globalImport=editor('使用仓库资源');
  await globalImport.getByRole('textbox',{name:'资源目录标识',exact:true}).fill('global_developer');
  await globalImport.getByRole('button',{name:'预览应用到工作区',exact:true}).click();
  await globalImport.getByRole('region',{name:'资源应用预览',exact:true}).waitFor();
  assert.ok(await globalImport.getByRole('button',{name:'确认应用到此工作区',exact:true}).isEnabled(),await globalImport.innerText());
  await globalImport.getByRole('button',{name:'确认应用到此工作区',exact:true}).click();
  await globalImport.getByRole('heading',{name:'资源包已应用到此工作区。',exact:true}).waitFor();
  await globalImport.getByRole('button',{name:'完成',exact:true}).click();
  const globalTarget=await snapshot(targetEntry.id);assert.ok(globalTarget.files.some(file=>file.path==='.cbim/team/global_developer/agent.json'));
  assert.ok(!(await snapshot(sourceEntry.id)).files.some(file=>file.path==='.cbim/team/global_developer/agent.json'));
  completed.push('全局人才市场选择目标项目、预览并应用；只写选中的工作区');

  assert.equal(await fs.readFile(path.join(source,'business-src/index.ts'),'utf8'),'export const sourceBusiness = "UNCHANGED_SOURCE";');
  assert.equal(await fs.readFile(path.join(target,'business-src/index.ts'),'utf8'),'export const targetBusiness = "UNCHANGED_TARGET";');
  const afterGraphs=await Promise.all(graphIdentities.map(identity=>call('dispatch.graphSnapshot',{identity})));assert.deepEqual(afterGraphs,graphs);
  const runtime=await call('runtime.snapshot');
  assert.equal(runtime.members.filter((item:any)=>item.workspaceId===targetEntry.id).length,0);
  assert.equal(runtime.tasks.filter((item:any)=>item.workspaceId===targetEntry.id).length,0);
  assert.equal(runtime.runs.filter((item:any)=>item.workspaceId===targetEntry.id).length,0);
  assert.deepEqual(runtime.runs.map((item:any)=>item.runId).sort(),planned.map(plan=>plan.run.runId).sort());
  assert.deepEqual(runtime.pressure,runtimeBefore.pressure);assert.deepEqual(runtime.tasks,runtimeBefore.tasks);
  assert.deepEqual(fixture.evidence(),providerBefore);assert.deepEqual(await call('loop.list',{id:targetEntry.id}),[]);
  assert.deepEqual((await call('workspace.ownerships.get',{workspaceId:sourceEntry.id,instanceId:sourceBaseline.instanceId,moduleId:'.cbim/workspace/game'})).view.binding,sourceOwner.view.binding);
  assert.deepEqual(pageErrors,[]);assert.deepEqual(unexpectedDialogs,[]);
  completed.push('完整业务架构应用后无旧项目绑定；两个源会话图不变；目标没有动态成员/任务/运行');
  for(const plan of planned)await call('loop.stop',{id:sourceEntry.id,taskId:plan.run.taskId});
  await pollDesktop(()=>call('runtime.snapshot'),value=>value.pressure.activeRuns===0,'清理本地测试主运行');
  assert.deepEqual(fixture.evidence(),providerBefore);
  const evidence={passed:true,startedAt,completedAt:new Date().toISOString(),packagedExe:exe,temporaryFixture:temp,realDesktop:true,...providerBefore,sourceWorkspaceId:sourceEntry.id,targetWorkspaceId:targetEntry.id,resourceKinds:packs.map(pack=>pack.kind),completed,pageErrors,unexpectedDialogs};
  await fs.writeFile('test-results/architecture-ui-smoke.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));
}catch(error){
  await page?.screenshot({path:'test-results/architecture-ui-failed.png'}).catch(()=>{});
  await fs.writeFile('test-results/architecture-ui-smoke.json',JSON.stringify({success:false,step,completed,temporaryFixture:temp,error:String(error),pageErrors,unexpectedDialogs},null,2));throw error;
}finally{try{await desktop?.close()}finally{await fixture?.close()}}
