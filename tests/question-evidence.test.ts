import {expect,it} from 'vitest';
import {questionToolName} from '../src/logic/tools/rules/questions';
import {toolReceipt} from '../src/logic/tools/rules/receipts';
import {toolReceiptSchema} from '../src/logic/tools/rules/receipt-schema';
import {jsonToolResult} from '../src/logic/tools/rules/results';
import type {ToolCall,ToolDecision,ToolReceipt} from '../src/logic/tools/rules/types';
import type {RunSummary,StoredEvent} from '../src/logic/execution/rules/types';
import type {TaskNode} from '../src/logic/tasks/rules/graph-types';
import type {TaskProgress} from '../src/logic/evidence/rules/progress';
import type {ArtifactEvidenceEvent} from '../src/logic/evidence/rules/artifact-evidence';
import type {WorkflowContractBinding} from '../src/logic/tasks/rules/execution-context';
import {workflowContractSchema} from '../src/logic/workspace/rules/workflow-contract';
import {TaskProgressTools} from '../src/logic/evidence/rules/progress-tools';
import {isProgressEvidence,memberToolOutputSchema} from '../src/logic/tasks/rules/member-tool-output';
import {evaluateWorkflowDelivery,validateWorkflowEvidence} from '../src/logic/evidence/rules/workflow-evidence';
import {memberCandidate} from '../src/backend/scheduler-engine/members/member-state';
import {humanServiceFixture} from './human-decision-service-fixture';

const identity={workspaceId:'workspace',taskId:'task',runId:'run'},task={workspaceId:identity.workspaceId,taskId:identity.taskId,goal:'核验真实成果',acceptance:['读取文件']};
const question={questions:[{question:'选择哪种展示？',options:[{label:'列表'},{label:'卡片'}]}]};
const answers={answers:[{question:question.questions[0].question,answer:'列表'}]},cancelled={cancelled:true};
const plan={expectedVersion:0,goal:task.goal,acceptance:task.acceptance,reason:'执行原目标',steps:[{id:'check',title:'核验成果',owner:'executor'}]};
const binding:WorkflowContractBinding={moduleId:'module',workflowId:'module/workflow',workflowVersion:'workflow-version',contract:{version:1,beforeEffects:{requirePlan:true}}};
const readBinding:WorkflowContractBinding={...binding,contract:{version:1,beforeEffects:{requirePlan:true},delivery:{requiredToolEvidence:[{id:'read-result',toolName:'read'}]}}};
const decision=(name:string):ToolDecision=>({allow:true,effects:[name==='read'||name===questionToolName?'read':'maintenance'],scope:{kind:'workspace',workspaceId:identity.workspaceId}});
function receipt(name:string,id:string,value:unknown):ToolReceipt{const call={id,name,input:name===questionToolName?question:{path:'result.txt'}};return toolReceipt(identity,call,decision(name),'succeeded',jsonToolResult(name,value))}
const read=()=>receipt('read','read-result',{text:'actual file bytes'});
const inspect=async(tools:TaskProgressTools)=>JSON.parse((await tools.call('cbim_task_inspect',{})).content[0].text);
const stored=(ids:string[]):TaskProgress=>({version:3,goal:task.goal,acceptance:task.acceptance,reason:plan.reason,state:'awaiting_review',steps:[{...plan.steps[0],state:'reported_done',evidence:ids}],delivery:{summary:'成果候选',limitations:[]}});

it.each([['answers',answers],['cancelled',cancelled]] as const)('%s 保留可读问答回执，但不能进入当前进度、步骤或交付输出依据',async(_kind,value)=>{
  const q=receipt(questionToolName,'question',value),tools=new TaskProgressTools(undefined,async()=>{},{identity});
  expect(toolReceiptSchema.parse(q)).toEqual(q);expect(isProgressEvidence(q,identity)).toBe(false);
  await tools.call('cbim_task_plan',plan);const before=tools.current();tools.record(q,tools.generation);
  expect((await inspect(tools)).evidence).toEqual([]);
  await expect(tools.call('cbim_task_step',{expectedVersion:1,id:'check',state:'reported_done',evidenceIds:[q.toolCallId]})).rejects.toThrow('证据');expect(tools.current()).toEqual(before);
  const schema=memberToolOutputSchema('cbim_task_inspect',{binding:identity,input:{},progress:{previous:before,expected:{plan:before,evidence:[q]},evidence:[q]}});
  expect(schema.safeParse({plan:before,evidence:[q]}).success).toBe(false);
  tools.record(read(),tools.generation);await tools.call('cbim_task_step',{expectedVersion:1,id:'check',state:'reported_done',evidenceIds:['read-result']});await tools.call('cbim_delivery_prepare',{expectedVersion:2,summary:'真实文件交付',limitations:[]});
  expect(tools.current()?.delivery?.summary).toBe('真实文件交付');expect((await inspect(tools)).evidence.map((item:ToolReceipt)=>item.toolName)).toEqual(['read']);
});

