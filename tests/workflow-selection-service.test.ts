import {registerServiceOwner} from './owner-service-fixture';
import fs from 'node:fs/promises';
import path from 'node:path';
import {expect,it} from 'vitest';
import {fixture} from './helpers';
import {request} from './data/knowledge';
import {seedTeam} from './team-fixture';
import {hash,json} from '../src/core/platform/node/serialization';
import type {WorkflowSelection} from '../src/logic/tasks/rules/workflow-selection';
import {FileDispatchStore} from '../src/backend/main/dispatch-storage/dispatch-store';
import {WorkspaceDispatchService} from '../src/logic/dispatch/runtime/dispatch-service';
import {resolveDispatchModules} from '../src/logic/execution/context/dispatch-context';
import {prepareDispatchExecutionContext,memberExecutionPrompt} from '../src/logic/execution/context/execution-context';
import {DispatchTools} from '../src/logic/tools/runtime/dispatch-tools';
import {mainToolCommandId} from '../src/logic/tools/runtime/main-tool-contracts';

async function setup(){
  const f=await fixture();
  try{
    const entry=await f.app.dispatch('add',{path:f.a}),workspace=f.app.workspace(entry.id),team=await seedTeam(workspace);
    const before=await workspace.snapshot(),body='# 第二流程\n\n```cbim-workflow\n'+JSON.stringify({version:1,beforeEffects:{requirePlan:true},delivery:{requiredToolEvidence:[{id:'read-proof',toolName:'read'}]}})+'\n```\n';
    const preview=await team.call('cbim_object_preview',{revision:before.revision,operations:[{kind:'workflow',action:'create',parentId:team.input.moduleId,slug:'verify_second',data:{name:'第二核实流程'},body}]});
    await team.call('cbim_object_commit',{planId:preview.planId},true);const secondId=preview.objects[0] as string;
    const snapshot=await workspace.snapshot(),moduleIds=[team.input.moduleId,team.child];
    const changes=moduleIds.map((moduleId,index)=>{
      const definition=JSON.parse(snapshot.files.find(file=>file.path===moduleId+'/module.json')!.text);
      definition.maintenance={bindingId:'workflow-owner-'+index,maintainerPersonIds:['owner'],revision:1,state:'active',confirmation:{recordId:'workflow-review-'+index,source:'local_user',confirmedAt:'2026-11-07T00:00:00.000Z'}};
      return {path:moduleId+'/module.json',text:json(definition)};
    });
    await workspace.commit(request(snapshot,[{path:'.cbim/team/people.json',text:json({people:[{id:'owner',name:'维护人',team:'.cbim/team'}]})},...changes]));
    const {registered}=await registerServiceOwner(f.app,workspace,'.cbim/team/dev',moduleIds);
    const store=workspace.dispatchStore,directory=store.directory,service=new WorkspaceDispatchService(workspace,store,undefined,undefined,undefined,f.app.models),identity={workspaceId:entry.id,rootSessionId:'workflow-root'},scopeId='workflow-scope',runId='workflow-main';
    await service.openScope(identity,scopeId,{message:'选择正确流程核实模块'},runId);
    const ownerSelection=(await service.owners.discover(moduleIds)).groups[0].selection!;
    const selections:WorkflowSelection[]=[{moduleId:team.input.moduleId,workflowId:secondId}];
    const task={assigneeAgentId:'.cbim/team/dev',moduleIds,ownerSelection,goal:'按已选择流程核实两个模块',acceptance:[{id:'verified',text:'提供真实结果'}],prerequisites:[]};
    const plan=(workflowSelections?:WorkflowSelection[],expectedRevision=1,commandId='workflow-plan')=>service.goals.plan(identity,scopeId,runId,commandId,{expectedRevision,objective:'核实目标模块',constraints:[],criteria:[{id:'verified',text:'提供真实结果',kind:'evidence'}],assignments:[{agentId:task.assigneeAgentId,moduleIds,ownerSelection,criterionIds:['verified'],reason:'按模块执行',...(workflowSelections?{workflowSelections}:{})}],reason:'冻结本次流程选择'});
    const command=(workflowSelections?:WorkflowSelection[],commandId='workflow-dispatch')=>({...identity,commandId,expectedParentRevision:1,task:{...task,...(workflowSelections?{workflowSelections}:{})}});
    return {...f,entry,workspace,team,member:registered.member,secondId,body,moduleIds,selections,directory,store,service,identity,scopeId,runId,task,plan,command,cleanup:async()=>{await service.close();await f.cleanup()}};
  }catch(error){await f.cleanup();throw error}
}

