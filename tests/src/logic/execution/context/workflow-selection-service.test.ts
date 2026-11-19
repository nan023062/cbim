// logic/execution/context: module-owned integration coverage; keep the original scenario and cleanup semantics.
import {registerServiceOwner} from '../../team/service/support/owner-service-fixture';
import fs from 'node:fs/promises';
import path from 'node:path';
import {expect,it} from 'vitest';
import {fixture} from '../../application/support/helpers';
import {request} from '../../knowledge/rules/data/knowledge';
import {seedTeam} from '../../knowledge/service/support/team-fixture';
import {hash,json} from '../../../../../src/core/io/serialization';
import type {WorkflowSelection} from '../../../../../src/logic/tasks/rules/workflow-selection';
import {FileDispatchStore} from '../../../../../src/logic/dispatch/storage/dispatch-store';
import {WorkspaceDispatchService} from '../../../../../src/logic/dispatch/runtime/dispatch-service';
import {resolveDispatchModules} from '../../../../../src/logic/execution/context/dispatch-context';
import {prepareDispatchExecutionContext,memberExecutionPrompt} from '../../../../../src/logic/execution/context/execution-context';
import {DispatchTools} from '../../../../../src/logic/tools/runtime/dispatch-tools';
import {mainToolCommandId} from '../../../../../src/logic/tools/runtime/main-tool-contracts';

async function setup(){
  const f=await fixture();
  try{
    const entry=await f.app.Dispatch('add',{path:f.a}),workspace=f.app.Workspace(entry.id),team=await seedTeam(workspace);
    const before=await workspace.Snapshot(),body='# 第二流程\n\n```cbim-workflow\n'+JSON.stringify({version:1,beforeEffects:{requirePlan:true},delivery:{requiredToolEvidence:[{id:'read-proof',toolName:'read'}]}})+'\n```\n';
    const preview=await team.call('cbim_object_preview',{revision:before.revision,operations:[{kind:'workflow',action:'create',parentId:team.input.moduleId,slug:'verify_second',data:{name:'第二核实流程'},body}]});
    await team.call('cbim_object_commit',{planId:preview.planId},true);const secondId=preview.objects[0] as string;
    const snapshot=await workspace.Snapshot(),moduleIds=[team.input.moduleId,team.child];
    const changes=moduleIds.map((moduleId,index)=>{
      const definition=JSON.parse(snapshot.files.find(file=>file.path===moduleId+'/module.json')!.text);
      definition.maintenance={bindingId:'workflow-owner-'+index,maintainerPersonIds:['owner'],revision:1,state:'active',confirmation:{recordId:'workflow-review-'+index,source:'local_user',confirmedAt:'2026-11-07T00:00:00.000Z'}};
      return {path:moduleId+'/module.json',text:json(definition)};
    });
    await workspace.Commit(request(snapshot,[{path:'.cbim/team/people.json',text:json({people:[{id:'owner',name:'维护人',team:'.cbim/team'}]})},...changes]));
    const {registered}=await registerServiceOwner(f.app,workspace,'.cbim/team/dev',moduleIds);
    const store=workspace.dispatchStore,directory=store.directory,service=new WorkspaceDispatchService(workspace,store,undefined,undefined,undefined,f.app.engineModels),identity={workspaceId:entry.id,rootSessionId:'workflow-root'},scopeId='workflow-scope',runId='workflow-main';
    await service.OpenScope(identity,scopeId,{message:'选择正确流程核实模块'},runId);
    const ownerSelection=(await service.owners.Discover(moduleIds)).groups[0].selection!;
    const selections:WorkflowSelection[]=[{moduleId:team.input.moduleId,workflowId:secondId}];
    const task={assigneeAgentId:'.cbim/team/dev',moduleIds,ownerSelection,goal:'按已选择流程核实两个模块',acceptance:[{id:'verified',text:'提供真实结果'}],prerequisites:[]};
    const plan=(workflowSelections?:WorkflowSelection[],expectedRevision=1,commandId='workflow-plan')=>service.goals.Plan(identity,scopeId,runId,commandId,{expectedRevision,objective:'核实目标模块',constraints:[],criteria:[{id:'verified',text:'提供真实结果',kind:'evidence'}],assignments:[{agentId:task.assigneeAgentId,moduleIds,ownerSelection,criterionIds:['verified'],reason:'按模块执行',...(workflowSelections?{workflowSelections}:{})}],reason:'冻结本次流程选择'});
    const command=(workflowSelections?:WorkflowSelection[],commandId='workflow-dispatch')=>({...identity,commandId,expectedParentRevision:1,task:{...task,...(workflowSelections?{workflowSelections}:{})}});
    return {...f,entry,workspace,team,member:registered.member,secondId,body,moduleIds,selections,directory,store,service,identity,scopeId,runId,task,plan,command,cleanup:async()=>{await service.Close();await f.cleanup()}};
  }catch(error){await f.cleanup();throw error}
}