it.each([['answers',answers],['cancelled',cancelled]] as const)('%s 不能借无 Workflow 的旧或合成进度产生候选，混入真实 read 也不能洗白',(_kind,value)=>{
  const node={taskId:identity.taskId,identity:{workspaceId:identity.workspaceId,rootSessionId:'root'},goal:task.goal,acceptance:[{id:'a',text:task.acceptance[0]}],planRevision:1} as TaskNode;
  const summary:RunSummary={task:{...task,root:'/fixture',agentId:'agent',moduleIds:[]},runId:identity.runId,status:'completed',acceptance:'not_evaluated',unresolvedTools:[],events:[],toolReceipts:[receipt(questionToolName,'question',value),read()],taskProgress:stored(['question'])};
  expect(memberCandidate(node,summary)).toBeUndefined();summary.taskProgress=stored(['read-result','question']);expect(memberCandidate(node,summary)).toBeUndefined();
  summary.taskProgress=stored(['read-result']);expect(memberCandidate(node,summary)?.evidenceRefs).toEqual(['read-result']);
});

it('Workflow 声明不能把提问当原生要求，纯评价也拒绝仅计划或混合引用中的问答',()=>{
  expect(workflowContractSchema.safeParse({version:1,delivery:{requiredToolEvidence:[{id:'answer',toolName:questionToolName}]}}).success).toBe(false);
  for(const value of [answers,cancelled]){
    const q=receipt(questionToolName,'question',value);
    expect(()=>evaluateWorkflowDelivery([binding],[q],identity)).toThrow(expect.objectContaining({code:'WORKFLOW_EVIDENCE_INVALID'}));
    expect(()=>evaluateWorkflowDelivery([readBinding],[read(),q],identity)).toThrow(expect.objectContaining({code:'WORKFLOW_EVIDENCE_INVALID'}));
  }
  expect(evaluateWorkflowDelivery([readBinding],[read()],identity).checks[0].toolCallIds).toEqual(['read-result']);
});

async function canonical(value:unknown,forged:boolean,requiresRead:boolean){
  const bindings=[requiresRead?readBinding:binding],events:ArtifactEvidenceEvent[]=[],emit=(type:string,data:Record<string,unknown>)=>events.push({...identity,seq:events.length+1,type,data:structuredClone(data)});
  emit('run.started',{task,workflowContracts:bindings});
  const tools=new TaskProgressTools(undefined,async progress=>{emit('task.updated',{progress})},{identity,workflow:{bindings,task,identity}});
  const invoke=async(id:string,name:string,input:Record<string,unknown>,override?:TaskProgress)=>{
    const call:ToolCall={id,name,input},auth=decision(name);emit('tool.proposed',{...call});emit('tool.allowed',{...call,...auth});
    let result;
    if(override){emit('task.updated',{progress:override});result=jsonToolResult(name,override)}
    else result=name===questionToolName?jsonToolResult(name,value):name==='read'?jsonToolResult(name,{text:'real file'}):await tools.call(name,input);
    const r=toolReceipt(identity,call,auth,'succeeded',result);emit('tool.finished',{id,name,result,isError:false,receipt:r});tools.record(r,tools.generation);
  };
  await invoke('plan','cbim_task_plan',plan);await invoke('question',questionToolName,question);await invoke('read-result','read',{path:'result.txt'});
  const evidenceIds=forged?(requiresRead?['read-result','question']:['question']):['read-result'];
  const candidate=stored(evidenceIds),step={...candidate,version:2,state:'executing' as const,delivery:undefined};
  // 这是此前可保存的完整旧链，不通过新版 Runtime 重新生成假步骤；canonical 必须独立拒绝。
  if(forged)candidate.delivery!.workflow=evaluateWorkflowDelivery(bindings,[read()],identity);
  await invoke('step','cbim_task_step',{expectedVersion:1,id:'check',state:'reported_done',evidenceIds},forged?step:undefined);
  await invoke('delivery','cbim_delivery_prepare',{expectedVersion:2,summary:'成果候选',limitations:[]},forged?candidate:undefined);
  emit('run.settled',{status:'completed'});return {events,bindings};
}

