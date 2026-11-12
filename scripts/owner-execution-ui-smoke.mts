import {clickKnowledgeTreeAction,clickArchitectureAction} from './knowledge-tree-actions.mjs';
import {_electron as electron,type ElectronApplication,type Page} from 'playwright-core';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {Application} from '../src/backend/main/assembly/application';
import {Paths} from '../src/backend/main/platform/paths';
import type {GraphSnapshot} from '../src/backend/core/tasks/graph-types';
import type {RunSummary} from '../src/backend/core/execution/types';
import {seedOwnerExecution,ownerExecutionData as data,ownerExecutionRecords} from '../tests/owner-execution-fixture';
import {ownerExecutionProvider} from '../tests/owner-execution-provider';
import {additionRunBytes,additionRunByteEvidence} from '../tests/queued-dependency-addition-fixture';
import {latestExecutable} from './build-artifact.mjs';

// Actual packaged main/member Pi and controls. Only provider responses and a held response window are deterministic localhost fixtures.
// --progress checks the conversation feed through real team execution and reopen; --stale remains the independent owner-change scenario.
const progress=process.argv.includes('--progress'),stale=process.argv.includes('--stale'),mode=stale?'stale':'complete',artifact=(progress?'conversation-progress-':'owner-execution-')+mode,exe=await latestExecutable();
assert.ok(!(progress&&stale),'--progress and --stale are separate scenarios');
const temp=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-owner-execution-ui-')),user=path.join(temp,'user'),project=path.join(temp,'owner-execution-project');await fs.mkdir(project);
const provider=await ownerExecutionProvider(stale?'owner-before-claim':progress?'profile-after-claim':'complete'),pageErrors:string[]=[],transportErrors:string[]=[],screenshots:string[]=[];
let setup:Application|undefined,desktop:ElectronApplication|undefined,page!:Page,keepTemp=false,report:Record<string,unknown>|undefined;
const cleanup={desktopClosed:false,providerClosed:false,tempRemoved:false};
try{
  setup=new Application(new Paths(user,path.resolve('.')),path.resolve('design'));await setup.init();
  const seeded=await seedOwnerExecution(setup,project,provider.urls);provider.bind(seeded.team.input.agentId,seeded.modules);await setup.models.select(seeded.mainOptions.profileId);await setup.shutdown();setup=undefined;
  const id=seeded.entry.id,records=()=>ownerExecutionRecords(user,id);
  const launch=async()=>{desktop=await electron.launch({executablePath:exe,env:{...process.env,CBIM_USER_DATA_ROOT:user},timeout:60000});page=await desktop.firstWindow();page.setDefaultTimeout(30000);page.on('pageerror',error=>pageErrors.push(error.message));page.on('requestfailed',request=>transportErrors.push(request.url()+': '+request.failure()?.errorText))};
  const call=<T=any,>(action:string,args:unknown={}):Promise<T>=>page.evaluate(({action,args})=>(window as any).cbim.call(action,args),{action,args});
  const until=async(check:()=>Promise<boolean>,label:string)=>{const end=Date.now()+90000;while(Date.now()<end){assert.deepEqual(provider.errors,[]);if(await check())return;await new Promise(resolve=>setTimeout(resolve,40))}throw Error('等待实际岗位执行超时：'+label)};
  const active=()=>page.locator('.workspace-panel:not([hidden])'),input=()=>active().getByRole('textbox',{name:'对话草稿',exact:true});
  const screenshot=async(label:string)=>{const file=`test-results/${artifact}-${label}.png`;await page.screenshot({path:file});screenshots.push(file)};
  const choose=async()=>{await page.getByRole('button',{name:'owner-execution-project · 运行中',exact:true}).click()};
  await fs.mkdir('test-results',{recursive:true});await launch();await choose();if(progress){await active().getByRole('combobox',{name:'协作模式',exact:true}).click();await active().getByRole('option',{name:/^团队模式/}).click()}await input().fill(data.goal);await active().getByRole('button',{name:'发送消息',exact:true}).click();await input().fill(data.draft);
  await until(async()=>provider.state.held===true,'主已按真实岗位保存计划和两个任务，尚未结束');assert.deepEqual(provider.members.map(items=>items.length),[0,0]);
  const original=provider.state.before!,scope=(await records()).scopes[0],identity={workspaceId:id,rootSessionId:scope.rootSessionId},graph=()=>call<GraphSnapshot>('dispatch.graphSnapshot',{identity});
  const taskA=original.tasks.find(task=>task.modules[0].moduleId===seeded.modules[0])!;
  const progressPanel=()=>active().getByRole('region',{name:'任务执行进展',exact:true});
  if(progress){await progressPanel().getByText(/目标计划已保存/).waitFor();assert.match(await progressPanel().textContent()||'',/已派发给/);await progressPanel().scrollIntoViewIfNeeded();await screenshot('plan-and-dispatch')}
  const detail=()=>active().locator('.member-task-detail');
  const openTask=async(taskId:string)=>{await active().getByRole('tab',{name:'任务视图',exact:true}).click();const node=active().locator(`[data-testid="dispatch-task-node"][data-task-id="${taskId}"]`);await node.waitFor();await node.click();await detail().getByTestId('owner-execution-binding').waitFor();return node};
  await openTask(taskA.taskId);const originalBinding=detail().getByTestId('owner-execution-binding');
  assert.equal(await originalBinding.getAttribute('data-member-id'),seeded.positions[0].member.memberId);assert.equal(await originalBinding.getAttribute('data-model-id'),data.models[0]);await originalBinding.scrollIntoViewIfNeeded();await screenshot('queued-owner');
  if(stale){
    const expand=page.getByRole('button',{name:'展开右侧扩展',exact:true});if(await expand.isVisible())await expand.click();const tab=page.getByRole('tab',{name:'业务架构',exact:true}),view=()=>page.locator('.extension-area:not([hidden]) .extension-content:not([hidden])');
    if(await tab.count())await tab.click();else{await page.getByRole('button',{name:'新增扩展页签',exact:true}).click();await view().getByRole('button',{name:'打开业务架构',exact:true}).click()}
    await clickKnowledgeTreeAction(view(),'.cbim/workspace','负责人记录');const panel=()=>view().getByTestId('module-ownership-panel');await panel().waitFor();
    const row=panel().locator(`[data-testid="module-ownership-row"][data-module-id="${seeded.modules[0]}"]`);await until(()=>row.isEnabled(),'责任列表加载');await row.click();
    for(const [revision,memberId] of [[2,seeded.positions[1].member.memberId],[3,seeded.positions[0].member.memberId]] as const){
      const selector=panel().getByRole('combobox',{name:'负责人岗位',exact:true});await until(()=>selector.isEnabled(),'负责人选择可用');await selector.selectOption(memberId);await panel().getByRole('textbox',{name:'负责人变更原因',exact:true}).fill('实际 UI 在原主轮结束前更换负责人；第 '+revision+' 版不能冒充原计划。');await panel().getByTestId('module-ownership-preview').click();await panel().getByTestId('module-ownership-preview-result').waitFor();await panel().getByTestId('module-ownership-commit').click();
      await until(async()=>(await panel().getByTestId('module-ownership-detail').innerText()).includes('责任第 '+revision+' 版')&&await selector.isEnabled(),'明确负责人变更已显示');
    }
    await panel().getByTestId('module-ownership-detail').scrollIntoViewIfNeeded();await screenshot('changed-owner');
    await openTask(taskA.taskId);await detail().getByTestId('owner-inspect-current').click();await until(async()=>(await detail().getByTestId('owner-current-result').getAttribute('data-comparison'))==='changed','真实核实确认原关系版本过期');await detail().getByTestId('owner-current-result').scrollIntoViewIfNeeded();await screenshot('stale-before-claim');
  }
  await active().getByRole('tab',{name:'对话',exact:true}).click();assert.equal(await input().inputValue(),data.draft);provider.releaseMain();
  if(progress){await until(async()=>provider.members.some(requests=>requests.length>0),'真实成员已启动');await until(async()=>/正在执行/.test(await progressPanel().innerText()),'对话实时显示成员执行');await progressPanel().scrollIntoViewIfNeeded();await screenshot('member-running');provider.releaseMembers()}
  await until(async()=>{const state=await records();return state.scopes[0]?.status==='closed'&&(await call('runtime.snapshot')).pressure.activeRuns===0},'目标与运行实际收束');
  const saved=await records(),finalGraph=await graph(),scopeFinal=saved.scopes[0];assert.equal(scopeFinal.outcome,stale?'failed':'completed');
  if(progress){await progressPanel().getByText('目标已完成',{exact:true}).waitFor();const text=await progressPanel().textContent()||'';assert.equal((text.match(/返回交付候选 · 尚未验收/g)||[]).length,2);assert.match(text,/证据引用/);await progressPanel().scrollIntoViewIfNeeded();await screenshot('review-and-candidates')}
  for(const [index,moduleId] of seeded.modules.entries()){
    const task=finalGraph.tasks.find(task=>task.modules[0].moduleId===moduleId)!,originalTask=original.tasks.find(item=>item.taskId===task.taskId)!;
    assert.deepEqual(task.ownerBinding,originalTask.ownerBinding);assert.deepEqual(task.assignee,originalTask.assignee);
    const node=await openTask(task.taskId);await until(async()=>(await node.getAttribute('data-status'))===task.status,'任务图最终状态已同步');
    const binding=detail().getByTestId('owner-execution-binding');assert.equal(await binding.getAttribute('data-member-id'),seeded.positions[index].member.memberId);assert.equal(await binding.getAttribute('data-model-id'),data.models[index]);
    const count=provider.httpRequests.length;await detail().getByTestId('owner-inspect-current').click();const comparison=stale&&index===0?'changed':'matching';await until(async()=>(await detail().getByTestId('owner-current-result').getAttribute('data-comparison'))===comparison,'原绑定与当前核实分别显示');assert.equal(provider.httpRequests.length,count);await binding.scrollIntoViewIfNeeded();await screenshot('settled-position-'+index);
  }
  assert.notEqual(finalGraph.tasks[0].assignee.agentInstanceId,finalGraph.tasks[1].assignee.agentInstanceId);
  if(stale){assert.equal(provider.members[0].length,0);assert.deepEqual(finalGraph.tasks.find(task=>task.taskId===taskA.taskId)!.runIds,[])}
  else{assert.deepEqual(provider.members.map(items=>items.length),[5,5]);assert.equal(saved.runs.length,2);for(const [index,moduleId] of seeded.modules.entries()){const task=finalGraph.tasks.find(task=>task.modules[0].moduleId===moduleId)!,run=saved.runs.find(run=>run.binding.taskId===task.taskId)!;assert.equal(run.model.model,data.models[index]);assert.equal(run.model.id,seeded.profiles[index+1].id);assert.deepEqual(run.prepared.memberContext?.binding,task.ownerBinding);assert.equal(run.prepared.memberContext?.adaptation.instructions,data.adaptations[index])}}
  const thread=await call<RunSummary[]>('loop.thread',{id,taskId:scope.rootSessionId}),runBytes=await additionRunBytes(user,id,scope.rootSessionId,thread,saved.runs),requests=[...provider.httpRequests];
  await active().getByRole('tab',{name:'对话',exact:true}).click();assert.equal(await input().inputValue(),data.draft);await desktop!.close();desktop=undefined;await launch();await choose();await page.locator('[aria-label="owner-execution-project 的对话"] button').filter({hasText:'OWNER_EXECUTION_MAIN:'}).first().click();assert.equal(await input().inputValue(),data.draft);
  if(progress){await progressPanel().getByText('目标已完成',{exact:true}).waitFor();await progressPanel().scrollIntoViewIfNeeded();await screenshot('progress-reopened')}
  await openTask(taskA.taskId);await detail().getByTestId('owner-inspect-current').click();await until(async()=>(await detail().getByTestId('owner-current-result').getAttribute('data-comparison'))===(stale?'changed':'matching'),'重开只读核实');await detail().getByTestId('owner-execution-binding').scrollIntoViewIfNeeded();await screenshot('restored-original-owner');
  assert.deepEqual(await records(),saved);assert.deepEqual(await graph(),finalGraph);assert.deepEqual(provider.httpRequests,requests);assert.deepEqual(await additionRunBytes(user,id,scope.rootSessionId,await call<RunSummary[]>('loop.thread',{id,taskId:scope.rootSessionId}),saved.runs),runBytes);assert.deepEqual(pageErrors,[]);assert.deepEqual(transportErrors,[]);assert.deepEqual(provider.errors,[]);
  report={packagedExe:exe,mode,conversationProgress:progress,realDesktop:true,realPi:true,onlineProvider:false,workspaceId:id,rootSessionId:scope.rootSessionId,scopeId:scope.scopeId,outcome:scopeFinal.outcome,actualUiOwnerChanges:stale?2:0,ordinaryDraftPreserved:true,sameAgentDistinctPositions:true,mainThirdModel:data.mainModel,requestCounts:{main:provider.main.length,members:provider.members.map(items=>items.length)},httpRequests:requests,ownerBindings:finalGraph.tasks.map(task=>task.ownerBinding),runBytes:additionRunByteEvidence(runBytes),restartWithoutReplay:true,canonicalAndNativeBytesUnchanged:true,pageErrors,transportErrors,providerErrors:provider.errors,screenshots,cleanup};
}catch(error){
  keepTemp=true;await fs.mkdir('test-results',{recursive:true});const dom=desktop?await desktop.firstWindow().then(p=>p.locator('body').innerText()).catch(()=>undefined):undefined;if(desktop)await desktop.firstWindow().then(p=>p.screenshot({path:`test-results/${artifact}-failure.png`})).catch(()=>{});await fs.writeFile(`test-results/${artifact}-ui-failure.json`,JSON.stringify({packagedExe:exe,temp,mode,error:String(error),dom,httpRequests:provider.httpRequests,state:provider.state,pageErrors,transportErrors,providerErrors:provider.errors},null,2));throw error;
}finally{
  provider.releaseMain();provider.releaseMembers();if(desktop)await desktop.close();cleanup.desktopClosed=true;if(setup)await setup.shutdown();await provider.close();cleanup.providerClosed=true;
  if(!keepTemp){const target=path.resolve(temp);assert.equal(path.dirname(target),path.resolve(os.tmpdir()));assert.ok(path.basename(target).startsWith('cbim-owner-execution-ui-'));assert.equal((await fs.lstat(target)).isSymbolicLink(),false);await fs.rm(target,{recursive:true,force:true});cleanup.tempRemoved=true}
  if(report){await fs.writeFile(`test-results/${artifact}-ui-smoke.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report))}
}
