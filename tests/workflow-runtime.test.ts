import fs from 'node:fs/promises';
import path from 'node:path';
import {expect,it,vi} from 'vitest';
import type {WorkflowContractBinding} from '../src/backend/core/tasks/execution-context';
import type {EngineContext,ToolCall} from '../src/backend/core/brain/types';
import {nativeToolDescriptor} from '../src/backend/core/tools/native-tools';
import {progressTool} from '../src/backend/core/tasks/progress-tools';
import {validateWorkflowEvidence} from '../src/backend/core/tasks/workflow-evidence';
import {jsonToolResult} from '../src/backend/core/tools/results';
import {artifactRuntimeFixture,artifactBinding,deferred,invoke} from './artifact-runtime-fixture';

const bindings:WorkflowContractBinding[]=[{moduleId:'.cbim/workspace/module',workflowId:'workflow',workflowVersion:'workflow-v1',contract:{version:1,beforeEffects:{requirePlan:true},delivery:{requiredToolEvidence:[{id:'read-proof',toolName:'read'}]}}}];
const describe=(call:ToolCall)=>progressTool(call.name,call.input)??nativeToolDescriptor(call.name)!;
async function plan(c:EngineContext,id='plan',version=0,goal=c.task.goal){return invoke(c,'cbim_task_plan',id,{expectedVersion:version,goal,acceptance:c.task.acceptance,reason:'执行约定',steps:[{id:'verify',title:'核实产物',owner:'成员'}]})}
async function progress(c:EngineContext,id:string){return (await invoke(c,'cbim_task_inspect',id,{})).plan}

it('一次可信分类后先核计划再审批，错误目标不能放行，交付必须含当前有效read回执',async()=>{
  const classifications=vi.fn(describe),policy=vi.fn(async(name:string)=>({allow:true,effects:name==='write'?['business-write'] as const:name==='read'?['read'] as const:['maintenance'] as const,scope:{kind:'workspace' as const,workspaceId:artifactBinding.workspaceId}}));
  const f=await artifactRuntimeFixture(async c=>{
    const denied=await c.beforeTool({id:'no-plan',name:'write',input:{path:'File.txt',content:'bad'}});expect(denied.allow).toBe(false);expect(denied.reason).toContain('WORKFLOW_');expect(policy).not.toHaveBeenCalled();expect(await fs.readFile(path.join(c.task.root,'File.txt'),'utf8')).toBe('actual bytes');
    await plan(c,'wrong-plan',0,'different goal');expect((await c.beforeTool({id:'wrong-goal',name:'write',input:{path:'File.txt',content:'bad'}})).allow).toBe(false);expect(policy.mock.calls.filter(([name])=>name==='write')).toHaveLength(0);
    await plan(c,'actual-plan',1);expect((await c.beforeTool({id:'write',name:'write',input:{path:'File.txt',content:'written'}})).allow).toBe(true);await fs.writeFile(path.join(c.task.root,'File.txt'),'written');await c.emit({type:'tool.finished',data:{id:'write',name:'write',result:jsonToolResult('write',{written:true}),isError:false}});
    let current=await progress(c,'inspect-1');await invoke(c,'cbim_task_step','step-write',{expectedVersion:current.version,id:'verify',state:'reported_done',evidenceIds:['write']});current=await progress(c,'inspect-2');expect((await c.beforeTool({id:'early-delivery',name:'cbim_delivery_prepare',input:{expectedVersion:current.version,summary:'premature',limitations:[]}})).allow).toBe(true);
    await expect(c.taskTools!.call('cbim_delivery_prepare',{expectedVersion:current.version,summary:'premature',limitations:[]})).rejects.toThrow();await c.emit({type:'tool.finished',data:{id:'early-delivery',name:'cbim_delivery_prepare',isError:true,result:jsonToolResult('cbim_delivery_prepare',{error:'missing read'})}});
    await invoke(c,'read','real-read',{path:'File.txt'});current=await progress(c,'inspect-3');await invoke(c,'cbim_task_step','step-read',{expectedVersion:current.version,id:'verify',state:'reported_done',evidenceIds:['real-read']});current=await progress(c,'inspect-4');await invoke(c,'cbim_delivery_prepare','delivery',{expectedVersion:current.version,summary:'已按约定核实',limitations:[]});
  },{workflowContracts:bindings,describeTool:classifications,policy});try{
    const summary=await (await f.start()).done;expect(summary.status).toBe('completed');expect(summary.taskProgress?.delivery?.workflow?.checks[0].toolCallIds).toEqual(['real-read']);expect(()=>validateWorkflowEvidence(summary.events,f.task,bindings)).not.toThrow();expect(classifications.mock.calls.filter(([call])=>call.id==='write')).toHaveLength(1);expect(policy.mock.calls.filter(([name])=>name==='write')).toHaveLength(1);
  }finally{await f.cleanup()}
});