it('显式第二流程与部分覆盖按真实模块解析，未选模块维持首项或general，执行准备冻结该正文及约定',async()=>{
  const f=await setup();try{
    const snapshot=await f.workspace.snapshot(),defaults=await resolveDispatchModules(snapshot,f.moduleIds),selected=await resolveDispatchModules(snapshot,f.moduleIds,f.selections);
    expect(defaults[0].workflow.id).toBe(f.team.input.workflowId);expect(defaults[1].workflow.kind).toBe('general');
    expect(selected[0].workflow).toEqual({kind:'module',id:f.secondId,version:hash(f.body)});expect(selected[1]).toEqual(defaults[1]);
    await f.plan(f.selections);const receipt=await f.service.dispatchTask(f.command(f.selections),f.scopeId),task=(await f.service.snapshot(f.identity)).tasks.find(task=>task.taskId===receipt.taskId)!;
    const prepared=await prepareDispatchExecutionContext(f.workspace,task,undefined,f.member);
    expect(prepared.modules[0]).toMatchObject({binding:selected[0],workflowText:f.body,workflowContract:{version:1,beforeEffects:{requirePlan:true}}});expect(prepared.modules[1].binding).toEqual(defaults[1]);
    expect(memberExecutionPrompt(prepared,task)).toContain(f.secondId);expect(task.workflowSelections).toEqual(f.selections);
    const forged={...task,workflowSelections:[{moduleId:f.team.input.moduleId,workflowId:f.team.input.workflowId}]};
    await expect(prepareDispatchExecutionContext(f.workspace,forged,undefined,f.member)).rejects.toMatchObject({code:'WORKFLOW_SELECTION_INVALID'});
    expect(()=>memberExecutionPrompt(prepared,forged)).toThrowError(expect.objectContaining({code:'WORKFLOW_SELECTION_INVALID'}));
  }finally{await f.cleanup()}
});

it('跨模块、重复、未挂载、强制general和任意正文选择整体拒绝，不生成派发事实',async()=>{
  const f=await setup();try{
    const snapshot=await f.workspace.snapshot(),before=await f.store.read();
    for(const selection of [
      [{moduleId:f.team.child,workflowId:f.secondId}],
      [...f.selections,...f.selections],
      [{moduleId:'.cbim/workspace/outside',workflowId:f.secondId}],
      [{moduleId:f.team.input.moduleId,workflowId:f.secondId+'/workflow.md'}],
      [{moduleId:f.team.input.moduleId,workflowId:'cbim:general'}],
    ])await expect(resolveDispatchModules(snapshot,f.moduleIds,selection)).rejects.toMatchObject({code:'WORKFLOW_SELECTION_INVALID'});
    await expect(f.plan([{moduleId:f.team.child,workflowId:f.secondId}])).rejects.toMatchObject({code:'WORKFLOW_SELECTION_INVALID'});
    await expect(f.service.dispatchTask({...f.command(f.selections),task:{...f.command(f.selections).task,workflowSelections:[{...f.selections[0],body:'untrusted'}]}},f.scopeId)).rejects.toMatchObject({code:'GRAPH_INPUT_INVALID'});
    expect(await f.store.read()).toEqual(before);
  }finally{await f.cleanup()}
});

it('持久派发原选择进入幂等指纹和重开记录，相同命令改选不能创建另一实例',async()=>{
  const f=await setup();try{
    await f.plan(f.selections);const command=f.command(f.selections),receipt=await f.service.dispatchTask(command,f.scopeId),before=await f.store.read(),journal=await fs.readFile(path.join(f.directory,'dispatch.jsonl'),'utf8');
    expect(before.graphs[0].tasks[0].workflowSelections).toEqual(f.selections);expect(await f.service.dispatchTask(command,f.scopeId)).toEqual(receipt);
    await expect(f.service.dispatchTask(f.command([{moduleId:f.team.input.moduleId,workflowId:f.team.input.workflowId}]),f.scopeId)).rejects.toMatchObject({code:'COMMAND_ID_CONFLICT'});
    expect(await fs.readFile(path.join(f.directory,'dispatch.jsonl'),'utf8')).toBe(journal);expect(await f.store.read()).toEqual(before);
    const reader=new FileDispatchStore(f.directory,f.entry.id),restored=new WorkspaceDispatchService(f.workspace,reader);try{expect(await reader.read()).toEqual(before);expect(await restored.dispatchTask(command,f.scopeId)).toEqual(receipt)}finally{await restored.close()}
  }finally{await f.cleanup()}
});

it('目标分配区分缺省与显式首项，派发不准把缺省当通配或独立改选',async()=>{
  const f=await setup();try{
    await f.plan();const before=await f.store.read(),first=[{moduleId:f.team.input.moduleId,workflowId:f.team.input.workflowId}];
    for(const selected of [first,f.selections])await expect(f.service.dispatchTask(f.command(selected),f.scopeId)).rejects.toMatchObject({code:'GOAL_ASSIGNMENT_MISMATCH'});
    expect(await f.store.read()).toEqual(before);await f.service.dispatchTask(f.command(undefined,'old-default'),f.scopeId);
    expect((await f.service.snapshot(f.identity)).tasks[0]).not.toHaveProperty('workflowSelections');
    await f.plan(f.selections,2,'select-second');const planned=await f.store.read();
    await expect(f.service.dispatchTask(f.command(undefined,'new-default'),f.scopeId)).rejects.toMatchObject({code:'GOAL_ASSIGNMENT_MISMATCH'});expect(await f.store.read()).toEqual(planned);
    const selected=await f.service.dispatchTask(f.command(f.selections,'new-second'),f.scopeId);expect((await f.service.snapshot(f.identity)).tasks.find(task=>task.taskId===selected.taskId)?.workflowSelections).toEqual(f.selections);
  }finally{await f.cleanup()}
});

