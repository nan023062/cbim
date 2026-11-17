// logic/team/service: module-owned integration coverage; keep the original scenario and cleanup semantics.
import {registerServiceOwner} from './support/owner-service-fixture';
import fs from 'node:fs/promises';
import path from 'node:path';
import {expect,it} from 'vitest';
import {fixture} from '../../../application/unittest/support/helpers';
import {request} from '../../../knowledge/rules/unittest/data/knowledge';
import {seedTeam} from '../../../knowledge/service/unittest/support/team-fixture';
import {hash,json} from '../../../../core/platform/node/serialization';
import type {WorkflowSelection} from '../../../tasks/rules/workflow-selection';
import {FileDispatchStore} from '../../../dispatch/storage/dispatch-store';
import {WorkspaceDispatchService} from '../../../dispatch/runtime/dispatch-service';
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

it('主角色可保留模块治理分工，但不能登记业务Workflow选择或借此生成派发事实',async()=>{
  const f=await setup();try{
    const input={expectedRevision:1,objective:'治理模块知识',constraints:[],criteria:[{id:'governed',text:'知识变更有真实提交回执',kind:'evidence' as const}],assignments:[{agentId:'cbim:main',moduleIds:f.moduleIds,criterionIds:['governed'],reason:'主角色维护知识'}],reason:'受控知识治理'},before=await f.store.Read();
    await expect(f.service.goals.Plan(f.identity,f.scopeId,f.runId,'invalid-main-workflow',{...input,assignments:[{...input.assignments[0],workflowSelections:f.selections}]})).rejects.toMatchObject({code:'GOAL_INPUT_INVALID'});
    expect(await f.store.Read()).toEqual(before);
    const saved=await f.service.goals.Plan(f.identity,f.scopeId,f.runId,'main-knowledge-plan',input);
    expect(saved.goal!.plan!.assignments[0]).toMatchObject(input.assignments[0]);expect(saved.goal!.plan!.assignments[0]).not.toHaveProperty('workflowSelections');
    const after=await f.store.Read();expect(after.graphs).toEqual(before.graphs);expect(after.runs).toEqual(before.runs);expect(after.outbox).toEqual(before.outbox);
  }finally{await f.cleanup()}
});