it('审批等待期间计划被修订则旧调用拒绝且不放行副作用',async()=>{
  const entered=deferred(),release=deferred();const f=await artifactRuntimeFixture(async c=>{
    await plan(c);const pending=c.beforeTool({id:'write-pending',name:'write',input:{path:'File.txt',content:'never'}});await entered.promise;await plan(c,'revise',1);release.resolve();const decision=await pending;expect(decision.allow).toBe(false);expect(decision.reason).toContain('WORKFLOW_PLAN_STALE');
  },{workflowContracts:bindings,describeTool:describe,policy:async name=>{if(name==='write'){entered.resolve();await release.promise}return {allow:true,effects:name==='write'?['business-write']:['maintenance'],scope:{kind:'workspace',workspaceId:artifactBinding.workspaceId}}}});try{const summary=await (await f.start()).done;expect(summary.status).toBe('completed');expect(summary.events.some(event=>event.type==='tool.allowed'&&event.data.id==='write-pending')).toBe(false);expect(summary.taskProgress?.version).toBe(2)}finally{release.resolve();await f.cleanup()}
});

it('可信分类中的知识写入仍清除旧计划证据，但不借用业务计划门禁扩展授权',async()=>{
  const f=await artifactRuntimeFixture(async c=>{
    await plan(c);await invoke(c,'read','old-read',{path:'File.txt'});await invoke(c,'cbim_task_step','step',{expectedVersion:1,id:'verify',state:'reported_done',evidenceIds:['old-read']});
    const decision=await c.beforeTool({id:'knowledge-write',name:'cbim_knowledge_commit',input:{}});expect(decision.allow).toBe(true);await c.emit({type:'tool.finished',data:{id:'knowledge-write',name:'cbim_knowledge_commit',result:jsonToolResult('cbim_knowledge_commit',{committed:true}),isError:false}});
    const current=await progress(c,'after-knowledge');expect(current.version).toBe(3);expect(current.steps[0]).toMatchObject({state:'pending',evidence:[]});
    await expect(c.taskTools!.call('cbim_task_step',{expectedVersion:3,id:'verify',state:'reported_done',evidenceIds:['old-read']})).rejects.toThrow();
  },{workflowContracts:bindings,describeTool:call=>call.name==='cbim_knowledge_commit'?{effects:['knowledge-write'],native:false}:describe(call),policy:async name=>({allow:true,effects:name==='cbim_knowledge_commit'?['knowledge-write']:name==='read'?['read']:['maintenance'],scope:{kind:'workspace',workspaceId:artifactBinding.workspaceId}})});
  try{expect((await (await f.start()).done).status).toBe('completed')}finally{await f.cleanup()}
});

it('带约定却没有分类端口或不是正式成员，拒绝启动；旧无约定保持兼容',async()=>{
  const work=vi.fn(async()=>{}),f=await artifactRuntimeFixture(work,{workflowContracts:bindings});try{await expect(f.start()).rejects.toMatchObject({code:'WORKFLOW_GATE_UNAVAILABLE'});expect(work).not.toHaveBeenCalled()}finally{await f.cleanup()}
  const main=await artifactRuntimeFixture(work,{workflowContracts:bindings,describeTool:describe});try{await expect(main.runtime.start({...main.task,mode:'chat',agentId:'cbim:main'})).rejects.toMatchObject({code:'WORKFLOW_GATE_UNAVAILABLE'});expect(work).not.toHaveBeenCalled()}finally{await main.cleanup()}
  const old=await artifactRuntimeFixture(work);try{expect((await (await old.start()).done).status).toBe('completed');expect(work).toHaveBeenCalledTimes(1)}finally{await old.cleanup()}
});

