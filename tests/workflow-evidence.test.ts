import {expect,it} from 'vitest';
import {TaskProgressTools} from '../src/backend/core/evidence/progress-tools';
import {evaluateWorkflowDelivery,validateWorkflowEvidence} from '../src/backend/core/evidence/workflow-evidence';
import type {WorkflowContractBinding} from '../src/backend/core/tasks/execution-context';
import type {TaskProgress} from '../src/backend/core/evidence/progress';
import type {ArtifactEvidenceEvent} from '../src/backend/core/evidence/artifact-evidence';
import {toolReceipt} from '../src/backend/core/tools/receipts';
import type {ToolCall,ToolDecision,ToolReceipt} from '../src/backend/core/tools/types';

const identity={workspaceId:'workspace',taskId:'task',runId:'run'},task={workspaceId:'workspace',taskId:'task',goal:'实现本模块成果',acceptance:['实际读取成果']};
const bindings:WorkflowContractBinding[]=[{moduleId:'project/module',workflowId:'project/module/workflows/review',workflowVersion:'body-hash',contract:{version:1,beforeEffects:{requirePlan:true},delivery:{requiredToolEvidence:[{id:'read-result',toolName:'read'}]}}}];
const planInput={expectedVersion:0,goal:task.goal,acceptance:task.acceptance,reason:'按模块约定执行',steps:[{id:'implement',title:'实现并读取成果',owner:'executor'}]};
const decision=(name:string):ToolDecision=>({allow:true,effects:name==='write'?['business-write']:name==='bash'?['command']:name.startsWith('cbim_')?['maintenance']:['read'],scope:{kind:name==='bash'?'unknown':'workspace',workspaceId:identity.workspaceId}});
function evidence(name='read',id='read-one'):ToolReceipt{const call={id,name,input:{path:'result.txt'}};return toolReceipt(identity,call,decision(name),'succeeded',{content:[{type:'text',text:'actual result'}]})}
function progress(){const states:TaskProgress[]=[];const tools=new TaskProgressTools(undefined,async value=>{states.push(structuredClone(value))},{identity,artifacts:()=>[],workflow:{bindings,task,identity}});return {tools,states}}

it('有约定的业务操作先要求本轮原目标计划，审批后版本变化不得使旧操作获准',async()=>{
  const f=progress();expect(()=>f.tools.beforeEffects()).toThrow(expect.objectContaining({code:'WORKFLOW_PLAN_REQUIRED'}));expect(f.states).toEqual([]);
  await f.tools.call('cbim_task_plan',planInput);const version=f.tools.beforeEffects();expect(version).toBe(1);
  await f.tools.call('cbim_task_step',{expectedVersion:1,id:'implement',state:'working',evidenceIds:[]});await expect(f.tools.invalidate('写入前',version)).rejects.toThrow(expect.objectContaining({code:'WORKFLOW_PLAN_STALE'}));expect(f.tools.current()?.version).toBe(2);
  await f.tools.invalidate('写入前',f.tools.beforeEffects());expect(f.tools.current()?.version).toBe(3);
});
it('旧轮计划不能冒充本轮前置，模型改写原目标也不能放行',async()=>{
  const f=progress();await f.tools.call('cbim_task_plan',{...planInput,goal:'另一个目标'});expect(()=>f.tools.beforeEffects()).toThrow(expect.objectContaining({code:'WORKFLOW_PLAN_REQUIRED'}));
  const resumed=new TaskProgressTools(f.tools.current(),async()=>{},{identity,artifacts:()=>[],workflow:{bindings,task,identity}});expect(()=>resumed.beforeEffects()).toThrow(expect.objectContaining({code:'WORKFLOW_PLAN_REQUIRED'}));
});
it('交付缺指定read回执拒绝；实际引用后程序生成proof，模型不能传入pass',async()=>{
  const f=progress();await f.tools.call('cbim_task_plan',planInput);f.tools.record(evidence('write','write-one'),f.tools.generation);
  await f.tools.call('cbim_task_step',{expectedVersion:1,id:'implement',state:'reported_done',evidenceIds:['write-one']});await expect(f.tools.call('cbim_delivery_prepare',{expectedVersion:2,summary:'成果',limitations:[]})).rejects.toThrow(expect.objectContaining({code:'WORKFLOW_EVIDENCE_REQUIRED'}));expect(f.tools.current()?.delivery).toBeUndefined();
  f.tools.record(evidence(),f.tools.generation);await f.tools.call('cbim_task_step',{expectedVersion:2,id:'implement',state:'reported_done',evidenceIds:['write-one','read-one']});await f.tools.call('cbim_delivery_prepare',{expectedVersion:3,summary:'成果',limitations:[]});expect(f.tools.current()?.delivery?.workflow?.checks[0]).toMatchObject({moduleId:bindings[0].moduleId,requirementId:'read-result',toolCallIds:['read-one']});
  await expect(f.tools.call('cbim_delivery_prepare',{expectedVersion:4,summary:'成果',limitations:[],workflow:{pass:true}})).rejects.toThrow();
});
it('副作用后的代次使旧回执失效，交付不自动选取未列入步骤的成功read',async()=>{
  const f=progress();await f.tools.call('cbim_task_plan',planInput);const generation=f.tools.generation;await f.tools.invalidate('业务写入',f.tools.beforeEffects());f.tools.record(evidence(),generation);
  await expect(f.tools.call('cbim_task_step',{expectedVersion:2,id:'implement',state:'reported_done',evidenceIds:['read-one']})).rejects.toThrow('证据不存在');f.tools.record(evidence('write','write-one'),f.tools.generation);f.tools.record(evidence(),f.tools.generation);
  await f.tools.call('cbim_task_step',{expectedVersion:2,id:'implement',state:'reported_done',evidenceIds:['write-one']});await expect(f.tools.call('cbim_delivery_prepare',{expectedVersion:3,summary:'成果',limitations:[]})).rejects.toThrow(expect.objectContaining({code:'WORKFLOW_EVIDENCE_REQUIRED'}));
});
it('所有模块条件分别评价，成功回执不能跨运行且命令范围保持unknown',()=>{
  const second:WorkflowContractBinding={...bindings[0],moduleId:'project/other',contract:{version:1,delivery:{requiredToolEvidence:[{id:'search',toolName:'grep'}]}}};
  expect(()=>evaluateWorkflowDelivery([...bindings,second],[evidence()],identity)).toThrow(expect.objectContaining({code:'WORKFLOW_EVIDENCE_REQUIRED'}));expect(evaluateWorkflowDelivery([...bindings,second],[evidence(),evidence('grep','search-one')],identity).checks).toHaveLength(2);
  expect(()=>evaluateWorkflowDelivery(bindings,[{...evidence(),runId:'old-run'}],identity)).toThrow(expect.objectContaining({code:'WORKFLOW_EVIDENCE_INVALID'}));expect(()=>evaluateWorkflowDelivery(bindings,[{...evidence(),outcome:'unknown'}],identity)).toThrow(expect.objectContaining({code:'WORKFLOW_EVIDENCE_INVALID'}));
  const shell:WorkflowContractBinding={...second,contract:{version:1,delivery:{requiredToolEvidence:[{id:'command',toolName:'bash'}]}}};expect(evaluateWorkflowDelivery([shell],[evidence('bash','shell-one')],identity).checks[0].toolName).toBe('bash');expect(()=>evaluateWorkflowDelivery([shell],[{...evidence('bash','shell-one'),scope:{kind:'workspace',workspaceId:identity.workspaceId}}],identity)).toThrow(expect.objectContaining({code:'WORKFLOW_EVIDENCE_REQUIRED'}));
});

