import {expect,it,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fixture} from './helpers';
import {request} from './data/knowledge';
import {seedTeam} from './team-fixture';
import {json} from '../src/backend/core/foundation/serialization';
import type {AddQueuedDependencyInput} from '../src/backend/core/tasks/queued-dependency-addition';
import type {DispatchMutation} from '../src/backend/core/dispatch/dispatch-storage';
import {FileDispatchStore} from '../src/backend/main/dispatch-storage/dispatch-store';
import {WorkspaceDispatchService} from '../src/backend/scheduler-engine/dispatch/dispatch-service';
import {DispatchTools} from '../src/backend/scheduler-engine/tools/dispatch-tools';
import {mainToolCommandId} from '../src/backend/scheduler-engine/tools/main-tool-contracts';
import {registerServiceOwner} from './owner-service-fixture';

function deferred(){let resolve!:()=>void;const promise=new Promise<void>(r=>{resolve=r});return {promise,resolve}}
async function setup(){
  const f=await fixture(),entry=await f.app.dispatch('add',{path:f.a}),workspace=f.app.workspace(entry.id),team=await seedTeam(workspace);
  const snapshot=await workspace.snapshot(),moduleId=team.input.moduleId,file=moduleId+'/module.json',definition=JSON.parse(snapshot.files.find(value=>value.path===file)!.text);
  definition.maintenance={bindingId:'maintain',maintainerPersonIds:['owner'],revision:1,state:'active',confirmation:{recordId:'review',source:'local_user',confirmedAt:'2026-11-06T00:00:00.000Z'}};
  await workspace.commit(request(snapshot,[{path:'.cbim/team/people.json',text:json({people:[{id:'owner',name:'维护人',team:'.cbim/team'}]})},{path:file,text:json(definition)}]));
  await registerServiceOwner(f.app,workspace,'.cbim/team/dev',[moduleId]);
  const store=workspace.dispatchStore,directory=store.directory,service=new WorkspaceDispatchService(workspace,store,undefined,undefined,undefined,f.app.models),identity={workspaceId:entry.id,rootSessionId:'addition-root'},scopeId='addition-scope',mainRunId='main-run';
  await service.openScope(identity,scopeId,{message:'为先创建的任务补充真实前置'},mainRunId);
  const ownerSelection=(await service.owners.discover([moduleId])).groups[0].selection!;
  const workflowSelections=[{moduleId,workflowId:team.input.workflowId}];
  await service.goals.plan(identity,scopeId,mainRunId,'plan-one',{expectedRevision:1,objective:'核实业务',constraints:[],criteria:[{id:'c1',kind:'evidence',text:'可追溯结果'}],assignments:[{agentId:'.cbim/team/dev',moduleIds:[moduleId],ownerSelection,workflowSelections,criterionIds:['c1'],reason:'按模块执行'}],reason:'计划'});
  const assign=async(commandId:string,prerequisites:{taskId:string;expectedPlanRevision:number}[]=[])=>service.dispatchTask({...identity,commandId,expectedParentRevision:1,task:{assigneeAgentId:'.cbim/team/dev',moduleIds:[moduleId],ownerSelection,workflowSelections,goal:commandId,acceptance:[{id:'c1',text:'真实证据'}],prerequisites}},scopeId);
  const b=await assign('B'),c=await assign('C',[{taskId:b.taskId,expectedPlanRevision:1}]),a=await assign('A'),d=await assign('D',[{taskId:a.taskId,expectedPlanRevision:1}]);
  const graph=await service.snapshot(identity),source=graph.tasks.find(task=>task.taskId===a.taskId)!,target=graph.tasks.find(task=>task.taskId===b.taskId)!;
  const input:AddQueuedDependencyInput={expectedGraphCursor:{streamId:graph.cursor.streamId,seq:graph.cursor.seq},expectedGoalRevision:2,source:{taskId:source.taskId,expectedRevision:source.revision,expectedPlanRevision:source.planRevision},target:{taskId:target.taskId,expectedRevision:target.revision,expectedPlanRevision:target.planRevision},reason:'先完成新发现的前置 A'};
  return {...f,entry,workspace,directory,store,service,identity,scopeId,mainRunId,source,target,c,d,graph,input,assign,
    add:(commandId='add-one',assertCurrent?:()=>void)=>service.addQueuedDependency(identity,scopeId,mainRunId,commandId,input,assertCurrent),
    cleanup:async()=>{await store.close();await f.cleanup()}};
}

