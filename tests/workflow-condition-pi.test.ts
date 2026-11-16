import {expect,it,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fixture} from './helpers';
import {Application} from '../src/bridge/server/application';
import {Paths} from '../src/logic/workspace/service/paths';
import {FileRunStorage} from '../src/logic/execution/storage/run-storage';
import type {TaskNode} from '../src/logic/tasks/rules/graph-types';
import type {ChatApproval} from '../src/logic/tools/rules/policy/types';
import type {AgentBusinessRun} from '../src/logic/execution/rules/business-run';
import type {DispatchRun} from '../src/logic/tasks/rules/dispatch-execution';
import type {RunSummary} from '../src/logic/execution/rules/types';
import {validateMemberWorkflow} from '../src/logic/team/runtime/member-workflow';
import {workflowConditionProvider,workflowConditionFixture as data,type WorkflowConditionMode} from './workflow-condition-provider';
import {seedWorkflowCondition,workflowConditionRecords,workflowConditionLogBytes} from './workflow-condition-fixture';

// 与产品 agent-business 相同的只读验证投影：取真实登记/日志，不写旧图或伪造派发。
function verifierSource(record:AgentBusinessRun,summary:RunSummary,model:DispatchRun['model']){
 const b=record.binding,assignee={agentId:b.agentId,agentInstanceId:b.agentInstanceId,agentSessionId:b.agentSessionId,name:record.prepared.agent.name};
 const task:TaskNode={kind:'task',nodeId:b.taskId,taskId:b.taskId,identity:{workspaceId:b.workspaceId,rootSessionId:b.rootSessionId},requester:assignee,assignee,modules:record.prepared.modules.map(m=>m.binding),ownerBinding:summary.task.ownerBinding,goal:summary.task.goal,acceptance:summary.task.acceptance.map((text,index)=>({id:'criterion-'+index,text})),revision:1,planRevision:b.planRevision,status:'planned',awaitedChildren:[],runIds:[],createdAt:record.createdAt,updatedAt:record.createdAt};
 const run:DispatchRun={binding:b,assignmentMessageId:b.taskId,status:'completed',prepared:record.prepared,model,permission:record.permission,session:{nativeSessionId:String(summary.events.find(e=>e.type==='session.bound')!.data.sessionId),sessionFile:summary.sessionFile},createdAt:record.createdAt};
 return {task,run};
}
it.each(['complete','missing-capability','stop'] as WorkflowConditionMode[])('enforces saved Workflow against real recursive Pi tools, parent approval and canonical delivery (%s)',async mode=>{
 const f=await fixture(),provider=await workflowConditionProvider(mode);let app=f.app;
 try{
  const seeded=await seedWorkflowCondition(app,f.a,provider,mode),{entry}=seeded,workspace=app.Workspace(entry.id),knowledge=await workspace.Snapshot();expect(knowledge.files.find(file=>file.path===seeded.workflow)?.text).toBe(seeded.text);
  const started=await app.Dispatch('loop.chat',{id:entry.id,message:data.goal,options:{permission:mode==='missing-capability'?'read':'ask',turnTimeoutMs:60000}}),identity={workspaceId:entry.id,rootSessionId:started.taskId},interaction={id:entry.id,taskId:started.taskId},records=()=>workflowConditionRecords(f.user,entry.id),graph=()=>app.Dispatch('dispatch.graphSnapshot',{identity}),business=async()=>(await workspace.dispatchStore.Read()).agentBusinessRuns??[];
  let active:AgentBusinessRun|undefined;
  const read=()=>new FileRunStorage().Read(path.join(f.user,entry.id,'loop-engine/tasks',active!.binding.taskId,active!.binding.runId));
  if(mode!=='missing-capability'){
   await vi.waitFor(()=>{expect(provider.errors).toEqual([]);expect(provider.state.earlyWrite).toMatchObject({status:'rejected',retryable:false});expect(provider.member).toHaveLength(2)},{timeout:30000,interval:30});
   const registered=await business();expect(registered).toHaveLength(1);active=registered[0];expect(active.parent).toMatchObject({callerTaskId:started.taskId,callerRunId:started.runId,toolCallId:'workflow-call'});
   expect(await app.Dispatch('loop.approvals',interaction)).toEqual([]);await expect(fs.access(path.join(f.a,data.file))).rejects.toMatchObject({code:'ENOENT'});
   const summary=await read();expect(summary.toolReceipts?.find(receipt=>receipt.toolCallId==='workflow-write-without-plan')).toMatchObject({toolName:'write',outcome:'denied'});expect(summary.events.some(event=>event.type==='tool.allowed'&&event.data.id==='workflow-write-without-plan')).toBe(false);expect(active.prepared.modules.find(module=>module.binding.moduleId===seeded.team.input.moduleId)?.workflowContract).toEqual(seeded.contract);
   provider.releasePlan();let approvals:ChatApproval[]=[];
   await vi.waitFor(async()=>{expect(provider.errors).toEqual([]);approvals=await app.Dispatch('loop.approvals',interaction);expect(approvals).toHaveLength(1)},{timeout:20000,interval:30});expect(approvals[0].name).toBe('write');expect(approvals[0].input).toMatchObject({path:data.file,content:data.fact});await expect(fs.access(path.join(f.a,data.file))).rejects.toMatchObject({code:'ENOENT'});await app.Dispatch('loop.approve',{...interaction,approvalId:approvals[0].id,allow:true});
   await vi.waitFor(()=>{expect(provider.errors).toEqual([]);expect(provider.state.prematureDelivery).toMatchObject({code:'WORKFLOW_EVIDENCE_REQUIRED',retryable:false});expect(provider.member).toHaveLength(6)},{timeout:20000,interval:30});expect(await fs.readFile(path.join(f.a,data.file),'utf8')).toBe(data.fact);
   const beforeRead=await read();expect(beforeRead.taskProgress).toMatchObject({version:3,state:'executing'});expect(beforeRead.taskProgress?.delivery).toBeUndefined();expect(beforeRead.toolReceipts?.find(receipt=>receipt.toolCallId==='workflow-member-write')).toMatchObject({outcome:'succeeded'});expect(beforeRead.toolReceipts?.find(receipt=>receipt.toolCallId==='workflow-premature-delivery')?.outcome).not.toBe('succeeded');expect(await app.Dispatch('loop.approvals',interaction)).toEqual([]);
   if(mode==='stop')await app.Dispatch('loop.stop',interaction);provider.releaseRead();
  }
  await vi.waitFor(async()=>{expect(provider.errors).toEqual([]);expect((await records()).scopes[0]?.status).toBe('closed');expect(app.runtime.Snapshot().pressure.activeRuns).toBe(0)},{timeout:45000,interval:30});
  const saved=await records(),finished=await graph(),scope=saved.scopes[0],registered=await business();expect(finished.tasks).toEqual([]);expect(saved.runs).toEqual([]);expect(scope.outcome).toBe(mode==='stop'?'cancelled':'completed');expect(scope.goal?.review).toBeUndefined();
  if(mode==='missing-capability'){expect(provider.member).toHaveLength(0);expect(registered).toEqual([]);expect(provider.state.call.error).toMatchObject({code:'WORKFLOW_TOOL_UNAVAILABLE',started:false});await expect(fs.access(path.join(f.a,data.file))).rejects.toMatchObject({code:'ENOENT'})}
  else{
   expect(registered).toHaveLength(1);expect(registered[0].status).toBe('closed');expect(finished.root.agent.agentInstanceId).not.toBe(active!.binding.agentInstanceId);
   const summary=await read();expect(summary.status).toBe(mode==='stop'?'cancelled':'completed');expect(summary.unresolvedTools).toEqual([]);expect(summary.toolReceipts?.filter(receipt=>receipt.toolName==='write'&&receipt.outcome==='succeeded')).toHaveLength(1);expect(await fs.readFile(path.join(f.a,data.file),'utf8')).toBe(data.fact);
   if(mode==='complete'){
    expect(summary.taskProgress?.steps[0].evidence).toEqual(['workflow-member-read']);expect(summary.toolReceipts?.find(receipt=>receipt.toolCallId==='workflow-member-read')).toMatchObject({outcome:'succeeded'});expect(summary.taskProgress?.state).toBe('awaiting_review');expect(summary.events[0].data.workflowContracts).toEqual([expect.objectContaining({moduleId:seeded.team.input.moduleId,workflowId:seeded.team.input.workflowId,contract:seeded.contract})]);expect(summary.taskProgress?.delivery?.workflow).toMatchObject({version:1,checks:[{moduleId:seeded.team.input.moduleId,requirementId:'inspect-result',toolName:'read',toolCallIds:['workflow-member-read']}]});
    const {task:member,run}=verifierSource(active!,summary,seeded.profile);await expect(validateMemberWorkflow(member,run,summary,f.a)).resolves.toBeUndefined();
const mutations:Array<[string,(draft:RunSummary)=>void]>=[
          ['缺原生绑定但序号仍连续',draft=>{draft.events=draft.events.filter(event=>event.type!=='session.bound').map((event,index)=>({...event,seq:index+1}))}],
          ['汇总任务模块与冻结任务不同',draft=>{draft.task.moduleIds=['foreign-module']}],
          ['来源任务模块与汇总不同',draft=>{(draft.events[0].data.task as Record<string,unknown>).moduleIds=['foreign-module']}],
          ['汇总和来源一起伪造模块',draft=>{draft.task.moduleIds=['foreign-module'];(draft.events[0].data.task as Record<string,unknown>).moduleIds=['foreign-module']}],
          ['最后持久计划与汇总不同',draft=>{draft.taskProgress!.version++}],
          ['来源移除Workflow约定',draft=>{delete draft.events[0].data.workflowContracts}],
          ['原生ID为空',draft=>{for(const event of draft.events)if(event.type==='session.bound')event.data.sessionId=''}],
          ['尾部存在未完成记录',draft=>{draft.logIntegrity={partialTail:true}}],
        ];for(const [label,mutate] of mutations){const bad=structuredClone(summary);mutate(bad);await expect(validateMemberWorkflow(member,run,bad,f.a),label).rejects.toThrow()}
   }else{expect(summary.taskProgress?.delivery).toBeUndefined();expect(summary.toolReceipts?.some(receipt=>receipt.toolCallId==='workflow-member-read')).toBe(false)}
  }
  expect(provider.main).toHaveLength(mode==='stop'?1:mode==='missing-capability'?2:3);expect(provider.member).toHaveLength(mode==='missing-capability'?0:mode==='stop'?6:9);const sequence=[...provider.sequence],bytes=await workflowConditionLogBytes(f.user,entry.id);await app.Shutdown();app=new Application(new Paths(f.user,path.resolve('.')),path.resolve('assets'));await app.Init();expect(await records()).toEqual(saved);expect(await graph()).toEqual(finished);expect((await app.Workspace(entry.id).dispatchStore.Read()).agentBusinessRuns??[]).toEqual(registered);expect(await workflowConditionLogBytes(f.user,entry.id)).toEqual(bytes);expect(provider.sequence).toEqual(sequence);expect(provider.errors).toEqual([]);
 }finally{vi.restoreAllMocks();provider.releaseAll();await app.Shutdown();await f.cleanup();await provider.close()}
},120000);

