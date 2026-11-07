import {_electron as electron,type ElectronApplication,type Page} from 'playwright-core';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {Application} from '../src/backend/main/application';
import {Paths} from '../src/backend/main/platform/paths';
import type {Snapshot} from '../src/bridge/contracts/workspace';
import {workspaceMemberDetailSchema,workspaceMemberListSchema,workspaceMemberReceiptSchema,type WorkspaceMemberReceipt} from '../src/backend/core/team/workspace-member';
import {seedWorkspaceMembers,workspaceMemberFixture as data,workspaceMemberHttpProbe,workspaceMemberRunFiles} from '../tests/workspace-member-fixture';
import {latestExecutable} from './build-artifact.mjs';

// Packaged UI, real registry journal and real knowledge/profile services. This registration slice has no model execution.
// --unknown loses exactly one already-persisted commit reply at the test IPC boundary; it never fabricates acceptance.
const mode=process.argv.includes('--unknown')?'unknown':'complete',artifact='workspace-member-'+mode,exe=await latestExecutable();
const temp=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-workspace-member-ui-')),user=path.join(temp,'user'),probe=await workspaceMemberHttpProbe();
const pageErrors:string[]=[],transportErrors:string[]=[],dialogs:string[]=[],screenshots:string[]=[];
let setup:Application|undefined,desktop:ElectronApplication|undefined,page!:Page,keepTemp=false;
let report:Record<string,unknown>|undefined;const cleanup={desktopClosed:false,probeClosed:false,tempRemoved:false};
try{
  setup=new Application(new Paths(user,path.resolve('.')),path.resolve('design'));await setup.init();const seeded=await seedWorkspaceMembers(setup,temp,probe.url);await setup.shutdown();setup=undefined;
  const launch=async()=>{
    desktop=await electron.launch({executablePath:exe,env:{...process.env,CBIM_USER_DATA_ROOT:user},timeout:60000});page=await desktop.firstWindow();page.setDefaultTimeout(30000);
    page.on('pageerror',error=>pageErrors.push(error.message));page.on('requestfailed',request=>transportErrors.push(request.url()+': '+request.failure()?.errorText));page.on('dialog',async dialog=>{dialogs.push(dialog.type()+': '+dialog.message());await dialog.dismiss()});
    await desktop.evaluate(({ipcMain},loseReply)=>{
      (globalThis as any).__workspaceMemberTrace=[];let dropped=false;const handlers=(ipcMain as any)._invokeHandlers,original=handlers.get('cbim:call');if(!original)throw Error('Real IPC handler missing');
      handlers.set('cbim:call',async(event:unknown,action:string,input:unknown)=>{
        if(action.startsWith('workspace.members.'))(globalThis as any).__workspaceMemberTrace.push({action,input:structuredClone(input)});
        const result=await original(event,action,input);
        if(loseReply&&!dropped&&action==='workspace.members.commit'&&result.ok===true){dropped=true;(globalThis as any).__workspaceMemberLost={input:structuredClone(input),receipt:structuredClone(result.value)};return {ok:false,error:{code:'TEST_RESPONSE_LOST',message:'测试在岗位登记已实际受理后丢弃本次回复，请查询原命令。'}}}
        return result;
      });
    },mode==='unknown'&&!report);
  };
  const call=<T=any,>(action:string,args:unknown={}):Promise<T>=>page.evaluate(({action,args})=>(window as any).cbim.call(action,args),{action,args});
  const until=async(check:()=>Promise<boolean>,label:string)=>{const end=Date.now()+45000;while(Date.now()<end){if(await check())return;await new Promise(resolve=>setTimeout(resolve,40))}throw Error('等待验收超时：'+label)};
  const active=()=>page.locator('.workspace-panel:not([hidden])'),draft=()=>active().getByRole('textbox',{name:'对话草稿',exact:true}),view=()=>page.locator('.extension-area:not([hidden]) .extension-content:not([hidden])');
  const panel=()=>view().getByTestId('workspace-members'),detail=()=>panel().getByTestId('workspace-member-detail');
  const snapshot=()=>call<Snapshot>('snapshot',{id:seeded.entry.id}),identity=async()=>({workspaceId:seeded.entry.id,instanceId:(await snapshot()).instanceId});
  const list=async()=>workspaceMemberListSchema.parse(await call('workspace.members.list',await identity()));
  const get=async(memberId:string)=>workspaceMemberDetailSchema.parse(await call('workspace.members.get',{...await identity(),memberId}));
  const journalPath=path.join(user,seeded.entry.id,'dispatch','dispatch.jsonl');
  const journal=async()=>{try{return await fs.readFile(journalPath)}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return Buffer.alloc(0);throw error}};
  const transactions=async()=>{const directory=path.join(user,seeded.entry.id,'transactions'),names=(await fs.readdir(directory)).filter(name=>name.endsWith('.json')).sort();return Promise.all(names.map(async name=>({name,hash:createHash('sha256').update(await fs.readFile(path.join(directory,name))).digest('hex')})))};
  const runtime=async()=>({a:await call('loop.list',{id:seeded.entry.id}),b:await call('loop.list',{id:seeded.other.id}),runFiles:await workspaceMemberRunFiles(user,[seeded.entry.id,seeded.other.id])});
  const screenshot=async(suffix:string)=>{const file=`test-results/${artifact}-${suffix}.png`;await page.screenshot({path:file});screenshots.push(file)};
  const selectWorkspace=async(which:'a'|'b')=>{await page.getByRole('button',{name:(which==='a'?'workspace-members-alpha':'workspace-members-beta')+' · 运行中',exact:true}).click();await draft().waitFor()};
  const openMembers=async()=>{
    const expand=page.getByRole('button',{name:'展开右侧扩展',exact:true});if(await expand.isVisible())await expand.click();const tab=page.getByRole('tab',{name:'团队架构',exact:true});
    if(await tab.count())await tab.click();else{await page.getByRole('button',{name:'新增扩展页签',exact:true}).click();await view().getByRole('button',{name:'打开团队架构',exact:true}).click()}
    if(!(await panel().count())){await view().getByTestId('team-workspace-members').waitFor();await view().getByTestId('team-workspace-members').click()}
    await panel().waitFor();await until(()=>panel().getByRole('button',{name:'刷新岗位列表',exact:true}).isEnabled(),'岗位列表可读');
  };
  const selectMember=async(id:string)=>{const row=panel().locator(`[data-testid="workspace-member-row"][data-member-id="${id}"]`);await until(()=>row.isEnabled(),'岗位可选择');await row.click();await until(async()=>(await detail().count())>0&&(await detail().innerText()).includes(id),'已加载指定岗位')};
  const prepareAndCommit=async(reason:string,expectedTotal?:number)=>{
    await panel().getByRole('textbox',{name:'变更原因',exact:true}).fill(reason);await panel().getByTestId('workspace-member-preview').click();await panel().getByTestId('workspace-member-preview-result').waitFor();
    assert.equal(probe.requests.length,0);const before=await journal();await panel().getByTestId('workspace-member-commit').click();
    await until(async()=>!(await panel().getByTestId('workspace-member-commit').count())||(await panel().getByTestId('workspace-member-commit').isDisabled()),'保存操作进入确定或待查询状态');
    if(mode==='unknown'&&expectedTotal===1)return;
    await detail().waitFor();await until(()=>panel().getByTestId('workspace-member-edit').isEnabled().catch(()=>false),'登记详情与保存回执同步');
    assert.notDeepEqual(await journal(),before);if(expectedTotal!==undefined)assert.equal((await list()).total,expectedTotal);
  };
  const register=async(name:string,expectedTotal:number)=>{
    await panel().getByTestId('workspace-member-register').click();await panel().getByRole('combobox',{name:'静态 Agent',exact:true}).selectOption(seeded.team.input.agentId);
    assert.equal(await panel().getByRole('combobox',{name:'岗位模型',exact:true}).inputValue(),'');
    await panel().getByRole('textbox',{name:'岗位名称',exact:true}).fill(name);await panel().getByRole('textbox',{name:'岗位职责',exact:true}).fill(data.position);await panel().getByRole('textbox',{name:'岗位适配说明',exact:true}).fill(data.instructions);await panel().getByRole('textbox',{name:'参考知识 ID',exact:true}).fill(seeded.team.input.moduleId+'\n'+seeded.team.shared);
    await panel().getByRole('combobox',{name:'岗位模型',exact:true}).selectOption(JSON.stringify([seeded.profileId,seeded.modelId]));await prepareAndCommit(data.reason,expectedTotal);
  };
  await fs.mkdir('test-results',{recursive:true});await launch();await selectWorkspace('a');await draft().fill(data.draft);await selectWorkspace('b');await draft().fill(data.otherDraft);await selectWorkspace('a');await openMembers();
  const runtimeBefore=await runtime();let knowledgeBefore=await snapshot(),journalsBefore=await transactions();
  const unchanged=async()=>{const current=await snapshot();assert.equal(current.revision,knowledgeBefore.revision);assert.deepEqual(current.files,knowledgeBefore.files);assert.deepEqual(await transactions(),journalsBefore);assert.deepEqual(await runtime(),runtimeBefore);assert.deepEqual(probe.requests,[]);assert.equal((await call('runtime.snapshot')).pressure.activeRuns,0)};
  assert.equal((await list()).total,0);await register(data.firstName,1);
  let lost:WorkspaceMemberReceipt|undefined,commitsBeforeRestart=0,firstId:string,sourceChanges:Record<string,unknown>|undefined;
  if(mode==='unknown'){
    await until(async()=>!!await desktop!.evaluate(()=>(globalThis as any).__workspaceMemberLost),'真实提交已成功而本次回复被丢弃');
    const actual=await desktop!.evaluate(()=>(globalThis as any).__workspaceMemberLost);lost=workspaceMemberReceiptSchema.parse(actual.receipt);firstId=lost.memberId;
    const pending=panel().locator(`[data-command-id="${lost.commandId}"]`);await pending.getByTestId('workspace-member-receipt-query').waitFor();assert.match(await pending.innerText(),/结果未确认/);assert.match(await pending.innerText(),/TEST_RESPONSE_LOST/);assert.equal(await panel().getByTestId('workspace-member-register').isEnabled(),false);assert.equal((await list()).total,1);
    const stored=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)??'null'),'cbim.workspace-members.commands.v1.'+seeded.entry.id);assert.equal(stored.records.length,1);assert.equal(stored.records[0].request.commandId,lost.commandId);assert.equal(stored.records[0].phase,'unknown');assert.equal(stored.records[0].receipt,undefined);
    const trace=await desktop!.evaluate(()=>(globalThis as any).__workspaceMemberTrace as Array<{action:string}>);commitsBeforeRestart=trace.filter(item=>item.action==='workspace.members.commit').length;assert.equal(commitsBeforeRestart,1);await unchanged();await screenshot('unknown');
  }else{
    firstId=(await list()).items[0].memberId;const original=(await get(firstId)).member;
    await register(data.secondName,2);const secondId=(await list()).items[1].memberId;assert.notEqual(firstId,secondId);await selectMember(firstId);await unchanged();await screenshot('two-positions');
    // Explicit fixture IPC source updates are separate from the UI's registration operations.
    const before=await snapshot(),definition=JSON.parse(before.files.find(file=>file.path===seeded.team.input.agentId+'/agent.json')!.text),principlesPath=seeded.team.input.agentId+'/'+definition.work_principles,skillPath=seeded.team.shared+'/SKILL.md';
    const changes=[{path:principlesPath,text:before.files.find(file=>file.path===principlesPath)!.text+data.changedPrinciples},{path:skillPath,text:before.files.find(file=>file.path===skillPath)!.text+data.changedSkill}];
    await call('commit',{workspaceId:seeded.entry.id,instanceId:before.instanceId,revision:before.revision,requestId:randomUUID(),changes});
    await call('models.save',{id:seeded.profileId,profile:{...seeded.definition,name:seeded.definition.name+'（配置更新）',models:seeded.definition.models.map(model=>model.id===seeded.modelId?{...model,maxTokens:3072}:model)}});
    knowledgeBefore=await snapshot();journalsBefore=await transactions();await panel().getByRole('button',{name:'重新核实当前差异',exact:true}).click();await until(async()=>(await detail().locator('[data-diff="capability"]').innerText()).includes('已变化')&&(await detail().locator('[data-diff="model"]').innerText()).includes('已变化'),'真实来源变化待采纳');
    assert.deepEqual((await get(firstId)).member,original);await screenshot('source-changed');
    await panel().getByTestId('workspace-member-edit').click();await panel().getByRole('textbox',{name:'岗位名称',exact:true}).fill(data.renamed);await prepareAndCommit('仅修改名称，不暗中采纳新能力或模型。');
    assert.deepEqual((await get(firstId)).member.adoption,original.adoption);assert.deepEqual((await get(firstId)).member.runtimePolicy,original.runtimePolicy);assert.match(await detail().locator('[data-diff="capability"]').innerText(),/已变化/);assert.match(await detail().locator('[data-diff="model"]').innerText(),/已变化/);
    await panel().getByTestId('workspace-member-adopt-capability').click();await prepareAndCommit('单独采纳当前原则与继承 Skill，模型仍保持原版本。');const capability=(await get(firstId)).member.adoption;
    assert.notEqual(capability.captureId,original.adoption.captureId);assert.match(await detail().locator('[data-diff="capability"]').innerText(),/与已采纳一致/);assert.match(await detail().locator('[data-diff="model"]').innerText(),/已变化/);
    await panel().getByTestId('workspace-member-adopt-model').click();await prepareAndCommit('明确采纳同一模型公开配置的新版本。');assert.deepEqual((await get(firstId)).member.adoption,capability);assert.equal((await get(firstId)).member.runtimePolicy.snapshot.maxTokens,3072);assert.match(await detail().locator('[data-diff="model"]').innerText(),/与已采纳一致/);await screenshot('explicit-adoptions');
    await panel().getByTestId('workspace-member-suspend').click();await prepareAndCommit('显式暂停岗位登记，不改变任务与运行。');assert.equal((await get(firstId)).member.state,'suspended');await screenshot('suspended');
    await panel().getByTestId('workspace-member-retire').click();await panel().getByRole('textbox',{name:'变更原因',exact:true}).fill('明确退休，保留稳定岗位身份与采纳历史。');await panel().getByTestId('workspace-member-preview').click();await panel().getByTestId('workspace-member-commit').waitFor();await panel().getByTestId('workspace-member-commit').click();await until(async()=>(await detail().innerText()).includes('已退休')&&!(await panel().getByTestId('workspace-member-retire').count()),'退休真实终态已显示');
    assert.equal((await get(firstId)).member.state,'retired');assert.equal((await get(secondId)).member.revision,1);assert.equal((await get(secondId)).member.state,'active');await unchanged();await screenshot('retired');sourceChanges={kind:'explicit test setup via real knowledge commit and models.save IPC',capabilityThenModelAdoptedSeparately:true,renameKeptOldAdoptions:true,secondMemberUnaffected:true};
    const trace=await desktop!.evaluate(()=>(globalThis as any).__workspaceMemberTrace as Array<{action:string}>);commitsBeforeRestart=trace.filter(item=>item.action==='workspace.members.commit').length;assert.equal(commitsBeforeRestart,7);
  }
  const finalMember=(await get(firstId)).member,finalList=await list(),bytes=await journal(),records=bytes.toString('utf8').trim().split('\n').map(line=>JSON.parse(line) as {body:{mutation:{workspaceMemberChanges?:Array<{request:{commandId:string}}>} ;command:{commandId:string}}});
  assert.equal(records.flatMap(record=>record.body.mutation.workspaceMemberChanges??[]).length,mode==='unknown'?1:7);if(lost)assert.equal(records.filter(record=>record.body.command.commandId==='workspace-member-'+lost!.commandId).length,1);
  assert.equal(await draft().inputValue(),data.draft);await selectWorkspace('b');assert.equal(await draft().inputValue(),data.otherDraft);const otherSnapshot=await call<Snapshot>('snapshot',{id:seeded.other.id});assert.equal(workspaceMemberListSchema.parse(await call('workspace.members.list',{workspaceId:seeded.other.id,instanceId:otherSnapshot.instanceId})).total,0);await selectWorkspace('a');
  await desktop!.close();desktop=undefined;report={phase:'reopening'};await launch();await selectWorkspace('a');assert.equal(await draft().inputValue(),data.draft);await openMembers();
  if(lost){await until(async()=>{const value=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)??'null'),'cbim.workspace-members.commands.v1.'+seeded.entry.id);return value.records[0].phase==='accepted'},'重开只查询原岗位命令并恢复真实受理事实');const commands=panel().locator('.workspace-member-commands');await commands.locator('summary').click();const entry=panel().locator(`[data-command-id="${lost.commandId}"]`);await entry.getByTestId('workspace-member-receipt-query').click();await until(async()=>(await entry.innerText()).includes('已受理'),'显式查询原命令');assert.deepEqual(await call('workspace.members.receipt',{workspaceId:seeded.entry.id,commandId:lost.commandId}),lost)}
  await selectMember(firstId);assert.deepEqual((await get(firstId)).member,finalMember);assert.deepEqual((await list()).items,finalList.items);assert.deepEqual((await list()).registryCursor,finalList.registryCursor);assert.deepEqual(await journal(),bytes);await unchanged();
  const restartTrace=await desktop!.evaluate(()=>(globalThis as any).__workspaceMemberTrace as Array<{action:string;input:{commandId?:string}}>);assert.equal(restartTrace.filter(item=>item.action==='workspace.members.commit').length,0);if(lost)assert.ok(restartTrace.some(item=>item.action==='workspace.members.receipt'&&item.input.commandId===lost!.commandId));
  await detail().scrollIntoViewIfNeeded();await screenshot('restored');await selectWorkspace('b');assert.equal(await draft().inputValue(),data.otherDraft);await selectWorkspace('a');assert.deepEqual(pageErrors,[]);assert.deepEqual(transportErrors,[]);assert.deepEqual(dialogs,[]);assert.deepEqual(probe.requests,[]);
  report={packagedExe:exe,mode,realDesktop:true,modelRequests:probe.requests.length,modelConfigured:'explicit local HTTP probe, auth none; no model response supplied',modelRuns:0,workspaceId:seeded.entry.id,otherWorkspaceId:seeded.other.id,firstMemberId:firstId,registeredPositions:finalList.total,registryRevision:finalList.registryCursor?.seq,commitsBeforeRestart,restartCommitInvocations:0,registryJournalHash:createHash('sha256').update(bytes).digest('hex'),registryJournalBytesUnchangedAfterRestart:true,knowledgeAndKnowledgeJournalsUnchangedByRegistration:true,executionStateUnchanged:true,ordinaryDraftsPreserved:true,otherWorkspaceRegistryEmpty:true,sourceChanges,responseLoss:lost?{kind:'test-only IPC reply dropped after real persisted registration',commandId:lost.commandId,memberId:lost.memberId,actualCommitInvocations:1,durableAuditRecords:1,reopenOnlyQueriedOriginal:true,explicitOriginalQuery:true}:undefined,pageErrors,transportErrors,dialogs,screenshots,limitations:['本片只登记岗位；未创建或执行任务，不把 active 状态解释为实际可执行。','本机模型 HTTP 地址仅计数；模型请求为零，不代表在线模型能力验证。'],cleanup};
}catch(error){keepTemp=true;await fs.mkdir('test-results',{recursive:true});const dom=desktop?await desktop.firstWindow().then(p=>p.locator('body').innerText()).catch(()=>undefined):undefined;if(desktop)await desktop.firstWindow().then(p=>p.screenshot({path:`test-results/${artifact}-failure.png`})).catch(()=>{});await fs.writeFile(`test-results/${artifact}-ui-failure.json`,JSON.stringify({packagedExe:exe,temp,mode,error:String(error),dom,pageErrors,transportErrors,dialogs,modelRequests:probe.requests.length},null,2));throw error}
finally{
  if(desktop){await desktop.close();desktop=undefined}cleanup.desktopClosed=true;if(setup)await setup.shutdown();await probe.close();cleanup.probeClosed=true;
  if(!keepTemp){const target=path.resolve(temp);assert.equal(path.dirname(target),path.resolve(os.tmpdir()));assert.ok(path.basename(target).startsWith('cbim-workspace-member-ui-'));const info=await fs.lstat(target);assert.equal(info.isSymbolicLink(),false);await fs.rm(target,{recursive:true,force:true});cleanup.tempRemoved=true}
  if(report&&report.phase!=='reopening'){await fs.writeFile(`test-results/${artifact}-ui-smoke.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report))}
}