it('真实存储追加后来创建的来源，保留两端后继原身份与信封，重复命令不重新准备',async()=>{
  const f=await setup();try{
    const before=await f.store.read(),receipt=await f.add(),after=await f.store.read(),updated=after.graphs[0].tasks.find(task=>task.taskId===f.target.taskId)!;
    expect(receipt.trackedTaskIds).toEqual([f.target.taskId,f.c.taskId,f.source.taskId,f.d.taskId]);
    expect(updated).toEqual({...f.target,revision:f.target.revision+1,status:'waiting',updatedAt:receipt.addition.addedAt,waitReason:'等待新增前置任务的有效结果',dependencyAdditions:[receipt.addition]});
    expect(after.graphs[0].edges.find(edge=>edge.edgeId===receipt.addition.dependency.edgeId)).toMatchObject({fromNodeId:f.source.nodeId,toNodeId:f.target.nodeId,revision:1,enabled:true,condition:{kind:'result_ready',planRevision:1}});
    const addedEdge=after.graphs[0].edges.find(edge=>edge.edgeId===receipt.addition.dependency.edgeId)!;
    expect(addedEdge.kind).toBe('dependency');if(addedEdge.kind==='dependency')expect(addedEdge.condition).not.toHaveProperty('resultId');
    expect(after.graphs[0].tasks.filter(task=>task.taskId!==f.target.taskId)).toEqual(before.graphs[0].tasks.filter(task=>task.taskId!==f.target.taskId));
    expect(after.runs).toEqual(before.runs);expect(after.outbox).toEqual(before.outbox);expect(after.sessions).toEqual(before.sessions);
    const prepare=vi.spyOn(f.workspace,'snapshot');expect(await f.add()).toEqual(receipt);expect(prepare).not.toHaveBeenCalled();prepare.mockRestore();
    await expect(f.service.addQueuedDependency(f.identity,f.scopeId,f.mainRunId,'add-one',{...f.input,reason:'改写原命令'})).rejects.toMatchObject({code:'COMMAND_ID_CONFLICT'});
    const reader=new FileDispatchStore(f.directory,f.entry.id);try{expect(await reader.read()).toEqual(after)}finally{await reader.close()}
  }finally{await f.cleanup()}
});

it.each(['stop','knowledge'] as const)('真实知识准备 await 期间 %s 会整体拒绝，不留下边、审计或信封变化',async mode=>{
  const f=await setup(),entered=deferred(),resume=deferred(),snapshot=f.workspace.withSourceSnapshot.bind(f.workspace);let stopped=false;
  try{
    const before=await f.store.read(),file=path.join(f.directory,'dispatch.jsonl'),bytes=await fs.readFile(file);
    const spy=vi.spyOn(f.workspace,'withSourceSnapshot').mockImplementationOnce(use=>snapshot(async value=>{entered.resolve();await resume.promise;return use(value)}));
    const adding=f.add('add-held',()=>{if(stopped)throw Object.assign(Error('主调度停止'),{code:'COLLABORATION_STOPPED'})});
    await entered.promise;
    if(mode==='stop')stopped=true;else await fs.writeFile(path.join(f.workspace.entry.path,'.cbim/README.md'),'# external change during preparation');
    resume.resolve();await expect(adding).rejects.toMatchObject({code:mode==='stop'?'COLLABORATION_STOPPED':'DEPENDENCY_KNOWLEDGE_STALE'});
    expect(await f.store.read()).toEqual(before);expect(await fs.readFile(file)).toEqual(bytes);spy.mockRestore();
  }finally{resume.resolve();await f.cleanup()}
});