async function canonical(){
  const events:ArtifactEvidenceEvent[]=[];const emit=(type:string,data:Record<string,unknown>)=>{events.push({...identity,seq:events.length+1,type,data:structuredClone(data)})};emit('run.started',{task,workflowContracts:bindings});
  const tools=new TaskProgressTools(undefined,async progress=>{emit('task.updated',{progress})},{identity,artifacts:()=>[],workflow:{bindings,task,identity}});
  async function call(id:string,name:string,input:Record<string,unknown>){const call:ToolCall={id,name,input},auth=decision(name);emit('tool.proposed',{...call});if(name==='write')await tools.invalidate('写入前',tools.beforeEffects());emit('tool.allowed',{...call,...auth});const generation=tools.generation,result=name.startsWith('cbim_')?await tools.call(name,input):{content:[{type:'text',text:name==='read'?'actual file':'written'}]};const receipt=toolReceipt(identity,call,auth,'succeeded',result);emit('tool.finished',{id,name,result,receipt});tools.record(receipt,generation)}
  await call('plan','cbim_task_plan',planInput);await call('write-one','write',{path:'result.txt',content:'actual file'});await call('read-one','read',{path:'result.txt'});await call('step','cbim_task_step',{expectedVersion:2,id:'implement',state:'reported_done',evidenceIds:['write-one','read-one']});await call('deliver','cbim_delivery_prepare',{expectedVersion:3,summary:'成果',limitations:[]});emit('run.settled',{status:'completed'});return events;
}
it('结算重新核对完整canonical及程序proof，不依赖模型交付正文',async()=>{const events=await canonical();expect(validateWorkflowEvidence(events,task,bindings)?.checks[0].toolCallIds).toEqual(['read-one']);expect(validateWorkflowEvidence(events,task,[])).toBeUndefined()});
it('成功交付后再次调用的明确版本失败不产生副作用，不抹去已有真实候选',async()=>{
  const events=await canonical(),last=events.pop()!,call={id:'repeat-delivery',name:'cbim_delivery_prepare',input:{expectedVersion:3,summary:'重复',limitations:[]}},auth=decision(call.name),result={content:[{type:'text',text:'任务计划版本已变化'}],isError:true};
  const push=(type:string,data:Record<string,unknown>)=>events.push({...identity,seq:events.length+1,type,data});push('tool.proposed',call);push('tool.allowed',{...call,...auth});push('tool.finished',{id:call.id,name:call.name,result,isError:true,receipt:toolReceipt(identity,call,auth,'failed',result)});events.push({...last,seq:events.length+1});expect(validateWorkflowEvidence(events,task,bindings)?.checks[0].toolCallIds).toEqual(['read-one']);
});
async function overlappingWrite(order:'after-delivery'|'before-delivery'|'before-read',failedWrite=false){
  const events:ArtifactEvidenceEvent[]=[];
  const emit=(type:string,data:Record<string,unknown>)=>events.push({...identity,seq:events.length+1,type,data:structuredClone(data)});
  emit('run.started',{task,workflowContracts:bindings});
  const tools=new TaskProgressTools(undefined,async progress=>{emit('task.updated',{progress})},{identity,artifacts:()=>[],workflow:{bindings,task,identity}});
  async function call(id:string,name:string,input:Record<string,unknown>){
    const request:ToolCall={id,name,input},auth=decision(name);emit('tool.proposed',{...request});emit('tool.allowed',{...request,...auth});
    const generation=tools.generation,result=name.startsWith('cbim_')?await tools.call(name,input):{content:[{type:'text',text:'read bytes'}]};
    const receipt=toolReceipt(identity,request,auth,'succeeded',result);emit('tool.finished',{id,name,result,receipt});tools.record(receipt,generation);
  }
  await call('plan','cbim_task_plan',planInput);
  const write:ToolCall={id:'write-in-flight',name:'write',input:{path:'result.txt',content:'new bytes'}},auth=decision(write.name),result={content:[{type:'text',text:'written'}]};
  emit('tool.proposed',{...write});await tools.invalidate('写入前',tools.beforeEffects());emit('tool.allowed',{...write,...auth});const writeGeneration=tools.generation;
  const finishWrite=()=>{const receipt=toolReceipt(identity,write,auth,failedWrite?'failed':'succeeded',result);emit('tool.finished',{id:write.id,name:write.name,result,isError:failedWrite,receipt});tools.record(receipt,writeGeneration)};
  if(order==='before-read')finishWrite();
  await call('read-overlap','read',{path:'result.txt'});
  if(order==='before-delivery')finishWrite();
  // 单独引用读取回执，避免写入回执自己的结束时间遮盖“读取仍与写入重叠”的窗口。
  await call('step','cbim_task_step',{expectedVersion:2,id:'implement',state:'reported_done',evidenceIds:['read-overlap']});
  await call('deliver','cbim_delivery_prepare',{expectedVersion:3,summary:'成果',limitations:[]});
  if(order==='after-delivery')finishWrite();
  emit('run.settled',{status:'completed'});return events;
}
it.each(['after-delivery','before-delivery'] as const)('副作用%s才完成，先前并发读取不能成为交付验证证据',async order=>{
  const events=await overlappingWrite(order);expect(()=>validateWorkflowEvidence(events,task,bindings)).toThrow();
});
it('副作用完成后才开始的读取保留有效交付资格',async()=>{
  const events=await overlappingWrite('before-read');expect(validateWorkflowEvidence(events,task,bindings)?.checks[0].toolCallIds).toEqual(['read-overlap']);
});
it('副作用明确失败且结束后重新读取的成功证据仍可交付',async()=>{
  const events=await overlappingWrite('before-read',true);expect(validateWorkflowEvidence(events,task,bindings)?.checks[0].toolCallIds).toEqual(['read-overlap']);
});
it.each(['source','scope','hash','plan','proof','sequence','after-effect','native-effects','effect-scope'] as const)('canonical的%s变化不能借已有proof交付',async kind=>{
  const events=await canonical();if(kind==='source')events[0].data.workflowContracts=[];
  if(kind==='scope')(events.find(event=>event.type==='tool.finished'&&event.data.id==='read-one')!.data.receipt as ToolReceipt).runId='old';
  if(kind==='hash')(events.find(event=>event.type==='tool.finished'&&event.data.id==='read-one')!.data.receipt as ToolReceipt).resultHash='0'.repeat(64);
  if(kind==='plan')(events.find(event=>event.type==='task.updated')!.data.progress as TaskProgress).goal='changed';
  if(kind==='proof')(events.filter(event=>event.type==='task.updated').at(-1)!.data.progress as TaskProgress).delivery!.workflow!.checks=[];
  if(kind==='sequence')events[3].seq++;
  if(kind==='native-effects')events.find(event=>event.type==='tool.allowed'&&event.data.id==='write-one')!.data.effects=['read'];
  if(kind==='effect-scope')events.find(event=>event.type==='tool.allowed'&&event.data.id==='step')!.data.scope={kind:'workspace',workspaceId:'other'};
  if(kind==='after-effect'){const last=events.pop()!;events.push({...identity,seq:events.length+1,type:'tool.allowed',data:{id:'late',name:'write',effects:['business-write']}});events.push({...last,seq:events.length+1})}
  expect(()=>validateWorkflowEvidence(events,task,bindings)).toThrow();
});