it.each([['answers',answers],['cancelled',cancelled]] as const)('%s 的完整旧 canonical 问答证据被独立拒绝，未引用的问答仍可正常交付',async(_kind,value)=>{
  for(const requiresRead of [false,true]){
    const bad=await canonical(value,true,requiresRead);expect(()=>validateWorkflowEvidence(bad.events,task,bad.bindings)).toThrow(expect.objectContaining({code:'WORKFLOW_EVIDENCE_INVALID'}));
    const good=await canonical(value,false,requiresRead);expect(()=>validateWorkflowEvidence(good.events,task,good.bindings)).not.toThrow();
  }
});

function replaceReadWithQuestion(summary:RunSummary,toolCallId:string,value:unknown){
  const result=jsonToolResult(questionToolName,value),call={id:toolCallId,name:questionToolName,input:question},auth:ToolDecision={allow:true,effects:['read'],scope:{kind:'workspace',workspaceId:summary.task.workspaceId}};
  const r=toolReceipt({workspaceId:summary.task.workspaceId,taskId:summary.task.taskId,runId:summary.runId},call,auth,'succeeded',result);
  for(const event of summary.events){
    if(event.data.id!==toolCallId)continue;
    if(event.type==='tool.proposed')event.data={...call};
    else if(event.type==='tool.allowed')event.data={...call,...auth};
    else if(event.type==='tool.started')event.data={...event.data,name:questionToolName};
    else if(event.type==='tool.finished')event.data={id:toolCallId,name:questionToolName,result,isError:false,receipt:r};
  }
  summary.toolReceipts=summary.toolReceipts!.map(item=>item.toolCallId===toolCallId?r:item);return summary;
}

it.each([['answers',answers],['cancelled',cancelled]] as const)('%s 的可靠成功回执仍不能进入目标当前/历史候选和人工决定依据',async(_kind,value)=>{
  const f=await humanServiceFixture();try{
    const state=await f.store.read(),scope=state.scopes!.find(item=>item.scopeId===f.scopeId)!,graph=state.graphs.find(item=>item.identity.rootSessionId===f.identity.rootSessionId)!,node=graph.tasks[0],run=state.runs!.find(item=>item.binding.runId===node.result!.runId)!,before=await f.store.read();
    const original=await f.read(run),bad=replaceReadWithQuestion(structuredClone(original),node.result!.evidenceRefs[0],value);f.inspect.mockResolvedValue(bad);
    await expect(f.service.goals.validateMemberCandidate(state,scope,graph,node,run.prepared.knowledgeRevision)).rejects.toMatchObject({code:'GOAL_EVIDENCE_INVALID'});
    await expect(f.service.goals.validateHistoricalMemberCandidate(state,scope,graph,node,run.prepared.knowledgeRevision)).rejects.toMatchObject({code:'GOAL_EVIDENCE_INVALID'});
    await expect(f.service.goals.validateHumanCandidates(state,scope,'c1')).rejects.toMatchObject({code:'GOAL_EVIDENCE_INVALID'});
    const preview=await f.preview();expect(preview.allowedDecisions).toEqual([]);expect(await f.store.read()).toEqual(before);
    // 读过问题但没有引用它，不删除原日志，也不把有效的文件候选整体判坏。
    const good=structuredClone(original),terminal=good.events.pop()!,call={id:'unused-question',name:questionToolName,input:question},auth:ToolDecision={allow:true,effects:['read'],scope:{kind:'workspace',workspaceId:good.task.workspaceId}},result=jsonToolResult(questionToolName,value),r=toolReceipt({workspaceId:good.task.workspaceId,taskId:good.task.taskId,runId:good.runId},call,auth,'succeeded',result);
    const add=(type:StoredEvent['type'],data:Record<string,unknown>)=>good.events.push({...terminal,seq:good.events.length+1,type,data});
    add('tool.proposed',{...call});add('tool.allowed',{...call,...auth});add('tool.finished',{id:call.id,name:call.name,result,isError:false,receipt:r});good.events.push({...terminal,seq:good.events.length+1});good.toolReceipts!.push(r);f.inspect.mockResolvedValue(good);
    expect((await f.service.goals.validateMemberCandidate(state,scope,graph,node,run.prepared.knowledgeRevision)).runId).toBe(original.runId);expect((await f.preview()).allowedDecisions).toContain('accept');
  }finally{await f.cleanup()}
});