it('知识已更新不能刷新原待办后继续追加前置',async()=>{
  const f=await setup();try{
    await f.workspace.commit(request(await f.workspace.snapshot(),[{path:'.cbim/README.md',text:'# changed before addition'}]));const before=await f.store.read();
    await expect(f.add()).rejects.toMatchObject({code:'DEPENDENCY_KNOWLEDGE_STALE'});expect(await f.store.read()).toEqual(before);
  }finally{await f.cleanup()}
});

it('通用 Store 不接受缺审计的新边，即使其余批次来自真实合法追加',async()=>{
  const f=await setup();try{
    const original=f.store.transact.bind(f.store);let mutation:DispatchMutation|undefined,command:Parameters<FileDispatchStore['transact']>[0]|undefined;
    const spy=vi.spyOn(f.store,'transact').mockImplementation(async(cmd,operation)=>{command=cmd;mutation=await operation(await f.store.read());throw Object.assign(Error('capture only'),{code:'TEST_CAPTURE'})});
    await expect(f.add()).rejects.toMatchObject({code:'TEST_CAPTURE'});spy.mockRestore();
    expect(mutation!.batch!.changes).toHaveLength(3);
    const broken=structuredClone(mutation!);for(const change of broken.batch!.changes)if(change.type==='task.upserted')delete change.task.dependencyAdditions;
    const before=await f.store.read();await expect(original(command!,async()=>broken)).rejects.toMatchObject({code:'GRAPH_INPUT_INVALID'});expect(await f.store.read()).toEqual(before);
    expect(await original(command!,async()=>mutation!)).toMatchObject({taskId:f.target.taskId,status:'waiting'});
  }finally{await f.cleanup()}
});

it.each(['identity','alias'] as const)('真实追加已经提交后 %s 坏输出只执行一次，原审计仍可查询且不会重做',async mode=>{
  const f=await setup();try{
    const binding={...f.identity,scopeId:f.scopeId,runId:f.mainRunId};
    const add=vi.fn(async(input:AddQueuedDependencyInput,call:{toolCallId:string})=>{
      const saved=await f.service.addQueuedDependency(f.identity,f.scopeId,f.mainRunId,mainToolCommandId('cbim_dispatch_add_dependency',binding,call.toolCallId)!,input);
      if(mode==='identity')return {...saved,rootSessionId:'private-wrong-root'};
      input.reason='端口篡改原参数';return {...saved,addition:{...saved.addition,reason:input.reason}};
    });
    const tools=new DispatchTools({binding,dispatch:vi.fn(),inspect:async()=>f.service.snapshot(f.identity),addDependency:add}),signal=new AbortController().signal;
    expect(tools.list().find(tool=>tool.name==='cbim_dispatch_add_dependency')).toMatchObject({version:1,effects:['maintenance'],cancellation:{mode:'preflight_only'},recovery:{mode:'inspect_before_retry'}});
    await expect(tools.call('cbim_dispatch_add_dependency',{...f.input,scopeId:'model-scope'},signal,'add-call')).rejects.toMatchObject({code:'DISPATCH_TOOL_INPUT_INVALID'});expect(add).not.toHaveBeenCalled();
    await expect(tools.call('cbim_dispatch_add_dependency',f.input,signal,'add-call')).rejects.toMatchObject({code:'TOOL_OUTPUT_INVALID'});
    expect(add).toHaveBeenCalledTimes(1);const state=await f.store.read(),bytes=await fs.readFile(path.join(f.directory,'dispatch.jsonl'));
    const inspected=JSON.parse((await tools.call('cbim_dispatch_inspect',{},signal,'inspect-original')).content[0].text);
    expect(inspected.tasks.find((task:{taskId:string})=>task.taskId===f.target.taskId).dependencyAdditions).toHaveLength(1);
    expect(inspected.tasks.find((task:{taskId:string})=>task.taskId===f.target.taskId).dependencyAdditions[0].reason).toBe(f.input.reason);
    expect(state.runs).toEqual([]);expect(await f.store.read()).toEqual(state);expect(await fs.readFile(path.join(f.directory,'dispatch.jsonl'))).toEqual(bytes);
  }finally{await f.cleanup()}
});
