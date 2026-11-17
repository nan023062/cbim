// logic/dispatch/runtime: module-owned integration coverage; keep the original scenario and cleanup semantics.
import {registerServiceOwner} from '../../../team/service/unittest/support/owner-service-fixture';
import fs from 'node:fs/promises';
import path from 'node:path';
import {expect,it} from 'vitest';
import {fixture} from '../../../application/unittest/support/helpers';
import {request} from '../../../knowledge/rules/unittest/data/knowledge';
import {seedTeam} from '../../../knowledge/service/unittest/support/team-fixture';
import {hash,json} from '../../../../core/platform/node/serialization';
import type {WorkflowSelection} from '../../../tasks/rules/workflow-selection';
import {FileDispatchStore} from '../../storage/dispatch-store';
import {WorkspaceDispatchService} from '../dispatch-service';
import {resolveDispatchModules} from '../../../execution/context/dispatch-context';
import {prepareDispatchExecutionContext,memberExecutionPrompt} from '../../../execution/context/execution-context';
import {DispatchTools} from '../../../tools/runtime/dispatch-tools';
import {mainToolCommandId} from '../../../tools/runtime/main-tool-contracts';

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

it('持久派发原选择进入幂等指纹和重开记录，相同命令改选不能创建另一实例',async()=>{
  const f=await setup();try{
    await f.plan(f.selections);const command=f.command(f.selections),receipt=await f.service.DispatchTask(command,f.scopeId),before=await f.store.Read(),journal=await fs.readFile(path.join(f.directory,'dispatch.jsonl'),'utf8');
    expect(before.graphs[0].tasks[0].workflowSelections).toEqual(f.selections);expect(await f.service.DispatchTask(command,f.scopeId)).toEqual(receipt);
    await expect(f.service.DispatchTask(f.command([{moduleId:f.team.input.moduleId,workflowId:f.team.input.workflowId}]),f.scopeId)).rejects.toMatchObject({code:'COMMAND_ID_CONFLICT'});
    expect(await fs.readFile(path.join(f.directory,'dispatch.jsonl'),'utf8')).toBe(journal);expect(await f.store.Read()).toEqual(before);
    const reader=new FileDispatchStore(f.directory,f.entry.id),restored=new WorkspaceDispatchService(f.workspace,reader);try{expect(await reader.Read()).toEqual(before);expect(await restored.DispatchTask(command,f.scopeId)).toEqual(receipt)}finally{await restored.Close()}
  }finally{await f.cleanup()}
});

it('目标分配区分缺省与显式首项，派发不准把缺省当通配或独立改选',async()=>{
  const f=await setup();try{
    await f.plan();const before=await f.store.Read(),first=[{moduleId:f.team.input.moduleId,workflowId:f.team.input.workflowId}];
    for(const selected of [first,f.selections])await expect(f.service.DispatchTask(f.command(selected),f.scopeId)).rejects.toMatchObject({code:'GOAL_ASSIGNMENT_MISMATCH'});
    expect(await f.store.Read()).toEqual(before);await f.service.DispatchTask(f.command(undefined,'old-default'),f.scopeId);
    expect((await f.service.Snapshot(f.identity)).tasks[0]).not.toHaveProperty('workflowSelections');
    await f.plan(f.selections,2,'select-second');const planned=await f.store.Read();
    await expect(f.service.DispatchTask(f.command(undefined,'new-default'),f.scopeId)).rejects.toMatchObject({code:'GOAL_ASSIGNMENT_MISMATCH'});expect(await f.store.Read()).toEqual(planned);
    const selected=await f.service.DispatchTask(f.command(f.selections,'new-second'),f.scopeId);expect((await f.service.Snapshot(f.identity)).tasks.find(task=>task.taskId===selected.taskId)?.workflowSelections).toEqual(f.selections);
  }finally{await f.cleanup()}
});
