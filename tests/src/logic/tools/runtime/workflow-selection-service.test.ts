// logic/tools/runtime: module-owned integration coverage; keep the original scenario and cleanup semantics.
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

it('主工具严格公布并传递选择，跨模块和额外字段在实际端口前拒绝',async()=>{
  const f=await setup();try{
    await f.plan(f.selections);let calls=0;
    const binding={...f.identity,scopeId:f.scopeId,runId:f.runId},tools=new DispatchTools({binding,Dispatch:async(task,invocation)=>{calls++;return f.service.DispatchTask({...f.command(),commandId:mainToolCommandId('cbim_dispatch_task',binding,invocation.toolCallId),task},f.scopeId)},Inspect:()=>f.service.Snapshot(f.identity)}),signal=new AbortController().signal;
    const {assigneeAgentId,...task}=f.command(f.selections).task,input={...task,agentId:assigneeAgentId};
    expect(tools.List().find(tool=>tool.name==='cbim_dispatch_task')!.inputSchema.properties).toHaveProperty('workflowSelections');
    for(const workflowSelections of [[{...f.selections[0],moduleId:'foreign'}],[{...f.selections[0],version:'forged'}]])await expect(tools.Call('cbim_dispatch_task',{...input,workflowSelections},signal,'invalid')).rejects.toMatchObject({code:'DISPATCH_TOOL_INPUT_INVALID'});
    expect(calls).toBe(0);await tools.Call('cbim_dispatch_task',input,signal,'dispatch');expect(calls).toBe(1);expect((await f.service.Snapshot(f.identity)).tasks[0].workflowSelections).toEqual(f.selections);
  }finally{await f.cleanup()}
});
