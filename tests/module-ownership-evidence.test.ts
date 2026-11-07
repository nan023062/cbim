import {expect,it} from 'vitest';
import {toolReceipt} from '../src/backend/core/tools/receipts';
import {jsonToolResult} from '../src/backend/core/tools/results';
import {TaskProgressTools} from '../src/backend/core/tasks/progress-tools';
import {isProgressEvidence} from '../src/backend/core/tasks/member-tool-output';
import {evaluateWorkflowDelivery} from '../src/backend/core/tasks/workflow-evidence';
import {memberCandidate} from '../src/backend/scheduler-engine/execution/member-state';
import {moduleOwnershipToolEffects} from '../src/backend/core/workspace/module-ownership-tool-policy';
import type {TaskNode} from '../src/backend/core/tasks/graph-types';
import type {RunSummary} from '../src/backend/core/brain/types';
import {humanServiceFixture} from './human-decision-service-fixture';

it.each(Object.entries(moduleOwnershipToolEffects))('%s remains a tool fact but cannot become progress, legacy candidate or Workflow evidence',async(name,effect)=>{
  const identity={workspaceId:'workspace',taskId:'task',runId:'run'},call={id:'ownership',name,input:{}},decision={allow:true,effects:[effect],scope:{kind:'knowledge' as const,workspaceId:identity.workspaceId}},receipt=toolReceipt(identity,call,decision,'succeeded',jsonToolResult(name,{recorded:true}));
  expect(isProgressEvidence(receipt,identity)).toBe(false);
  const tools=new TaskProgressTools(undefined,async()=>{},{identity});await tools.call('cbim_task_plan',{expectedVersion:0,goal:'business',acceptance:['evidence'],reason:'plan',steps:[{id:'step',title:'prove business',owner:'member'}]});tools.record(receipt,tools.generation);
  expect(JSON.parse((await tools.call('cbim_task_inspect',{})).content[0].text).evidence).toEqual([]);
  await expect(tools.call('cbim_task_step',{expectedVersion:1,id:'step',state:'reported_done',evidenceIds:['ownership']})).rejects.toThrow('证据');
  expect(()=>evaluateWorkflowDelivery([{moduleId:'module',workflowId:'workflow',workflowVersion:'v1',contract:{version:1,beforeEffects:{requirePlan:true}}}],[receipt],identity)).toThrow(expect.objectContaining({code:'WORKFLOW_EVIDENCE_INVALID'}));
  const node={taskId:identity.taskId,identity:{workspaceId:identity.workspaceId,rootSessionId:'root'},goal:'business',acceptance:[{id:'a',text:'evidence'}],planRevision:1} as TaskNode;
  const summary:RunSummary={task:{...identity,root:'/fixture',goal:'business',acceptance:['evidence'],moduleIds:[]},runId:identity.runId,status:'completed',acceptance:'not_evaluated',events:[],unresolvedTools:[],toolReceipts:[receipt],taskProgress:{...tools.current()!,version:3,state:'awaiting_review',steps:[{...tools.current()!.steps[0],state:'reported_done',evidence:['ownership']}],delivery:{summary:'not business',limitations:[]}}};
  expect(memberCandidate(node,summary)).toBeUndefined();
});

it('current, historical and human candidate paths independently reject a complete ownership receipt chain',async()=>{
  const f=await humanServiceFixture();try{
    const state=await f.store.read(),scope=state.scopes!.find(item=>item.scopeId===f.scopeId)!,graph=state.graphs.find(item=>item.identity.rootSessionId===f.identity.rootSessionId)!,task=graph.tasks[0],run=state.runs!.find(item=>item.binding.runId===task.result!.runId)!,summary=structuredClone(await f.read(run));
    const id=task.result!.evidenceRefs[0],name='cbim_module_owner_inspect',call={id,name,input:{moduleIds:task.modules.map(item=>item.moduleId)}},decision={allow:true,effects:['read' as const],scope:{kind:'knowledge' as const,workspaceId:summary.task.workspaceId}},result=jsonToolResult(name,{readOnly:true}),receipt=toolReceipt({workspaceId:summary.task.workspaceId,taskId:summary.task.taskId,runId:summary.runId},call,decision,'succeeded',result);
    for(const event of summary.events){if(event.data.id!==id)continue;if(event.type==='tool.proposed')event.data={...call};else if(event.type==='tool.allowed')event.data={...call,...decision};else if(event.type==='tool.started')event.data={...event.data,name};else if(event.type==='tool.finished')event.data={id,name,result,isError:false,receipt}}
    summary.toolReceipts=summary.toolReceipts!.map(value=>value.toolCallId===id?receipt:value);f.inspect.mockResolvedValue(summary);
    await expect(f.service.goals.validateMemberCandidate(state,scope,graph,task,run.prepared.knowledgeRevision)).rejects.toMatchObject({code:'GOAL_EVIDENCE_INVALID'});
    await expect(f.service.goals.validateHistoricalMemberCandidate(state,scope,graph,task,run.prepared.knowledgeRevision)).rejects.toMatchObject({code:'GOAL_EVIDENCE_INVALID'});
    await expect(f.service.goals.validateHumanCandidates(state,scope,'c1')).rejects.toMatchObject({code:'GOAL_EVIDENCE_INVALID'});
  }finally{await f.cleanup()}
});
