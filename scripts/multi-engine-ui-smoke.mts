// 真实发行 EXE 的三引擎、主执行与配置菜单验收。仅模型响应确定性；引擎、IPC、文件和保存均为真实路径。
// 用独立用户目录，不安装、不读取用户模型或凭据；每次报告必须使用新目录并保留失败现场。
import {_electron as electron,type ElectronApplication,type Page} from 'playwright-core';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {Application} from '../src/backend/main/assembly/application';
import {Paths} from '../src/backend/main/platform/paths';
import {seedTeam} from '../tests/team-fixture';
import {modelRequestBudgetProvider} from '../tests/model-request-budget-provider';
import {codexResponse} from '../tests/codex-fixture';
import {latestExecutable} from './build-artifact.mjs';

const exe=await latestExecutable(),evidence=path.resolve(process.env.CBIM_ENGINE_REPORT_DIR??'test-results/multi-engine-ui');
await fs.mkdir(evidence,{recursive:false});
const temp=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-engines-ui-')),user=path.join(temp,'user'),project=path.join(temp,'engine-project');
await fs.mkdir(project);const written=path.join(project,'main-written.txt');
const providers={pi:await modelRequestBudgetProvider('openai-completions'),'claude-code':await modelRequestBudgetProvider('anthropic-messages')};
const requests:any[]=[],errors:string[]=[],pageErrors:string[]=[],summaries:any[]=[];let didWrite=false,setup:Application|undefined,desktop:ElectronApplication|undefined,page:Page|undefined,stage='setup';
const server=http.createServer(async(req,res)=>{try{
  let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);requests.push(body);
  const write=JSON.stringify(body).includes('write-smoke')&&!didWrite;
  if(write){assert.ok(body.tools.some((t:any)=>t.name==='cbim_native_write'));didWrite=true}
  codexResponse(res,write?{id:'desktop-main-write',name:'cbim_native_write',input:{path:written,content:'CBIM main native write verified'}}:undefined);
}catch(error){errors.push(String(error));res.destroy()}});
await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
const codexUrl='http://127.0.0.1:'+(server.address() as any).port+'/v1';
const ids:Record<string,string>={};let entry:any,team:any,memberId:string|undefined;
const until=async(check:()=>Promise<boolean>,label:string)=>{const end=Date.now()+60000;while(Date.now()<end){if(await check())return;await new Promise(r=>setTimeout(r,80))}throw Error('等待超时：'+label)};
const call=(action:string,args:unknown={}):Promise<any>=>page!.evaluate(({action,args})=>(window as any).cbim.call(action,args),{action,args});
const active=()=>page!.locator('.workspace-panel:not([hidden])');
const view=()=>page!.locator('.extension-area:not([hidden]) .extension-content:not([hidden])');
async function launch(){
  const env={...process.env,CBIM_USER_DATA_ROOT:user};for(const key of ['GH_TOKEN','GITHUB_TOKEN','ELECTRON_RUN_AS_NODE'])delete env[key];
  desktop=await electron.launch({executablePath:exe,env,timeout:60000});page=await desktop.firstWindow();page.setDefaultTimeout(30000);
  page.on('pageerror',error=>pageErrors.push(error.message));await page.setViewportSize({width:1500,height:1000});
  assert.equal(path.resolve(await desktop.evaluate(({app})=>app.getPath('userData'))),path.resolve(user,'desktop'));
  await page.getByRole('button',{name:'engine-project · 运行中',exact:true}).click();
  await active().getByRole('textbox',{name:'对话草稿',exact:true}).waitFor();

}
async function picker(label:string,option:string){await active().getByRole('combobox',{name:label,exact:true}).click();await page!.getByRole('listbox',{name:label+'选项',exact:true}).getByRole('option').filter({hasText:option}).click()}
async function openTeam(){const expand=page!.getByRole('button',{name:'展开右侧扩展',exact:true});if(await expand.isVisible())await expand.click();const tab=page!.getByRole('tab',{name:'团队架构',exact:true});if(await tab.count())await tab.click();else{await page!.getByRole('button',{name:'新增扩展页签',exact:true}).click();await view().getByRole('button',{name:'打开团队架构',exact:true}).click()}await view().getByTestId('team-workspace-members').waitFor()}
try{
  setup=new Application(new Paths(user,path.resolve('.')),path.resolve('design'));await setup.init();entry=await setup.dispatch('add',{path:project});team=await seedTeam(setup.workspace(entry.id));
  for(const engine of ['pi','claude-code','codex'] as const){
    const value=await setup.models.save({profile:{name:'Desktop '+engine,api:engine==='pi'?'openai-completions':engine==='codex'?'openai-responses':'anthropic-messages',auth:'none',baseUrl:engine==='codex'?codexUrl:providers[engine].url,defaultModel:'request-budget-model',models:[{id:'request-budget-model',name:engine+' enabled',enabled:true,contextWindow:200000,maxTokens:4096,reasoning:false},{id:'disabled-model',name:'Must not appear',enabled:false,contextWindow:200000,maxTokens:4096,reasoning:false}]}});ids[engine]=value.profiles.find(p=>p.name==='Desktop '+engine)!.id;
  }
  await setup.shutdown();setup=undefined;await launch();
  stage='main engine menu';await active().getByRole('combobox',{name:'Loop 引擎',exact:true}).click();assert.deepEqual(await page!.getByRole('listbox',{name:'Loop 引擎选项',exact:true}).getByRole('option').allTextContents(),['Pi','Claude Code','Codex']);await page!.keyboard.press('Escape');
  await picker('执行权限','只读访问');
  const engines=['pi','claude-code','codex','pi','codex','codex'] as const;
  for(const [index,engine] of engines.entries()){
    stage='main turn '+index+' '+engine;await picker('Loop 引擎',engine==='pi'?'Pi':engine==='codex'?'Codex':'Claude Code');
    await active().getByRole('combobox',{name:'对话模型',exact:true}).click();const list=page!.getByRole('listbox',{name:'对话模型选项',exact:true});assert.ok(!(await list.innerText()).includes('Must not appear'));assert.ok((await list.innerText()).includes(engine+' enabled'));await page!.keyboard.press('Escape');
    const modelEngine=engine==='pi'?'claude-code':engine;
    await picker('对话模型','Desktop '+modelEngine+' / request-budget-model');
    const snapshot=await call('snapshot',{id:entry.id}),setting=await call('agent.mainSettings',{workspaceId:entry.id,instanceId:snapshot.instanceId});
    assert.deepEqual(setting.selection,{engine,profileId:ids[modelEngine],modelId:'request-budget-model'});
    if(index===5){await picker('协作模式','团队模式');await picker('执行权限','完全访问')}
    await active().getByRole('textbox',{name:'对话草稿',exact:true}).fill(index===5?'write-smoke: 在当前模块写入验证文件。':'desktop-turn-'+index+' preserve prior context.');
    await active().getByRole('button',{name:'发送消息',exact:true}).click();
    let run:any;await until(async()=>{const rows=await call('loop.list',{id:entry.id});const row=rows.find((r:any)=>!summaries.some(s=>s.runId===r.runId));if(row)run={taskId:row.task.taskId,runId:row.runId};return !!run},'真实对话受理');let summary:any;
    await until(async()=>{summary=await call('loop.inspect',{id:entry.id,...run});if(['failed','cancelled','interrupted'].includes(summary.status))throw Error(JSON.stringify(summary.events.slice(-5)));return summary.status==='completed'},'实际引擎结束');
    await until(async()=>(await call('runtime.snapshot')).pressure.activeRuns===0&&await active().getByRole('button',{name:'发送消息',exact:true}).isVisible(),'运行结算');
    assert.equal(summary.events[0].data.engine,engine);assert.ok(summary.sessionFile);summaries.push({taskId:run.taskId,runId:run.runId,engine,status:summary.status,sessionFile:summary.sessionFile});
  }
  assert.equal(new Set(summaries.map(s=>s.taskId)).size,1);assert.equal(summaries[0].sessionFile,summaries[3].sessionFile);assert.equal(summaries[2].sessionFile,summaries[4].sessionFile);assert.equal(await fs.readFile(written,'utf8'),'CBIM main native write verified');
  assert.ok(JSON.stringify(providers['claude-code'].requests[1].body).includes('desktop-turn-0'));assert.ok(JSON.stringify(requests[0]).includes('desktop-turn-1'));
  await page!.screenshot({path:path.join(evidence,'main-three-engines.png')});
  stage='shared main Agent settings';await openTeam();
  await active().getByRole('textbox',{name:'对话草稿',exact:true}).fill('配置主 Agent 时保留草稿');
  await view().getByTestId('team-main-agent-settings').click();
  let mainDialog=page!.getByRole('dialog',{name:'主 Agent 配置',exact:true});
  await until(async()=>await mainDialog.getByRole('combobox',{name:'Agent Loop 引擎',exact:true}).inputValue()==='codex','对话配置进入主 Agent 页面');
  await mainDialog.getByRole('combobox',{name:'Agent Loop 引擎',exact:true}).selectOption('pi');
  await mainDialog.getByRole('combobox',{name:'Agent 模型',exact:true}).selectOption(JSON.stringify([ids['claude-code'],'request-budget-model']));
  await mainDialog.getByRole('button',{name:'保存主 Agent 配置',exact:true}).click();await mainDialog.waitFor({state:'hidden'});
  await until(async()=>(await active().getByRole('combobox',{name:'Loop 引擎',exact:true}).innerText()).includes('Pi'),'主 Agent 页面同步到对话栏');
  await picker('Loop 引擎','Claude Code');
  await view().getByTestId('team-main-agent-settings').click();mainDialog=page!.getByRole('dialog',{name:'主 Agent 配置',exact:true});
  await until(async()=>await mainDialog.getByRole('combobox',{name:'Agent Loop 引擎',exact:true}).inputValue()==='claude-code','对话栏同步到主 Agent 页面');
  await mainDialog.getByRole('combobox',{name:'Agent Loop 引擎',exact:true}).selectOption('codex');
  await mainDialog.getByRole('combobox',{name:'Agent 模型',exact:true}).selectOption(JSON.stringify([ids.codex,'request-budget-model']));
  await mainDialog.getByRole('button',{name:'保存主 Agent 配置',exact:true}).click();await mainDialog.waitFor({state:'hidden'});
  assert.equal(await active().getByRole('textbox',{name:'对话草稿',exact:true}).inputValue(),'配置主 Agent 时保留草稿');
  stage='Agent configuration';await openTeam();await view().locator('.team-node-select').filter({hasText:'开发者'}).click();await view().getByRole('button',{name:'编辑 Agent',exact:true}).click();
  const dialog=page!.getByRole('dialog',{name:'编辑Agent',exact:true});await dialog.getByRole('combobox',{name:'Agent Loop 引擎',exact:true}).selectOption('claude-code');await dialog.getByRole('combobox',{name:'Agent 模型',exact:true}).selectOption(JSON.stringify([ids['claude-code'],'request-budget-model']));
  await dialog.getByRole('button',{name:'校验并预览',exact:true}).click();await dialog.getByRole('region',{name:'知识变更预览',exact:true}).waitFor();await dialog.getByRole('button',{name:'确认提交到工作区',exact:true}).click();await dialog.waitFor({state:'hidden'});
  stage='role independent engine';await view().getByTestId('team-workspace-members').click();const members=view().getByTestId('workspace-members');await members.getByTestId('workspace-member-register').click();await members.getByRole('combobox',{name:'静态 Agent',exact:true}).selectOption(team.input.agentId);
  assert.equal(await members.getByRole('combobox',{name:'Agent Loop 引擎',exact:true}).inputValue(),'claude-code');assert.equal(await members.getByRole('combobox',{name:'岗位模型',exact:true}).inputValue(),JSON.stringify([ids['claude-code'],'request-budget-model']));
  await members.getByRole('combobox',{name:'Agent Loop 引擎',exact:true}).selectOption('codex');assert.equal(await members.getByRole('combobox',{name:'岗位模型',exact:true}).inputValue(),'');await members.getByRole('combobox',{name:'岗位模型',exact:true}).selectOption(JSON.stringify([ids.codex,'request-budget-model']));
  for(const [label,text] of [['岗位名称','Desktop Codex role'],['岗位职责','维护模块实现与验证'],['岗位适配说明','只在用户授权范围执行'],['变更原因','验证独立引擎配置']])await members.getByRole('textbox',{name:label,exact:true}).fill(text);
  await members.getByTestId('workspace-member-preview').click();await members.getByTestId('workspace-member-preview-result').waitFor();await members.getByTestId('workspace-member-commit').click();await members.getByTestId('workspace-member-detail').waitFor();
  const snap=await call('snapshot',{id:entry.id}),identity={workspaceId:entry.id,instanceId:snap.instanceId};const listing=await call('workspace.members.list',identity);assert.equal(listing.total,1);memberId=listing.items[0].memberId;
  const role=await call('workspace.members.get',{...identity,memberId});assert.equal(role.member.runtimePolicy.profileId,ids.codex);assert.equal(role.member.runtimePolicy.snapshot.engine,'codex');
  const agent=JSON.parse(snap.files.find((f:any)=>f.path===team.input.agentId+'/agent.json').text);assert.equal(agent.runtime.engine,'claude-code');
  await page!.screenshot({path:path.join(evidence,'independent-role-engine.png')});
  stage='restart without replay';const before={pi:providers.pi.requests.length,claude:providers['claude-code'].requests.length,codex:requests.length};await desktop!.close();desktop=undefined;await launch();await new Promise(r=>setTimeout(r,1200));assert.deepEqual({pi:providers.pi.requests.length,claude:providers['claude-code'].requests.length,codex:requests.length},before);
  const latestSnap=await call('snapshot',{id:entry.id});const retained=await call('workspace.members.get',{workspaceId:entry.id,instanceId:latestSnap.instanceId,memberId});assert.equal(retained.member.runtimePolicy.snapshot.engine,'codex');assert.equal((await call('agent.mainSettings',{workspaceId:entry.id,instanceId:latestSnap.instanceId})).selection.engine,'codex');assert.deepEqual(pageErrors,[]);assert.deepEqual(errors,[]);assert.deepEqual(providers.pi.errors,[]);assert.deepEqual(providers['claude-code'].errors,[]);
  await fs.writeFile(path.join(evidence,'report.json'),JSON.stringify({success:true,exe,sha256:createHash('sha256').update(await fs.readFile(exe)).digest('hex'),version:await desktop!.evaluate(({app})=>app.getVersion()),summaries,requests:before,mainTeamWrite:true,mainAgentShared:true,modelDirectoryUnified:true,agentDefault:'claude-code',independentRole:'codex',restartNoReplay:true,pageErrors,limitations:['本机确定性模型响应不代表在线供应商质量。','此项使用打包 EXE，不替代隔离 NSIS 安装升级验收。'],completedAt:new Date().toISOString()},null,2),{flag:'wx'});
  console.log(JSON.stringify({success:true,evidence,turns:summaries.length,mainTeamWrite:true}));
}catch(error){if(page)await page.screenshot({path:path.join(evidence,'failure.png')}).catch(()=>{});await fs.writeFile(path.join(evidence,'failure.json'),JSON.stringify({stage,error:String(error),stack:(error as Error).stack,temp,pageErrors,errors,summaries},null,2),{flag:'wx'});throw error}
finally{await desktop?.close();await setup?.shutdown();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await Promise.all([providers.pi.close(),providers['claude-code'].close()])}
