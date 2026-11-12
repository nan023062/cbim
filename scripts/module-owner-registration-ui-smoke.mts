import {clickKnowledgeTreeAction,clickArchitectureAction} from './knowledge-tree-actions.mjs';
import {_electron as electron,type ElectronApplication,type Page} from 'playwright-core';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {Application} from '../src/backend/main/assembly/application';
import {Paths} from '../src/backend/main/platform/paths';
import type {Snapshot} from '../src/bridge/contracts/workspace';
import {workspaceMemberListSchema} from '../src/bridge/contracts/workspace-members';
import {moduleOwnershipDetailSchema} from '../src/bridge/contracts/module-ownership';
import {seedWorkspaceMembers,workspaceMemberHttpProbe,workspaceMemberRunFiles} from '../tests/workspace-member-fixture';
import {latestExecutable} from './build-artifact.mjs';

// Issue #9: start with actual static Agents and zero registered positions. Every write uses the packaged UI and real IPC.
// --unknown discards one reply after the real position commit; lookup and manual return must not register twice.
const mode=process.argv.includes('--unknown')?'unknown':'complete';
const artifact=`module-owner-registration-${mode}`,exe=await latestExecutable();
const temp=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-owner-registration-')),user=path.join(temp,'user');
const probe=await workspaceMemberHttpProbe(),pageErrors:string[]=[],screenshots:string[]=[];
let setup:Application|undefined,desktop:ElectronApplication|undefined,page!:Page,keepTemp=false,reopened=false;
let report:Record<string,unknown>|undefined;
try{
  await fs.mkdir('test-results',{recursive:true});
  setup=new Application(new Paths(user,path.resolve('.')),path.resolve('design'));await setup.init();
  const seeded=await seedWorkspaceMembers(setup,temp,probe.url),id=seeded.entry.id,moduleId=seeded.team.input.moduleId;
  await setup.shutdown();setup=undefined;
  const launch=async()=>{
    desktop=await electron.launch({executablePath:exe,env:{...process.env,CBIM_USER_DATA_ROOT:user},timeout:60000});
    page=await desktop.firstWindow();page.setDefaultTimeout(30000);page.on('pageerror',error=>pageErrors.push(error.message));
    await desktop.evaluate(({ipcMain},drop)=>{
      const host=globalThis as any,handlers=(ipcMain as any)._invokeHandlers,original=handlers.get('cbim:call');
      if(!original)throw Error('Real IPC handler missing');host.__registrationTrace=[];let lost=false;
      handlers.set('cbim:call',async(event:unknown,action:string,input:unknown)=>{
        if(action.startsWith('workspace.ownerships.')||action.startsWith('workspace.members.'))host.__registrationTrace.push({action,input:structuredClone(input)});
        if(action==='workspace.members.list'&&host.__registrationFailRead){host.__registrationFailRead=false;return {ok:false,error:{code:'TEST_MEMBER_LIST',message:'测试岗位列表读取失败'}}}
        const result=await original(event,action,input);
        if(drop&&!lost&&action==='workspace.members.commit'&&result.ok===true){lost=true;return {ok:false,error:{code:'TEST_RESPONSE_LOST',message:'测试丢弃一次已经真实保存的岗位回包'}}}
        return result;
      });
    },mode==='unknown'&&!reopened);
  };
  const call=<T=any,>(action:string,args:unknown={}):Promise<T>=>page.evaluate(({action,args})=>(window as any).cbim.call(action,args),{action,args});
  const until=async(check:()=>Promise<boolean>,label:string)=>{const end=Date.now()+45000;while(Date.now()<end){if(await check())return;await new Promise(resolve=>setTimeout(resolve,50))}throw Error('等待验收超时：'+label)};
  const view=()=>page.locator('.extension-area:not([hidden]) .extension-content:not([hidden])');
  const owners=()=>view().getByTestId('module-ownership-panel'),members=()=>view().getByTestId('workspace-members');
  const ownerSelect=()=>owners().getByRole('combobox',{name:'负责人岗位',exact:true});
  const snapshot=()=>call<Snapshot>('snapshot',{id});
  const identity=async()=>({workspaceId:id,instanceId:(await snapshot()).instanceId});
  const list=async()=>workspaceMemberListSchema.parse(await call('workspace.members.list',await identity()));
  const detail=async()=>moduleOwnershipDetailSchema.parse(await call('workspace.ownerships.get',{...await identity(),moduleId}));
  const trace=()=>desktop!.evaluate(()=>(globalThis as any).__registrationTrace as Array<{action:string}>);
  const commits=async(action:string)=>(await trace()).filter(item=>item.action===action).length;
  const capture=async(suffix:string)=>{const file=`test-results/${artifact}-${suffix}.png`;await ownerSelect().scrollIntoViewIfNeeded();await page.screenshot({path:file});screenshots.push(file)};
  const openOwners=async()=>{
    await page.getByRole('button',{name:'workspace-members-alpha · 运行中',exact:true}).click();
    const expand=page.getByRole('button',{name:'展开右侧扩展',exact:true});if(await expand.isVisible())await expand.click();
    const tab=page.getByRole('tab',{name:'业务架构',exact:true});
    if(await tab.count())await tab.click();else{await page.getByRole('button',{name:'新增扩展页签',exact:true}).click();await view().getByRole('button',{name:'打开业务架构',exact:true}).click()}
    await clickKnowledgeTreeAction(view(),'.cbim/workspace','负责人记录');
    const row=owners().locator(`[data-testid="module-ownership-row"][data-module-id="${moduleId}"]`);
    await until(()=>row.isEnabled(),'模块列表就绪');await row.click();await until(()=>ownerSelect().isEnabled(),'负责人选项就绪');
  };
  const assign=async(memberId:string)=>{
    await ownerSelect().selectOption(memberId);
    await owners().getByRole('textbox',{name:'负责人变更原因',exact:true}).fill('Issue #9：明确设置本模块负责人。');
    await owners().getByTestId('module-ownership-preview').click();await owners().getByTestId('module-ownership-commit').click();
    await until(async()=>(await detail()).view.binding?.ownerMemberId===memberId,'负责人已持久化');
    await until(()=>ownerSelect().isEnabled(),'责任提交后重新加载');
  };
  const register=async(agentId:string,name:string,expectedTotal:number)=>{
    await ownerSelect().selectOption('agent:'+agentId);await members().getByTestId('workspace-member-preview').waitFor();
    await until(()=>members().getByRole('combobox',{name:'静态 Agent',exact:true}).isEnabled(),'岗位登记表单就绪');
    assert.equal(await members().getByRole('combobox',{name:'静态 Agent',exact:true}).inputValue(),agentId);
    assert.equal(await members().getByRole('combobox',{name:'岗位模型',exact:true}).inputValue(),'');
    await members().getByRole('textbox',{name:'岗位名称',exact:true}).fill(name);
    await members().getByRole('textbox',{name:'岗位职责',exact:true}).fill('维护所选模块的实现与验证。');
    await members().getByRole('textbox',{name:'变更原因',exact:true}).fill('Issue #9：从模块负责人入口明确登记。');
    await members().getByRole('combobox',{name:'Agent Loop 引擎',exact:true}).selectOption('pi');
    await members().getByRole('combobox',{name:'岗位模型',exact:true}).selectOption(JSON.stringify([seeded.profileId,seeded.modelId]));
    await members().getByTestId('workspace-member-preview').click();await members().getByTestId('workspace-member-commit').waitFor();
    assert.equal((await list()).total,expectedTotal-1);const previousOwner=(await detail()).view.binding?.ownerMemberId;
    await members().getByTestId('workspace-member-commit').click();
    if(mode==='unknown'&&expectedTotal===1){
      await until(async()=>(await members().innerText()).includes('结果未确认'),'原岗位命令保持未知');
      assert.equal(await owners().count(),0);assert.equal((await detail()).view.binding?.ownerMemberId,previousOwner);
      const record=members().locator('[data-command-id]').last();await record.getByTestId('workspace-member-receipt-query').click();
      // 核实成功后提交记录会自动折叠；读取状态节点文本，不把折叠后的不可见文本当作尚未恢复。
      await until(async()=>await record.locator('strong').textContent()==='已受理','只读核实原岗位');
      assert.equal(await owners().count(),0);
      await members().getByRole('button',{name:'返回模块负责人',exact:true}).click();
    }else await owners().waitFor();
    await until(()=>ownerSelect().isEnabled(),'返回原模块并刷新岗位');
    const current=await list();assert.equal(current.total,expectedTotal);const registered=current.items.find(item=>item.name===name)!;
    assert.ok(registered);assert.equal(registered.agentId,agentId);assert.notEqual(registered.memberId,agentId);
    assert.equal((await detail()).view.binding?.ownerMemberId,previousOwner);
    if(mode!=='unknown'||expectedTotal!==1)assert.equal(await ownerSelect().inputValue(),registered.memberId);
    assert.equal(await commits('workspace.members.commit'),expectedTotal);
    return registered.memberId;
  };

  await launch();await openOwners();
  const before=await snapshot(),beforeRuns=await workspaceMemberRunFiles(user,[id,seeded.other.id]);
  assert.equal((await list()).total,0);assert.equal((await detail()).view.binding,null);
  assert.equal(await owners().getByTestId('module-ownership-no-members').count(),1);
  const options=await ownerSelect().locator('option').evaluateAll(nodes=>nodes.map(node=>(node as HTMLOptionElement).value));
  assert.ok(options.includes('agent:'+seeded.team.input.agentId));assert.ok(options.includes('agent:cbim:executor'));assert.ok(!options.includes('agent:cbim:main'));
  await capture('empty-project');

  await ownerSelect().selectOption('agent:cbim:executor');await members().getByTestId('workspace-member-preview').waitFor();
  await until(()=>members().getByTestId('workspace-member-preview').isEnabled(),'取消场景表单就绪');
  await members().getByTestId('workspace-member-preview').click();
  assert.equal(await members().getByRole('combobox',{name:'Agent Loop 引擎',exact:true}).evaluate(node=>(node as HTMLSelectElement).validity.valueMissing),true);
  assert.equal(await commits('workspace.members.preview'),0);assert.equal(await commits('workspace.members.commit'),0);
  await members().getByRole('button',{name:'返回模块负责人',exact:true}).click();
  await until(()=>ownerSelect().isEnabled(),'取消返回原模块');assert.equal((await list()).total,0);assert.equal((await detail()).view.binding,null);

  const first=await register(seeded.team.input.agentId,'Issue9 自定义负责人',1);await assign(first);
  const second=await register('cbim:executor','Issue9 内置执行负责人',2);await assign(second);
  await assign(first);assert.equal(await commits('workspace.members.commit'),2);assert.equal(await commits('workspace.ownerships.commit'),3);
  await desktop!.evaluate(()=>{(globalThis as any).__registrationFailRead=true});
  await owners().getByRole('button',{name:'重新核实模块与岗位',exact:true}).click();
  await until(async()=>(await owners().innerText()).includes('岗位列表无法核实'),'读取失败不当作空列表');
  assert.equal(await owners().getByTestId('module-ownership-no-members').count(),0);
  assert.equal(await ownerSelect().locator('optgroup').count(),0);
  await owners().getByRole('button',{name:'重新核实模块与岗位',exact:true}).click();await until(()=>ownerSelect().isEnabled(),'恢复读取');
  assert.equal(await ownerSelect().inputValue(),first);
  const after=await snapshot();assert.deepEqual(after.files,before.files);assert.equal(after.revision,before.revision);
  assert.deepEqual(await workspaceMemberRunFiles(user,[id,seeded.other.id]),beforeRuns);assert.equal(probe.requests.length,0);
  const saved=await detail(),journalFile=path.join(user,id,'dispatch','dispatch.jsonl'),journal=await fs.readFile(journalFile);
  assert.equal(saved.history.total,3);assert.deepEqual(saved.history.items.map(item=>item.ownerMemberId),[first,second,first]);
  await capture('assigned');await desktop!.close();desktop=undefined;reopened=true;
  await launch();await openOwners();assert.deepEqual((await detail()).view,saved.view);assert.equal(await ownerSelect().inputValue(),first);
  assert.equal((await list()).total,2);assert.deepEqual(await fs.readFile(journalFile),journal);
  assert.equal(await commits('workspace.members.commit'),0);assert.equal(await commits('workspace.ownerships.commit'),0);
  assert.deepEqual(pageErrors,[]);assert.equal(probe.requests.length,0);await capture('reopened');
  report={issue:9,mode,packagedExe:exe,realDesktop:true,zeroInitialPositions:true,staticAgentOptions:true,mainAgentExcluded:true,modelExplicit:true,cancelWrites:0,registeredPositions:2,ownershipCommits:3,existingPositionReused:true,readFailureNotEmpty:true,knowledgeUnchanged:true,modelRequests:0,restartWrites:0,responseLossRecoveredWithoutReplay:mode==='unknown',workspaceId:id,moduleId,memberIds:[first,second],pageErrors,screenshots};
}catch(error){
  keepTemp=true;const dom=page?await page.locator('body').innerText().catch(()=>undefined):undefined;
  if(page)await page.screenshot({path:`test-results/${artifact}-failure.png`}).catch(()=>{});
  await fs.writeFile(`test-results/${artifact}-failure.json`,JSON.stringify({error:String(error),temp,exe,mode,dom,pageErrors},null,2));throw error;
}finally{
  if(desktop)await desktop.close();if(setup)await setup.shutdown();await probe.close();
  if(!keepTemp){const target=path.resolve(temp);assert.equal(path.dirname(target),path.resolve(os.tmpdir()));assert.ok(path.basename(target).startsWith('cbim-owner-registration-'));assert.equal((await fs.lstat(target)).isSymbolicLink(),false);await fs.rm(target,{recursive:true,force:true,maxRetries:6,retryDelay:200})}
  if(report){await fs.writeFile(`test-results/${artifact}-ui-smoke.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report))}
}
