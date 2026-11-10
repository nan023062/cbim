import {expect,it,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fixture,request} from './helpers';
import {seedTeam} from './team-fixture';
import {registerServiceOwner} from './owner-service-fixture';
import type {OwnerExecutionSelection} from '../src/backend/core/team/member-execution-binding';
import {json} from '../src/backend/core/foundation/serialization';
import {projectMainScope} from '../src/backend/core/tasks/main-tool-output';
import type {GoalPlanInput} from '../src/backend/core/tasks/scope-goal';
import {FileDispatchStore} from '../src/backend/main/persistence/tasks/dispatch-store';
import {WorkspaceDispatchService} from '../src/backend/scheduler-engine/execution/dispatch-service';
import {GoalTools} from '../src/backend/scheduler-engine/tools/goal-tools';
import {DispatchTools,type DispatchToolsPort} from '../src/backend/scheduler-engine/tools/dispatch-tools';
import {mainToolCommandId} from '../src/backend/scheduler-engine/tools/main-tool-contracts';

it.each(['goal','dispatch'] as const)('真实 %s 事务提交后的坏回包只报告输出失败，原事实仍可读且不重放',async kind=>{
  const f=await fixture();let store:FileDispatchStore|undefined;
  try{
    const entry=await f.app.dispatch('add',{path:f.a}),workspace=f.app.workspace(entry.id);
    store=workspace.dispatchStore;const directory=store.directory,service=new WorkspaceDispatchService(workspace,store,undefined,undefined,undefined,f.app.models);
    const identity={workspaceId:entry.id,rootSessionId:'contract-root'},binding={...identity,scopeId:'contract-scope',runId:'contract-run'},signal=new AbortController().signal;
    await service.openScope(identity,binding.scopeId,{message:'核实当前业务产物'},binding.runId);
    let modules:string[]=[],ownerSelection:OwnerExecutionSelection|undefined;
    if(kind==='dispatch'){
      const team=await seedTeam(workspace),snapshot=await workspace.snapshot(),file=team.input.moduleId+'/module.json',definition=JSON.parse(snapshot.files.find(item=>item.path===file)!.text);
      definition.maintenance={bindingId:'contract-maintenance',maintainerPersonIds:['owner'],revision:1,state:'active',confirmation:{recordId:'contract-confirm',source:'local_user',confirmedAt:'2026-11-07T00:00:00.000Z'}};
      await workspace.commit(request(snapshot,[{path:'.cbim/team/people.json',text:json({people:[{id:'owner',name:'维护人',team:'.cbim/team'}]})},{path:file,text:json(definition)}]));modules=[team.input.moduleId];
      await registerServiceOwner(f.app,workspace,'.cbim/team/dev',modules);
      ownerSelection=(await service.owners.discover(modules)).groups[0].selection!;
    }
    const plan:GoalPlanInput={expectedRevision:1,objective:'核实产物',constraints:[],criteria:[{id:'c1',text:'提交可核实的事实',kind:'evidence'}],assignments:[{agentId:kind==='goal'?'cbim:main':'.cbim/team/dev',moduleIds:modules,...(ownerSelection?{ownerSelection}:{}),criterionIds:['c1'],reason:'按真实职责安排'}],reason:'形成当前目标计划'};
    const savePlan=vi.fn(async(input:GoalPlanInput,call:{toolCallId:string})=>{
      const saved=await service.goals.plan(identity,binding.scopeId,binding.runId,mainToolCommandId('cbim_goal_plan',binding,call.toolCallId)!,input);
      return {...projectMainScope(saved),scopeId:undefined};
    });
    const goals=new GoalTools({binding,inspect:async()=>{const value=await service.goals.inspectWithGraph(identity,binding.scopeId);return {scope:projectMainScope(value.scope),graph:value.graph}},plan:savePlan,review:vi.fn()});
    const dispatch=vi.fn<DispatchToolsPort['dispatch']>(async(input,call)=>{
      const graph=await service.snapshot(identity),saved=await service.dispatchTask({...identity,commandId:mainToolCommandId('cbim_dispatch_task',binding,call.toolCallId)!,expectedParentRevision:graph.root.revision,task:input},binding.scopeId);
      return {...saved,cursor:{...saved.cursor,rootSessionId:'private-wrong-root'}};
    });
    const tools=new DispatchTools({binding,dispatch,inspect:async taskId=>{const graph=await service.snapshot(identity);return taskId?graph.tasks.find(task=>task.taskId===taskId):graph}},goals);
    if(kind==='goal')await expect(tools.call('cbim_goal_plan',plan,signal,'original-call')).rejects.toMatchObject({code:'TOOL_OUTPUT_INVALID'});
    else{
      await service.goals.plan(identity,binding.scopeId,binding.runId,'setup-plan',plan);
      await expect(tools.call('cbim_dispatch_task',{agentId:'.cbim/team/dev',ownerSelection,moduleIds:modules,goal:plan.objective,acceptance:[{id:'c1',text:'提交可核实的事实'}]},signal,'original-call')).rejects.toMatchObject({code:'TOOL_OUTPUT_INVALID'});
    }
    const state=await store.read(),log=path.join(directory,'dispatch.jsonl'),bytes=await fs.readFile(log);
    expect(state.scopes![0].goal?.revision).toBe(2);expect(state.graphs[0].tasks).toHaveLength(kind==='dispatch'?1:0);expect(state.outbox).toHaveLength(kind==='dispatch'?1:0);expect(state.runs).toEqual([]);
    const read=JSON.parse((await tools.call('cbim_goal_inspect',{},signal,'read-original')).content[0].text);
    expect(read.scope.goal.revision).toBe(2);expect(read.graph.tasks).toHaveLength(kind==='dispatch'?1:0);
    if(kind==='dispatch')expect(JSON.parse((await tools.call('cbim_dispatch_inspect',{taskId:state.graphs[0].tasks[0].taskId},signal,'read-task')).content[0].text)).toMatchObject({status:'queued',runIds:[]});
    expect(savePlan).toHaveBeenCalledTimes(kind==='goal'?1:0);expect(dispatch).toHaveBeenCalledTimes(kind==='dispatch'?1:0);
    expect(await fs.readFile(log)).toEqual(bytes);expect(await store.read()).toEqual(state);
    const reopened=new FileDispatchStore(directory,entry.id);try{expect(await reopened.read()).toEqual(state);expect(await fs.readFile(log)).toEqual(bytes)}finally{await reopened.close()}
  }finally{await store?.close();await f.cleanup()}
});