it('主角色可保留模块治理分工，但不能登记业务Workflow选择或借此生成派发事实',async()=>{
  const f=await setup();try{
    const input={expectedRevision:1,objective:'治理模块知识',constraints:[],criteria:[{id:'governed',text:'知识变更有真实提交回执',kind:'evidence' as const}],assignments:[{agentId:'cbim:main',moduleIds:f.moduleIds,criterionIds:['governed'],reason:'主角色维护知识'}],reason:'受控知识治理'},before=await f.store.read();
    await expect(f.service.goals.plan(f.identity,f.scopeId,f.runId,'invalid-main-workflow',{...input,assignments:[{...input.assignments[0],workflowSelections:f.selections}]})).rejects.toMatchObject({code:'GOAL_INPUT_INVALID'});
    expect(await f.store.read()).toEqual(before);
    const saved=await f.service.goals.plan(f.identity,f.scopeId,f.runId,'main-knowledge-plan',input);
    expect(saved.goal!.plan!.assignments[0]).toMatchObject(input.assignments[0]);expect(saved.goal!.plan!.assignments[0]).not.toHaveProperty('workflowSelections');
    const after=await f.store.read();expect(after.graphs).toEqual(before.graphs);expect(after.runs).toEqual(before.runs);expect(after.outbox).toEqual(before.outbox);
  }finally{await f.cleanup()}
});

it.each(['body','unmount','reorder'] as const)('派发后知识%s变化不刷新原绑定或回退，已提交请求仍只返回原回执',async mutation=>{
  const f=await setup();try{
    await f.plan(f.selections);const command=f.command(f.selections),receipt=await f.service.dispatchTask(command,f.scopeId),task=(await f.service.snapshot(f.identity)).tasks[0],snapshot=await f.workspace.snapshot(),modulePath=f.team.input.moduleId+'/module.json',definition=JSON.parse(snapshot.files.find(file=>file.path===modulePath)!.text);
    // 真实知识事务不允许留下孤立流程正文；卸载须连同原正文删除，不能靠非法 fixture 绕过规则。
    const changes=mutation==='body'?[{path:f.secondId+'/workflow.md',text:f.body+'\n流程补充\n'}]:(definition.workflows=mutation==='unmount'?definition.workflows.slice(0,1):[...definition.workflows].reverse(),[{path:modulePath,text:json(definition)},...(mutation==='unmount'?[{path:f.secondId+'/workflow.md',text:null}]:[])]);
    await f.workspace.commit(request(snapshot,changes));await expect(prepareDispatchExecutionContext(f.workspace,task,undefined,f.member)).rejects.toMatchObject({code:'KNOWLEDGE_CHANGED'});
    expect(await f.service.dispatchTask(command,f.scopeId)).toEqual(receipt);expect((await f.service.snapshot(f.identity)).tasks[0]).toEqual(task);
    if(mutation==='unmount')await expect(resolveDispatchModules(await f.workspace.snapshot(),f.moduleIds,f.selections)).rejects.toMatchObject({code:'WORKFLOW_SELECTION_INVALID'});
  }finally{await f.cleanup()}
});

it('主工具严格公布并传递选择，跨模块和额外字段在实际端口前拒绝',async()=>{
  const f=await setup();try{
    await f.plan(f.selections);let calls=0;
    const binding={...f.identity,scopeId:f.scopeId,runId:f.runId},tools=new DispatchTools({binding,dispatch:async(task,invocation)=>{calls++;return f.service.dispatchTask({...f.command(),commandId:mainToolCommandId('cbim_dispatch_task',binding,invocation.toolCallId),task},f.scopeId)},inspect:()=>f.service.snapshot(f.identity)}),signal=new AbortController().signal;
    const {assigneeAgentId,...task}=f.command(f.selections).task,input={...task,agentId:assigneeAgentId};
    expect(tools.list().find(tool=>tool.name==='cbim_dispatch_task')!.inputSchema.properties).toHaveProperty('workflowSelections');
    for(const workflowSelections of [[{...f.selections[0],moduleId:'foreign'}],[{...f.selections[0],version:'forged'}]])await expect(tools.call('cbim_dispatch_task',{...input,workflowSelections},signal,'invalid')).rejects.toMatchObject({code:'DISPATCH_TOOL_INPUT_INVALID'});
    expect(calls).toBe(0);await tools.call('cbim_dispatch_task',input,signal,'dispatch');expect(calls).toBe(1);expect((await f.service.snapshot(f.identity)).tasks[0].workflowSelections).toEqual(f.selections);
  }finally{await f.cleanup()}
});
