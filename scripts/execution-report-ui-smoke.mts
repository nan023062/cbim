import {_electron as electron,type ElectronApplication} from 'playwright-core';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {Application} from '../src/bridge/server/application';
import {Paths} from '../src/logic/workspace/service/paths';
import {executionReportProvider,reportFixture as data} from '../tests/execution-report-provider';
import {seedExecutionReport,reportFiles} from '../tests/execution-report-fixture';
import {latestExecutable} from './build-artifact.mjs';

// The EXE, Pi, tools and receipt reader are real. Only model responses and explicitly identified
// missing/partial-log faults are controlled inside this temporary project and application data root.
const success=process.argv.includes('--success'),artifact='execution-report'+(success?'-success':'');
const exe=await latestExecutable(),temp=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-execution-report-ui-'));
const project=path.join(temp,'project'),user=path.join(temp,'user');await fs.mkdir(project);
const provider=await executionReportProvider({success,hold:true}),pageErrors:string[]=[];
let desktop:ElectronApplication|undefined,setup:Application|undefined,keepTemp=false,diagnosticQuery:Record<string,unknown>|undefined;
try{
  setup=new Application(new Paths(user,path.resolve('.')),path.resolve('design'));await setup.init();
  const {entry}=await seedExecutionReport(setup,project,provider);await setup.shutdown();setup=undefined;
  const waitUntil=async(check:()=>Promise<boolean>,label:string)=>{const deadline=Date.now()+30000;while(Date.now()<deadline){if(await check())return;await new Promise(resolve=>setTimeout(resolve,50))}throw Error('等待验收超时：'+label)};
  desktop=await electron.launch({executablePath:exe,env:{...process.env,CBIM_USER_DATA_ROOT:user},timeout:60000});
  let page=await desktop.firstWindow();page.setDefaultTimeout(30000);page.on('pageerror',error=>pageErrors.push(error.message));
  await page.getByRole('button',{name:'project · 运行中',exact:true}).waitFor();
  await page.evaluate(()=>{(window as any).__reportClicks=[];document.addEventListener('click',event=>{const button=(event.target as Element).closest('[data-testid="execution-report-refresh"],[data-testid="execution-report-inspect"]');if(button)(window as any).__reportClicks.push({at:Date.now(),testid:button.getAttribute('data-testid')})},true)});
  const call=(action:string,args:unknown={})=>page.evaluate(({action,args})=>(window as any).cbim.call(action,args),{action,args});
  const active=()=>page.locator('.workspace-panel:not([hidden])'),panel=()=>active().getByTestId('member-execution-report');
  await page.getByRole('button',{name:'project · 运行中',exact:true}).click();
  await active().getByRole('combobox',{name:'执行权限',exact:true}).click();await active().getByRole('option',{name:success?/只读访问/:/完全访问/}).click();
  await active().getByRole('textbox',{name:'对话草稿',exact:true}).fill(data.mainGoal);await active().getByRole('button',{name:'发送消息',exact:true}).click();
  await waitUntil(async()=>provider.memberRequests.length===3,'真实业务工具返回');
  const roots=await call('loop.list',{id:entry.id});
  const rootSessionId=roots[0].task.taskId,identity={workspaceId:entry.id,rootSessionId},graph=()=>call('dispatch.graphSnapshot',{identity});
  const running=(await graph()).tasks[0];assert.equal(running.status,'running');
  const query={...identity,taskId:running.taskId,runId:running.activeRunId,limit:100};diagnosticQuery=query;
  await active().getByRole('tab',{name:'任务视图',exact:true}).click();await active().locator(`[data-testid="dispatch-task-node"][data-task-id="${running.taskId}"]`).click();
  await panel().getByTestId('execution-report-inspect').waitFor();assert.equal(await panel().getAttribute('data-report-state'),'idle');
  await panel().getByTestId('execution-report-inspect').click();
  await active().locator('[data-testid="member-execution-report"][data-report-state="ready"][data-execution="in_flight"]').waitFor();
  assert.equal(provider.memberRequests.length,3);assert.equal(provider.mainRequests.length,3);
  if(!success)assert.equal(await fs.readFile(path.join(project,data.marker),'utf8'),data.fact);
  await fs.mkdir('test-results',{recursive:true});await panel().scrollIntoViewIfNeeded();await page.screenshot({path:`test-results/${artifact}-in-flight.png`});
  provider.release();await waitUntil(async()=>{const current=(await graph()).tasks[0];return current.status===(success?'result_ready':'failed')&&provider.mainRequests.length===6&&(await call('runtime.snapshot')).pressure.activeRuns===0},'运行与目标收束');
  // Backend settlement can precede the graph's next UI delta. Wait for the visible stale signal
  // before clicking its refresh button, instead of racing a changing node-detail layout.
  await active().getByTestId('task-scope-status').filter({hasText:success?'目标已完成':'目标未完成'}).waitFor();
  await panel().getByTestId('execution-report-stale').waitFor();
  assert.equal((await call('dispatch.executionReport',query)).execution,'settled');
  await panel().getByTestId('execution-report-refresh').click();await active().locator('[data-testid="member-execution-report"][data-report-state="ready"][data-execution="settled"][data-log-state="verified"]').waitFor();
  const files=await reportFiles(user,entry.id,query.taskId,query.runId),before=await files.read(),graphBefore=await graph(),counts={main:provider.mainRequests.length,member:provider.memberRequests.length};
  const report=await call('dispatch.executionReport',query);assert.equal(report.execution,'settled');assert.equal(report.log.state,'verified');
  assert.equal(report.tools.items.find((item:any)=>item.toolCallId===(success?'report-business-read':'report-business-command')).status,success?'succeeded':'failed');
  if(success)assert.equal(report.candidate?.acceptance,'not_evaluated');else assert.ok(report.issues.some((issue:any)=>issue.code==='TOOLS_FAILED_WITH_POSSIBLE_EFFECTS'));
  for(const value of [project,user,data.fact,'writeFileSync','sessionFile'])assert.ok(!JSON.stringify(report).includes(value),'公开报告不能泄露原始正文或原生路径');
  await panel().scrollIntoViewIfNeeded();await page.screenshot({path:`test-results/${artifact}-settled.png`});
  if(!success){
    await fs.rename(files.log,files.log+'.test-backup');
    try{
      await panel().getByTestId('execution-report-refresh').click();await active().locator('[data-testid="member-execution-report"][data-report-state="ready"][data-execution="unknown"][data-log-state="missing"]').waitFor();
      await panel().scrollIntoViewIfNeeded();await page.screenshot({path:`test-results/${artifact}-missing.png`});
      assert.equal((await call('dispatch.executionReport',query)).tools.available,false);
    }finally{await fs.rename(files.log+'.test-backup',files.log)}
    await fs.appendFile(files.log,'{"incomplete_test_tail":');
    try{
      await panel().getByTestId('execution-report-refresh').click();await active().locator('[data-testid="member-execution-report"][data-report-state="ready"][data-execution="unknown"][data-log-state="incomplete"]').waitFor();
      await panel().scrollIntoViewIfNeeded();await page.screenshot({path:`test-results/${artifact}-incomplete.png`});
    }finally{await fs.writeFile(files.log,before.log)}
    await panel().getByTestId('execution-report-refresh').click();await active().locator('[data-testid="member-execution-report"][data-report-state="ready"][data-execution="settled"][data-log-state="verified"]').waitFor();
    assert.equal(await fs.readFile(path.join(project,data.marker),'utf8'),data.fact);
  }
  assert.deepEqual(await files.read(),before);assert.deepEqual(await graph(),graphBefore);assert.equal(provider.mainRequests.length,counts.main);assert.equal(provider.memberRequests.length,counts.member);
  await desktop.close();desktop=undefined;desktop=await electron.launch({executablePath:exe,env:{...process.env,CBIM_USER_DATA_ROOT:user},timeout:60000});
  page=await desktop.firstWindow();page.setDefaultTimeout(30000);page.on('pageerror',error=>pageErrors.push(error.message));
  await page.getByRole('button',{name:'project · 运行中',exact:true}).click();await page.locator('.workspace-conversations button').filter({hasText:data.mainGoal}).first().click();
  await active().getByRole('tab',{name:'任务视图',exact:true}).click();await active().locator(`[data-testid="dispatch-task-node"][data-task-id="${running.taskId}"]`).click();
  await panel().getByTestId('execution-report-inspect').click();await active().locator('[data-testid="member-execution-report"][data-report-state="ready"][data-execution="settled"][data-log-state="verified"]').waitFor();
  await panel().getByTestId('execution-report-refresh').click();await active().locator('[data-testid="member-execution-report"][data-report-state="ready"]').waitFor();
  assert.equal(provider.mainRequests.length,counts.main);assert.equal(provider.memberRequests.length,counts.member);assert.deepEqual(await graph(),graphBefore);assert.deepEqual(await files.read(),before);
  await panel().scrollIntoViewIfNeeded();await page.screenshot({path:`test-results/${artifact}-restored.png`});
  assert.deepEqual(pageErrors,[]);assert.deepEqual(provider.errors,[]);
  const result={packagedExe:exe,realPi:true,realProvider:false,success,inFlightReport:true,settledReport:true,explicitReadOnlyRefresh:true,publicProjectionRedacted:true,sourceBytesUnchanged:true,graphUnchanged:true,restartWithoutReplay:true,...(success?{successfulCandidate:true}:{failedCommandActuallyWroteMarker:true,missingLogFaultInjected:true,truncatedTailFaultInjected:true,unknownNotSuccess:true}),mainRequests:provider.mainRequests.length,memberRequests:provider.memberRequests.length,pageErrors,transportErrors:provider.errors};
  await fs.writeFile(`test-results/${artifact}-ui-smoke.json`,JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}catch(error){
  keepTemp=true;await fs.mkdir('test-results',{recursive:true});if(desktop)await desktop.firstWindow().then(page=>page.screenshot({path:`test-results/${artifact}-failure.png`})).catch(()=>{});
  const reportState=desktop?await desktop.firstWindow().then(page=>page.getByTestId('member-execution-report').first().evaluate(e=>({state:e.getAttribute('data-report-state'),execution:e.getAttribute('data-execution'),text:e.textContent}))).catch(()=>undefined):undefined;
  const directReport=desktop&&diagnosticQuery?await desktop.firstWindow().then(page=>page.evaluate(query=>(window as any).cbim.call('dispatch.executionReport',query),diagnosticQuery)).catch(cause=>String(cause)):undefined;
  const clicks=desktop?await desktop.firstWindow().then(page=>page.evaluate(()=>(window as any).__reportClicks)).catch(()=>undefined):undefined;
  await fs.writeFile(`test-results/${artifact}-ui-failure.json`,JSON.stringify({packagedExe:exe,temp,error:String(error),reportState,directReport,clicks,mainRequests:provider.mainRequests.length,memberRequests:provider.memberRequests.length,pageErrors,transportErrors:provider.errors},null,2));throw error;
}finally{
  provider.release();if(desktop)await desktop.close().catch(()=>{});if(setup)await setup.shutdown();await provider.close();
  if(!keepTemp){const target=path.resolve(temp);assert.equal(path.dirname(target),path.resolve(os.tmpdir()));assert.ok(path.basename(target).startsWith('cbim-execution-report-ui-'));await fs.rm(target,{recursive:true,force:true})}
}