it.each(['read-finishes-first','write-finishes-first','write-fails'] as const)('副作用和读取重叠时只记录事实，必须结束后新读取才能交付（%s）',async mode=>{
  const f=await artifactRuntimeFixture(async c=>{
    await plan(c);expect((await c.beforeTool({id:'in-flight-write',name:'write',input:{path:'File.txt',content:'new bytes'}})).allow).toBe(true);
    expect((await c.beforeTool({id:'overlapping-read',name:'read',input:{path:'File.txt'}})).allow).toBe(true);
    const readResult=jsonToolResult('read',{text:await fs.readFile(path.join(c.task.root,'File.txt'),'utf8')});
    const finishRead=()=>c.emit({type:'tool.finished',data:{id:'overlapping-read',name:'read',result:readResult,isError:false}});
    if(mode!=='write-finishes-first')await finishRead();
    const during=await progress(c,'during-write');expect((await c.taskTools!.call('cbim_task_inspect',{})).content[0].text).not.toContain('overlapping-read');
    const delivery={expectedVersion:during.version,summary:'过早交付',limitations:[]};expect(await c.beforeTool({id:'pending-delivery',name:'cbim_delivery_prepare',input:delivery})).toMatchObject({allow:false,reason:expect.stringContaining('WORKFLOW_EFFECT_PENDING')});
    // 即使调用方已经经过一次性gate，执行侧仍独立阻止在途副作用期间交付。
    await expect(c.taskTools!.call('cbim_delivery_prepare',delivery)).rejects.toMatchObject({code:'WORKFLOW_EFFECT_PENDING'});
    await fs.writeFile(path.join(c.task.root,'File.txt'),'new bytes');const failed=mode==='write-fails';await c.emit({type:'tool.finished',data:{id:'in-flight-write',name:'write',result:jsonToolResult('write',{written:!failed,error:failed?'partial write':undefined}),isError:failed}});
    if(mode==='write-finishes-first')await finishRead();
    const inspected=JSON.parse((await c.taskTools!.call('cbim_task_inspect',{})).content[0].text);expect(inspected.evidence.map((item:any)=>item.toolCallId)).toEqual(failed?[]:['in-flight-write']);
    await expect(c.taskTools!.call('cbim_task_step',{expectedVersion:during.version,id:'verify',state:'reported_done',evidenceIds:['overlapping-read']})).rejects.toThrow('证据不存在');
    await invoke(c,'read','after-write-read',{path:'File.txt'});await invoke(c,'cbim_task_step','step-after-write',{expectedVersion:during.version,id:'verify',state:'reported_done',evidenceIds:['after-write-read']});await invoke(c,'cbim_delivery_prepare','verified-delivery',{expectedVersion:during.version+1,summary:'结束后重新读取核实',limitations:[]});
  },{workflowContracts:bindings,describeTool:describe});
  try{const summary=await (await f.start()).done;expect(summary.status).toBe('completed');expect(summary.toolReceipts?.find(item=>item.toolCallId==='overlapping-read')?.outcome).toBe('succeeded');expect(summary.taskProgress?.steps[0].evidence).toEqual(['after-write-read']);expect(()=>validateWorkflowEvidence(summary.events,f.task,bindings)).not.toThrow()}finally{await f.cleanup()}
});

it('副作用未结束时即使引擎返回completed也不能交付，保留unknown而不假设没有影响',async()=>{
  const f=await artifactRuntimeFixture(async c=>{
    await plan(c);expect((await c.beforeTool({id:'unknown-write',name:'write',input:{path:'File.txt',content:'maybe'}})).allow).toBe(true);await invoke(c,'read','concurrent-read',{path:'File.txt'});
    expect((await c.beforeTool({id:'unfinished-delivery',name:'cbim_delivery_prepare',input:{expectedVersion:2,summary:'不能成功',limitations:[]}})).allow).toBe(false);expect(JSON.parse((await c.taskTools!.call('cbim_task_inspect',{})).content[0].text).evidence).toEqual([]);
  },{workflowContracts:bindings,describeTool:describe});try{const summary=await (await f.start()).done;expect(summary.status).toBe('interrupted');expect(summary.unresolvedTools).toContain('unknown-write');expect(summary.taskProgress?.delivery).toBeUndefined()}finally{await f.cleanup()}
});