it('real parallel Pi bash/read keeps early-read receipts but excludes them from delivery until a fresh read',async()=>{
  const f=await fixture(),provider=await workflowConditionProvider('parallel-effects');let app=f.app;
  try{
    const {entry}=await seedWorkflowCondition(app,f.a,provider,'parallel-effects'),started=await app.Dispatch('loop.chat',{id:entry.id,message:data.goal,options:{permission:'execute',turnTimeoutMs:60000}}),identity={workspaceId:entry.id,rootSessionId:started.taskId},records=()=>workflowConditionRecords(f.user,entry.id),graph=()=>app.Dispatch('dispatch.graphSnapshot',{identity});
    await vi.waitFor(()=>{expect(provider.errors).toEqual([]);expect(provider.member).toHaveLength(3)},{timeout:30000,interval:30});const registered=(await app.Workspace(entry.id).dispatchStore.Read()).agentBusinessRuns!;expect(registered).toHaveLength(1);const run=registered[0],directory=path.join(f.user,entry.id,'loop-engine','tasks',run.binding.taskId,run.binding.runId),read=()=>new FileRunStorage().Read(directory);
    await vi.waitFor(async()=>{expect(provider.errors).toEqual([]);const summary=await read();expect(summary.toolReceipts?.find(value=>value.toolCallId==='parallel-early-read')).toMatchObject({outcome:'succeeded'});await expect(fs.access(path.join(f.a,data.parallelStarted))).resolves.toBeUndefined()},{timeout:10000,interval:30});
    const during=await read();expect(during.toolReceipts?.some(value=>value.toolCallId==='parallel-late-write')).toBe(false);expect(await fs.readFile(path.join(f.a,data.file),'utf8')).toBe(data.parallelInitial);expect((await graph()).tasks).toEqual([]);expect(during.taskProgress?.delivery).toBeUndefined();
    // Release only after the real native read has finished; no timing guess and no tool/runtime substitution.
    await fs.writeFile(path.join(f.a,data.parallelRelease),'the early read has completed');
    await vi.waitFor(async()=>{expect(provider.errors).toEqual([]);expect((await records()).scopes[0].status).toBe('closed');expect(app.runtime.Snapshot().pressure.activeRuns).toBe(0)},{timeout:30000,interval:30});
    const saved=await records(),finished=await graph(),summary=await read(),early=summary.events.find(event=>event.type==='tool.finished'&&event.data.id==='parallel-early-read')!,late=summary.events.find(event=>event.type==='tool.finished'&&event.data.id==='parallel-late-write')!,fresh=summary.events.find(event=>event.type==='tool.finished'&&event.data.id==='parallel-fresh-read')!;
    expect(early.seq).toBeLessThan(late.seq);expect(fresh.seq).toBeGreaterThan(late.seq);expect(summary.toolReceipts?.find(value=>value.toolCallId==='parallel-early-read')).toMatchObject({outcome:'succeeded'});expect(summary.toolReceipts?.find(value=>value.toolCallId==='parallel-late-write')).toMatchObject({outcome:'succeeded',scope:{kind:'unknown'}});expect(summary.toolReceipts?.find(value=>value.toolCallId==='parallel-stale-step')?.outcome).not.toBe('succeeded');expect(provider.state.staleStep.error).toBeTruthy();expect(provider.state.parallelInspect.evidence.some((value:{toolCallId:string})=>value.toolCallId==='parallel-early-read')).toBe(false);
    expect(finished.tasks).toEqual([]);expect(saved.runs).toEqual([]);expect(summary.taskProgress?.steps[0].evidence).toEqual(['parallel-fresh-read']);expect(summary.taskProgress?.delivery?.workflow?.checks[0].toolCallIds).toEqual(['parallel-fresh-read']);expect(saved.scopes[0].outcome).toBe('completed');expect(await fs.readFile(path.join(f.a,data.file),'utf8')).toBe(data.fact);expect(provider.main).toHaveLength(3);expect(provider.member).toHaveLength(10);
    const bytes=await workflowConditionLogBytes(f.user,entry.id),sequence=[...provider.sequence];await app.Shutdown();app=new Application(new Paths(f.user,path.resolve('.')),path.resolve('assets'));await app.Init();expect(await records()).toEqual(saved);expect(await graph()).toEqual(finished);expect(await workflowConditionLogBytes(f.user,entry.id)).toEqual(bytes);expect(provider.sequence).toEqual(sequence);
  }finally{provider.releaseAll();await app.Shutdown();await f.cleanup();await provider.close()}
},120000);
