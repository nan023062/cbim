import {_electron as electron,type ElectronApplication} from 'playwright-core';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {Application} from '../src/backend/main/application';
import {Paths} from '../src/backend/main/platform/paths';
import {modelRequestBudgetProvider} from '../tests/model-request-budget-provider';
import {scopeBudgetProvider,scopeBudgetFixture} from '../tests/scope-budget-provider';
import {seedScopeBudget,budgetScopes} from '../tests/scope-budget-fixture';
import {requestBudgetReportSchema} from '../src/backend/core/tasks/model-request-budget';
import {latestExecutable} from './build-artifact.mjs';

const mode=process.argv.includes('--block')?'block':process.argv.includes('--unknown')?'unknown':'complete',name='request-budget-'+mode,exe=await latestExecutable();
const temp=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-request-budget-ui-')),project=path.join(temp,'project'),user=path.join(temp,'user');await fs.mkdir(project);
const simple=mode==='complete'?undefined:await modelRequestBudgetProvider('openai-completions',mode==='block'?'two-requests':'unknown'),shared=mode==='complete'?await scopeBudgetProvider('complete'):undefined;
let setup:Application|undefined,desktop:ElectronApplication|undefined,keep=false;const pageErrors:string[]=[];
try{
  setup=new Application(new Paths(user,path.resolve('.')),path.resolve('design'));await setup.init();let entry:{id:string};
  if(shared)entry=(await seedScopeBudget(setup,project,shared,'complete')).entry;
  else{
    await setup.models.save({profile:{name:'Request budget UI',api:'openai-completions',baseUrl:simple!.url,auth:'none',defaultModel:'request-budget-model',models:[{id:'request-budget-model',name:'Request budget UI',enabled:true,contextWindow:65536,maxTokens:4096,reasoning:false,pricing:{input:1,output:2,cacheRead:0.5,cacheWrite:1.5}}]}});
    entry=await setup.dispatch('add',{path:project});
  }
  await setup.shutdown();setup=undefined;
  const until=async(check:()=>Promise<boolean>,label:string)=>{const end=Date.now()+45000;while(Date.now()<end){if(await check())return;await new Promise(r=>setTimeout(r,40))}throw Error('验收超时：'+label)};
  const launch=async()=>{desktop=await electron.launch({executablePath:exe,env:{...process.env,CBIM_USER_DATA_ROOT:user},timeout:60000});const page=await desktop.firstWindow();page.setDefaultTimeout(30000);page.on('pageerror',error=>pageErrors.push(error.message));return page};
  let page=await launch();const active=()=>page.locator('.workspace-panel:not([hidden])'),goal=()=>active().getByTestId('conversation-goal-summary'),call=(action:string,args:unknown={})=>page.evaluate(({action,args})=>(window as any).cbim.call(action,args),{action,args});
  const settings=async()=>{await page.getByRole('button',{name:'用户菜单',exact:true}).click();await page.getByRole('menuitem',{name:'设置',exact:true}).click();await until(()=>page.getByRole('checkbox',{name:'启用新目标软限额',exact:true}).isEnabled(),'读取预算设置')};
  const select=async(existing=false)=>{await page.getByRole('button',{name:'project · 运行中',exact:true}).click();if(existing)await page.locator('[aria-label="project 的对话"] button').filter({hasText:shared?'SCOPE_BUDGET:':'REQUEST_BUDGET_UI'}).first().click()};
  await settings();await page.getByRole('checkbox',{name:'启用新目标软限额',exact:true}).check();await page.getByRole('checkbox',{name:'启用逐请求预算预留',exact:true}).check();await page.getByRole('textbox',{name:'Token 软限额',exact:true}).fill(mode==='block'?'69700':mode==='complete'?'80000':'200000');await page.getByRole('button',{name:'保存软限额',exact:true}).click();await until(async()=>(await call('budget.settings')).enforcement==='request','保存逐请求模式');const policy=await call('budget.settings');await fs.mkdir('test-results',{recursive:true});await page.screenshot({path:`test-results/${name}-settings.png`});
  await select();await active().getByRole('textbox',{name:'对话草稿',exact:true}).fill(shared?scopeBudgetFixture.goal:'REQUEST_BUDGET_UI: Check workspace identity, then reply.');shared?.releaseAll();await active().getByRole('button',{name:'发送消息',exact:true}).click();
  await until(async()=>{try{const scope=(await budgetScopes(user,entry.id))[0];return scope?.status==='closed'}catch(error){if((error as {code?:string}).code==='ENOENT')return false;throw error}},'真实Pi结束');await until(async()=>(await call('runtime.snapshot')).pressure.activeRuns===0,'引擎完全结算');
  const rendered=()=>until(async()=>{const phase=await goal().getAttribute('data-goal-state');return mode==='complete'?phase==='completed':['failed','blocked'].includes(phase??'')},'界面同步原周期终态');await rendered();
  const scope=(await budgetScopes(user,entry.id))[0],query={workspaceId:entry.id,rootSessionId:scope.rootSessionId,scopeId:scope.scopeId},graph=await call('dispatch.graphSnapshot',{identity:{workspaceId:entry.id,rootSessionId:scope.rootSessionId}});
  assert.deepEqual(scope.budget?.policy,policy);await goal().getByTestId('request-budget-panel').getByRole('button',{name:'刷新请求账本',exact:true}).click();await goal().getByTestId('request-budget-counts').waitFor();const report=requestBudgetReportSchema.parse(await call('dispatch.requestBudget',query));
  if(mode==='complete'){assert.equal(scope.outcome,'completed');assert.equal(shared!.main.length,6);assert.equal(shared!.member.length,5);assert.equal(report.reported,11);assert.equal(report.tokens,1920);assert.equal(report.unknown,0)}
  else if(mode==='block'){assert.equal(scope.outcome,'failed');assert.equal(simple!.requests.length,1);assert.equal(report.denied,1);assert.equal(report.lastDenial,'token_reserve');assert.ok((await goal().getByTestId('request-budget-denial').innerText()).includes('所需预留 69632 Token'))}
  else{assert.equal(scope.outcome,'failed');assert.equal(simple!.requests.length,1);assert.equal(report.unknown,1);assert.equal(report.reservedTokens,69632);assert.ok((await goal().getByTestId('request-budget-panel').innerText()).includes('未知 1 次'))}
  await goal().getByTestId('request-budget-panel').scrollIntoViewIfNeeded();await page.screenshot({path:`test-results/${name}-settled.png`});const requests=shared?{main:shared.main.length,member:shared.member.length}:{main:simple!.requests.length,member:0};
  // Use the actual app path layout via Paths; do not assume a user-directory format in assertions.
  const storedJournal=path.join(new Paths(user,path.resolve('.')).project(entry.id),'dispatch','dispatch.jsonl'),bytes=await fs.readFile(storedJournal);
  await settings();await page.getByRole('textbox',{name:'Token 软限额',exact:true}).fill('500000');await page.getByRole('button',{name:'保存软限额',exact:true}).click();await until(async()=>(await call('budget.settings')).limits.tokens===500000,'只修改未来目标设置');assert.deepEqual((await budgetScopes(user,entry.id))[0],scope);
  await desktop!.close();desktop=undefined;page=await launch();await select(true);await goal().getByTestId('request-budget-panel').getByRole('button',{name:'刷新请求账本',exact:true}).click();await goal().getByTestId('request-budget-counts').waitFor();assert.deepEqual(await call('dispatch.requestBudget',query),report);assert.deepEqual((await budgetScopes(user,entry.id))[0],scope);assert.deepEqual(await call('dispatch.graphSnapshot',{identity:{workspaceId:entry.id,rootSessionId:scope.rootSessionId}}),graph);assert.deepEqual(await fs.readFile(storedJournal),bytes);
  assert.deepEqual(shared?{main:shared.main.length,member:shared.member.length}:{main:simple!.requests.length,member:0},requests);await rendered();await goal().getByTestId('request-budget-panel').scrollIntoViewIfNeeded();await page.screenshot({path:`test-results/${name}-restored.png`});
  assert.deepEqual(pageErrors,[]);assert.deepEqual(shared?.errors??simple!.errors,[]);
  if(shared)assert.equal(await fs.readFile(path.join(project,scopeBudgetFixture.file),'utf8'),scopeBudgetFixture.fact);
  const receipt={packagedExe:exe,mode,realPi:true,onlineProvider:false,settingsByRealClick:true,policy,report,requests,readAndRestartWithoutReplay:true,futureSettingsDoNotChangeOldScope:true,scopeOutcome:scope.outcome,pageErrors};await fs.writeFile(`test-results/${name}-ui-smoke.json`,JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt));
}catch(error){keep=true;await fs.mkdir('test-results',{recursive:true});const page=desktop?await desktop.firstWindow().catch(()=>undefined):undefined;await page?.screenshot({path:`test-results/${name}-failure.png`}).catch(()=>{});await fs.writeFile(`test-results/${name}-ui-failure.json`,JSON.stringify({packagedExe:exe,mode,temp,error:String(error),pageErrors,dom:await page?.locator('body').innerText().catch(()=>undefined),requests:shared?.sequence??simple?.requests.map(r=>({path:r.path,compaction:r.compaction})),providerErrors:shared?.errors??simple?.errors},null,2));throw error}
finally{shared?.releaseAll();await desktop?.close().catch(()=>{});await setup?.shutdown();await shared?.close();await simple?.close();if(!keep){const target=path.resolve(temp);assert.equal(path.dirname(target),path.resolve(os.tmpdir()));assert.ok(path.basename(target).startsWith('cbim-request-budget-ui-'));await fs.rm(target,{recursive:true,force:true})}}
