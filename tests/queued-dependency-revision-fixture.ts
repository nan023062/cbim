import {fixture,request} from './helpers';
import {seedTeam} from './team-fixture';
import {json} from '../src/backend/core/foundation/serialization';
import type {ReviseQueuedDependenciesInput} from '../src/backend/core/tasks/queued-dependency-revision';
import {WorkspaceDispatchService} from '../src/backend/scheduler-engine/execution/dispatch-service';
import {registerServiceOwner} from './owner-service-fixture';

export async function revisionFixture(){
  const f=await fixture(),entry=await f.app.dispatch('add',{path:f.a}),workspace=f.app.workspace(entry.id),team=await seedTeam(workspace);
  const snapshot=await workspace.snapshot(),moduleId=team.input.moduleId,file=moduleId+'/module.json',definition=JSON.parse(snapshot.files.find(value=>value.path===file)!.text);
  definition.maintenance={bindingId:'maintain',maintainerPersonIds:['owner'],revision:1,state:'active',confirmation:{recordId:'review',source:'local_user',confirmedAt:'2026-11-06T00:00:00.000Z'}};
  await workspace.commit(request(snapshot,[{path:'.cbim/team/people.json',text:json({people:[{id:'owner',name:'维护人',team:'.cbim/team'}]})},{path:file,text:json(definition)}]));
  await registerServiceOwner(f.app,workspace,'.cbim/team/dev',[moduleId]);
  const store=workspace.dispatchStore,directory=store.directory,service=new WorkspaceDispatchService(workspace,store,undefined,undefined,undefined,f.app.models),identity={workspaceId:entry.id,rootSessionId:'revision-root'},scopeId='revision-scope',mainRunId='main-run';
  await service.openScope(identity,scopeId,{message:'为先创建的任务补充真实前置'},mainRunId);
  const ownerSelection=(await service.owners.discover([moduleId])).groups[0].selection!;
  const workflowSelections=[{moduleId,workflowId:team.input.workflowId}];
  await service.goals.plan(identity,scopeId,mainRunId,'plan-one',{expectedRevision:1,objective:'核实业务',constraints:[],criteria:[{id:'c1',kind:'evidence',text:'可追溯结果'}],assignments:[{agentId:'.cbim/team/dev',moduleIds:[moduleId],ownerSelection,workflowSelections,criterionIds:['c1'],reason:'按模块执行'}],reason:'计划'});
  const assign=async(commandId:string,prerequisites:{taskId:string;expectedPlanRevision:number}[]=[])=>service.dispatchTask({...identity,commandId,expectedParentRevision:1,task:{assigneeAgentId:'.cbim/team/dev',moduleIds:[moduleId],ownerSelection,workflowSelections,goal:commandId,acceptance:[{id:'c1',text:'真实证据'}],prerequisites}},scopeId);
  const b=await assign('B'),c=await assign('C',[{taskId:b.taskId,expectedPlanRevision:1}]),a=await assign('A'),d=await assign('D',[{taskId:a.taskId,expectedPlanRevision:1}]);
  const graph=await service.snapshot(identity),source=graph.tasks.find(task=>task.taskId===a.taskId)!,target=graph.tasks.find(task=>task.taskId===c.taskId)!,oldSource=graph.tasks.find(task=>task.taskId===b.taskId)!,other=graph.tasks.find(task=>task.taskId===d.taskId)!;
  const edge=graph.edges.find(e=>e.kind==='dependency'&&e.fromNodeId===oldSource.nodeId&&e.toNodeId===target.nodeId)!;
  const ref=(t:typeof target)=>({taskId:t.taskId,expectedRevision:t.revision,expectedPlanRevision:t.planRevision});
  const input:ReviseQueuedDependenciesInput={expectedGraphCursor:{streamId:graph.cursor.streamId,seq:graph.cursor.seq},expectedGoalRevision:2,target:ref(target),remove:[{edgeId:edge.edgeId,expectedRevision:edge.revision}],add:[ref(source),ref(other)],reason:'原子删除旧前置并添加两条新前置'};
  return {...f,entry,workspace,directory,store,service,identity,scopeId,mainRunId,source,target,oldSource,other,edge,c,d,graph,input,assign,
    revise:(commandId='revise-one',value=input,assertCurrent?:()=>void)=>service.reviseQueuedDependencies(identity,scopeId,mainRunId,commandId,value,assertCurrent),
    cleanup:async()=>{await store.close();await f.cleanup()}};
}