it('显式第二流程与部分覆盖按真实模块解析，未选模块维持首项或general，执行准备冻结该正文及约定',async()=>{
  const f=await setup();try{
    const snapshot=await f.workspace.Snapshot(),defaults=await resolveDispatchModules(snapshot,f.moduleIds),selected=await resolveDispatchModules(snapshot,f.moduleIds,f.selections);
    expect(defaults[0].workflow.id).toBe(f.team.input.workflowId);expect(defaults[1].workflow.kind).toBe('general');
    expect(selected[0].workflow).toEqual({kind:'module',id:f.secondId,version:hash(f.body)});expect(selected[1]).toEqual(defaults[1]);
    await f.plan(f.selections);const receipt=await f.service.DispatchTask(f.command(f.selections),f.scopeId),task=(await f.service.Snapshot(f.identity)).tasks.find(task=>task.taskId===receipt.taskId)!;
    const prepared=await prepareDispatchExecutionContext(f.workspace,task,undefined,f.member);
    expect(prepared.modules[0]).toMatchObject({binding:selected[0],workflowText:f.body,workflowContract:{version:1,beforeEffects:{requirePlan:true}}});expect(prepared.modules[1].binding).toEqual(defaults[1]);
    expect(prepared.modules[1].availableWorkflows?.map(workflow => workflow.skillId)).toEqual([f.team.input.workflowId, f.secondId]);
    expect(prepared.modules[1].workflowContract).toBeUndefined();
    expect(memberExecutionPrompt(prepared,task)).toContain(f.secondId);expect(task.workflowSelections).toEqual(f.selections);
    const forged={...task,workflowSelections:[{moduleId:f.team.input.moduleId,workflowId:f.team.input.workflowId}]};
    await expect(prepareDispatchExecutionContext(f.workspace,forged,undefined,f.member)).rejects.toThrow(/Workflow/);
    expect(()=>memberExecutionPrompt(prepared,forged)).toThrow(/Workflow/);
  }finally{await f.cleanup()}
});

it('跨模块、重复、未挂载、强制general和任意正文选择整体拒绝，不生成派发事实',async()=>{
  const f=await setup();try{
    const snapshot=await f.workspace.Snapshot(),before=await f.store.Read();
    const inherited = await resolveDispatchModules(snapshot, [f.team.child], [{moduleId:f.team.child,workflowId:f.secondId}]);
    expect(inherited[0].workflow.id).toBe(f.secondId);
    for(const selection of [
      [{moduleId:f.team.child,workflowId:'.cbim/workspace/other/workflows/external'}],
      [...f.selections,...f.selections],
      [{moduleId:'.cbim/workspace/outside',workflowId:f.secondId}],
      [{moduleId:f.team.input.moduleId,workflowId:f.secondId+'/workflow.md'}],
      [{moduleId:f.team.input.moduleId,workflowId:'cbim:general'}],
    ])await expect(resolveDispatchModules(snapshot,f.moduleIds,selection)).rejects.toThrow(/Workflow/);
    await expect(f.plan([{moduleId:f.team.child,workflowId:'.cbim/workspace/other/workflows/external'}])).rejects.toThrow(/Workflow/);
    await expect(f.service.DispatchTask({...f.command(f.selections),task:{...f.command(f.selections).task,workflowSelections:[{...f.selections[0],body:'untrusted'}]}},f.scopeId)).rejects.toThrow(/输入|参数|body/);
    expect(await f.store.Read()).toEqual(before);
  }finally{await f.cleanup()}
});

it.each(['body','unmount','reorder'] as const)('派发后知识%s变化不刷新原绑定或回退，已提交请求仍只返回原回执',async mutation=>{
  const f=await setup();try{
    await f.plan(f.selections);const command=f.command(f.selections),receipt=await f.service.DispatchTask(command,f.scopeId),task=(await f.service.Snapshot(f.identity)).tasks[0],snapshot=await f.workspace.Snapshot(),modulePath=f.team.input.moduleId+'/module.json',definition=JSON.parse(snapshot.files.find(file=>file.path===modulePath)!.text);
    // 真实知识事务不允许留下孤立流程正文；卸载须连同原正文删除，不能靠非法 fixture 绕过规则。
    const changes=mutation==='body'?[{path:f.secondId+'/workflow.md',text:f.body+'\n流程补充\n'}]:(definition.workflows=mutation==='unmount'?definition.workflows.slice(0,1):[...definition.workflows].reverse(),[{path:modulePath,text:json(definition)},...(mutation==='unmount'?[{path:f.secondId+'/workflow.md',text:null}]:[])]);
    await f.workspace.Commit(request(snapshot,changes));await expect(prepareDispatchExecutionContext(f.workspace,task,undefined,f.member)).rejects.toThrow(/知识版本已经变化/);
    expect(await f.service.DispatchTask(command,f.scopeId)).toEqual(receipt);expect((await f.service.Snapshot(f.identity)).tasks[0]).toEqual(task);
    if(mutation==='unmount')await expect(resolveDispatchModules(await f.workspace.Snapshot(),f.moduleIds,f.selections)).rejects.toThrow(/Workflow/);
  }finally{await f.cleanup()}
});
