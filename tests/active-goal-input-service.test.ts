import {expect,it,vi} from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {fixture,request} from './helpers';
import {seedTeam} from './team-fixture';
import {FileDispatchStore} from '../src/backend/main/persistence/tasks/dispatch-store';
import {RunJournal} from '../src/backend/main/persistence/tasks/run-journal';
import {WorkspaceDispatchService} from '../src/backend/scheduler-engine/execution/dispatch-service';
import {toolReceipt} from '../src/backend/core/tools/receipts';
import {jsonToolResult} from '../src/backend/core/tools/results';
import type {GoalPlanInput,GoalReviewInput} from '../src/backend/core/tasks/scope-goal';
import type {TaskSpec} from '../src/backend/core/brain/types';
import type {DispatchCommand,DispatchMutation} from '../src/backend/core/tasks/dispatch-storage';
import {MemberExecutionManager,type MemberExecutionPorts} from '../src/backend/scheduler-engine/execution/member-execution';
import {WorkspaceExecutionLease} from '../src/backend/scheduler-engine/execution/workspace-lease';

const plan=(expectedRevision=1):GoalPlanInput=>({expectedRevision,objective:'维护知识',constraints:['不改业务文件'],criteria:[{id:'c1',text:'提交可追溯',kind:'evidence'}],assignments:[{agentId:'cbim:main',moduleIds:[],criterionIds:['c1'],reason:'知识治理'}],reason:'保存完整目标'});
const review=(expectedRevision=2):GoalReviewInput=>({expectedRevision,decision:'complete',checks:[{criterionId:'c1',outcome:'satisfied',reason:'已核实',evidence:[{kind:'main-knowledge',toolCallIds:['commit']}]}],superseded:[],gaps:[],reason:'完整审阅'});
async function setup(){
  const f=await fixture(),entry=await f.app.dispatch('add',{path:f.a}),workspace=f.app.workspace(entry.id),directory=path.join(f.user,'active-input-dispatch'),store=new FileDispatchStore(directory,entry.id);
  const rootSessionId='active-input-root',runId='active-input-run',identity={workspaceId:entry.id,rootSessionId},task:TaskSpec={mode:'chat',taskId:rootSessionId,workspaceId:entry.id,root:f.a,goal:'原始输入',moduleIds:[],agentId:'cbim:main',acceptance:[]};
  const journal=new RunJournal(path.join(f.user,'active-input-log'),task,runId),service=new WorkspaceDispatchService(workspace,store,{inspectMain:()=>RunJournal.read(journal.directory),inspectMember:async()=>{throw Error('no member')}});
  const binding=await service.conversationBinding(task),scope=await service.openScope(identity,'active-input-scope',{message:'原始输入'},runId);
  await journal.init();await journal.append({type:'run.started',data:{task,message:'原始输入',conversationBinding:binding}});
  const prepare=(message='新增要求',queueId:string=randomUUID(),signal=new AbortController().signal)=>service.activeInputs.prepare(identity,scope.scopeId,runId,queueId,{message},signal);
  const accept=async(message='新增要求',queueId:string=randomUUID())=>{
    const prepared=await prepare(message,queueId),requested=await journal.append({type:'engine.status',data:{metric:'insertion',state:'requested',message,activeInput:prepared.token}}),accepted=await journal.append({type:'engine.status',data:{metric:'insertion',state:'accepted',message,activeInput:prepared.token}});
    const receipt={...prepared.token,requestedSeq:requested.seq,acceptedSeq:accepted.seq},outcome={status:'accepted' as const,input:{message},receipt};
    const record=await service.activeInputs.resolve(identity,prepared.token,outcome);return {prepared,record,outcome};
  };
  const commit=async()=>{const snapshot=await workspace.snapshot(),input=request(snapshot,[{path:'.cbim/README.md',text:'# 真实知识修改'}]),result=await workspace.commit(input),call={id:'commit',name:'cbim_knowledge_commit',input},decision={allow:true,effects:['knowledge-write' as const],scope:{kind:'knowledge' as const,workspaceId:entry.id}},wire=jsonToolResult('cbim_knowledge_commit',result),receipt=toolReceipt({workspaceId:entry.id,taskId:rootSessionId,runId},call,decision,'succeeded',wire);await journal.append({type:'tool.allowed',data:{...call,...decision}});await journal.append({type:'tool.finished',data:{id:call.id,name:call.name,isError:false,result:wire,receipt}})};
  return {...f,entry,workspace,directory,store,service,identity,task,scope,runId,journal,prepare,accept,commit,read:()=>service.goals.inspect(identity,scope.scopeId),finish:async()=>{await journal.append({type:'run.settled',data:{status:'completed'}});return RunJournal.read(journal.directory)},cleanup:async()=>{await store.close();await f.cleanup()}};
}

async function business(f:Awaited<ReturnType<typeof setup>>,scopeId=f.scope.scopeId,runId=f.runId){
  const team=await seedTeam(f.workspace),snapshot=await f.workspace.snapshot(),moduleId=team.input.moduleId,definition=JSON.parse(snapshot.files.find(file=>file.path===moduleId+'/module.json')!.text);
  definition.maintenance={bindingId:'active-input-owner',maintainerPersonIds:['owner'],revision:1,state:'active',confirmation:{recordId:'active-input-review',source:'local_user',confirmedAt:new Date().toISOString()}};
  await f.workspace.commit(request(snapshot,[{path:'.cbim/team/people.json',text:JSON.stringify({people:[{id:'owner',name:'维护人',team:'.cbim/team'}]})},{path:moduleId+'/module.json',text:JSON.stringify(definition)}]));
  await f.service.goals.plan(f.identity,scopeId,runId,'business-plan-'+scopeId,{expectedRevision:1,objective:'核实业务产物',constraints:[],criteria:[{id:'verified',text:'真实文件证据',kind:'evidence'}],assignments:[{agentId:'cbim:executor',moduleIds:[moduleId],criterionIds:['verified'],reason:'独立执行'}],reason:'新周期计划'});
  return {...f.identity,commandId:'business-dispatch-'+scopeId,expectedParentRevision:1,task:{assigneeAgentId:'cbim:executor',moduleIds:[moduleId],goal:'核实业务产物',acceptance:[{id:'verified',text:'真实文件证据'}],prerequisites:[]}};
}

it('真实旧完成审阅后接收补充，只增版一次并清审阅，必须重新规划审阅才能完成',async()=>{
  const f=await setup();try{
    await f.service.goals.plan(f.identity,f.scope.scopeId,f.runId,'plan',plan());await f.commit();const before=await f.service.goals.review(f.identity,f.scope.scopeId,f.runId,'review',review());
    const result=await f.accept(),after=await f.read();expect(after.goal).toMatchObject({revision:4,inputRevision:2,input:before.goal!.input,plan:before.goal!.plan});expect(after.goal!.review).toBeUndefined();
    expect(await f.service.activeInputs.resolve(f.identity,result.prepared.token,result.outcome)).toEqual(result.record);
    expect((await f.prepare('新增要求',result.prepared.token.queueId)).record).toEqual(result.record);expect((await f.read()).goal!.revision).toBe(4);
    await expect(f.service.goals.review(f.identity,f.scope.scopeId,f.runId,'stale-review',review(4))).rejects.toMatchObject({code:'GOAL_REPLAN_REQUIRED'});
    await f.service.goals.plan(f.identity,f.scope.scopeId,f.runId,'new-plan',plan(4));await f.service.goals.review(f.identity,f.scope.scopeId,f.runId,'new-review',review(5));
    const closed=await f.service.closeScope(f.identity,f.scope.scopeId,'completed',await f.finish());expect(closed.outcome).toBe('completed');expect(closed.goal!.input).toEqual(f.scope.goal!.input);
  }finally{await f.cleanup()}
});

it('普通无计划对话接收补充不造计划，持久重开保持接收事实',async()=>{
  const f=await setup();try{
    await f.accept();const after=await f.read();expect(after.goal).toMatchObject({revision:2,inputRevision:2});expect(after.goal!.plan).toBeUndefined();
    const closed=await f.service.closeScope(f.identity,f.scope.scopeId,'completed',await f.finish());expect(closed.outcome).toBe('completed');
    const reader=new FileDispatchStore(f.directory,f.entry.id);try{expect((await reader.read()).scopes![0]).toEqual(closed)}finally{await reader.close()}
  }finally{await f.cleanup()}
});

it.each(['pending','unknown'] as const)('%s 连普通完成例外都拒绝，但可取消封存且不改变旧目标',async status=>{
  const f=await setup();try{
    const prepared=await f.prepare();if(status==='unknown')await f.service.activeInputs.resolve(f.identity,prepared.token,{status:'unknown',reason:'发送回复未确认'});
    expect((await f.read()).goal).toEqual(f.scope.goal);
    await expect(f.service.goals.plan(f.identity,f.scope.scopeId,f.runId,'plan',plan())).rejects.toMatchObject({code:'GOAL_ACTIVE_INPUT_UNRESOLVED'});
    await expect(f.service.closeScope(f.identity,f.scope.scopeId,'completed',await f.finish())).rejects.toMatchObject({code:'GOAL_ACTIVE_INPUT_UNRESOLVED'});
    expect((await f.service.closeScope(f.identity,f.scope.scopeId,'cancelled')).activeInputs![0].status).toBe(status);
  }finally{await f.cleanup()}
});

it('发送前停止不创建记录；已准备后明确未发送只结算rejected，不改变目标',async()=>{
  const f=await setup();try{
    const signal=AbortSignal.abort();await expect(f.prepare('停止前',randomUUID(),signal)).rejects.toMatchObject({code:'QUEUE_INSERT_STOPPED'});expect((await f.read()).activeInputs).toBeUndefined();
    const prepared=await f.prepare();await f.service.activeInputs.resolve(f.identity,prepared.token,{status:'rejected',reason:'停止发生在发送前'});
    expect((await f.read()).goal).toEqual(f.scope.goal);expect((await f.prepare('新增要求',prepared.token.queueId)).fresh).toBe(false);
    await expect(f.prepare('改写原请求',prepared.token.queueId)).rejects.toMatchObject({code:'GOAL_ACTIVE_INPUT_CONFLICT'});
    expect((await f.service.closeScope(f.identity,f.scope.scopeId,'completed',await f.finish())).outcome).toBe('completed');
  }finally{await f.cleanup()}
});

it('ACK后存储失败保留pending，canonical接收记录不能让旧目标成功；缺失ledger同样拒绝',async()=>{
  const f=await setup();try{
    const original=f.store.transact.bind(f.store);vi.spyOn(f.store,'transact').mockImplementation((command,work)=>command.commandId.startsWith('active-input-resolve-')?Promise.reject(Error('disk unavailable')):original(command,work));
    await expect(f.accept()).rejects.toThrow('disk unavailable');const scope=await f.read(),summary=await f.finish();expect(scope.activeInputs![0].status).toBe('pending');
    await expect(f.service.closeScope(f.identity,f.scope.scopeId,'completed',summary)).rejects.toMatchObject({code:'GOAL_ACTIVE_INPUT_UNRESOLVED'});
    const missing={...scope,activeInputs:undefined};await expect(f.service.goals.validateActiveInputs(missing,summary)).rejects.toMatchObject({code:'GOAL_ACTIVE_INPUT_PROOF'});
  }finally{await f.cleanup()}
});

it('输入版本32与正文上限在原生发送之前拒绝，waiting不能重置次数',async()=>{
  const f=await setup();try{
    await expect(f.prepare('a'.repeat(256001))).rejects.toMatchObject({code:'GOAL_ACTIVE_INPUT_INVALID'});
    for(let i=0;i<31;i++)await f.accept('补充'+i);
    const before=await f.read();expect(before.goal!.inputRevision).toBe(32);await expect(f.prepare()).rejects.toMatchObject({code:'GOAL_ACTIVE_INPUT_LIMIT'});expect(await f.read()).toEqual(before);
    await f.service.goals.plan(f.identity,f.scope.scopeId,f.runId,'plan',plan(32));await f.service.goals.review(f.identity,f.scope.scopeId,f.runId,'wait',{expectedRevision:33,decision:'awaiting_user',checks:[{criterionId:'c1',outcome:'unmet',reason:'仍缺输入',evidence:[]}],superseded:[],gaps:['缺输入'],reason:'用户补充'});
    const parked=await f.service.parkScope(f.identity,f.scope.scopeId,await f.finish(),[f.runId]);
    await expect(f.service.continuations.accept({...f.identity,scopeId:f.scope.scopeId,waitId:parked.wait!.waitId,expectedGoalRevision:34,expectedInputRevision:32,commandId:randomUUID(),input:{message:'再次补充'},options:{provider:'test',model:'test',profileId:randomUUID(),permission:'read'}},'next-run')).rejects.toMatchObject({code:'GOAL_INPUT_LIMIT'});
  }finally{await f.cleanup()}
});

it('真实关闭unknown后同root新周期仍可规划、派发并持久领取，旧记录不变',async()=>{
  const f=await setup();let members:MemberExecutionManager|undefined;
  try{
    const prepared=await f.prepare();await f.service.activeInputs.resolve(f.identity,prepared.token,{status:'unknown',reason:'真实发送结果未核实'});
    const closed=await f.service.closeScope(f.identity,f.scope.scopeId,'failed'),scopeId='fresh-business-scope',runId='fresh-main-run';
    await f.service.openScope(f.identity,scopeId,{message:'明确新建周期核实'},runId);
    const input=await business(f,scopeId,runId),assigned=await f.service.dispatchTask(input,scopeId),lease=new WorkspaceExecutionLease();
    // 到达 create 之前已真实落盘 claim；此测试只验证领取，不伪造模型或候选执行。
    const create=vi.fn<Awaited<ReturnType<MemberExecutionPorts['prepare']>>['create']>(async()=>{throw Error('test stops after persisted claim')});
    members=new MemberExecutionManager(f.workspace,f.store,{acquire:(key,permission,instance)=>lease.acquire(key,permission,instance),prepare:async()=>({model:{id:'test-provider',model:'test-model',name:'测试',api:'openai-completions',auth:'none',baseUrl:'https://example.test/v1',contextWindow:65536,maxTokens:1000,reasoning:false},create}),inspect:async()=>{throw Error('no model was started')}});
    const receipt=await members.start({...f.identity,taskId:assigned.taskId,commandId:'fresh-claim',expectedRevision:1,options:{permission:'read'}});
    await members.waitForSettlement({...f.identity,taskId:assigned.taskId});
    const stored=await f.store.read(),run=stored.runs!.find(item=>item.binding.runId===receipt.runId)!;
    expect(create).toHaveBeenCalledTimes(1);expect(run.binding.taskId).toBe(assigned.taskId);expect(run.status).toBe('interrupted');
    expect(stored.outbox.find(message=>message.messageId===run.assignmentMessageId)).toMatchObject({kind:'assignment',claim:{runId:receipt.runId},delivery:'processed'});
    expect(stored.scopes!.find(scope=>scope.scopeId===f.scope.scopeId)).toEqual(closed);
    expect(stored.graphs[0].tasks.find(task=>task.taskId===assigned.taskId)).toMatchObject({scopeId,runIds:[receipt.runId]});
  }finally{await members?.close();await f.cleanup()}
});

it('真实完整派发变更改cause仍不能穿过pending，拒绝不写journal；解除后原变更可提交',async()=>{
  const f=await setup();try{
    const input=await business(f),original=f.store.transact.bind(f.store);let captured:{command:DispatchCommand;mutation:DispatchMutation}|undefined;
    const capture=vi.spyOn(f.store,'transact').mockImplementation(async(command,work)=>{
      if(command.commandId!==input.commandId)return original(command,work);
      captured={command:structuredClone(command),mutation:structuredClone(await work(await f.store.read()))};throw Error('capture before persistence');
    });
    await expect(f.service.dispatchTask(input,f.scope.scopeId)).rejects.toThrow('capture before persistence');capture.mockRestore();
    if(!captured?.mutation.batch)throw Error('missing real dispatch mutation');
    expect(captured.mutation.members).toHaveLength(1);expect(captured.mutation.sessions).toHaveLength(1);expect(captured.mutation.messages).toHaveLength(1);
    const prepared=await f.prepare(),before=await f.store.read(),journalBefore=await fs.readFile(path.join(f.directory,'dispatch.jsonl'));
    const bypass=structuredClone(captured.mutation);bypass.batch!.cause='task.created';
    await expect(f.store.transact(captured.command,async()=>bypass)).rejects.toMatchObject({code:'GRAPH_INPUT_INVALID'});
    expect(await f.store.read()).toEqual(before);expect(await fs.readFile(path.join(f.directory,'dispatch.jsonl'))).toEqual(journalBefore);
    await f.service.activeInputs.resolve(f.identity,prepared.token,{status:'rejected',reason:'确认未发送'});
    await expect(f.store.transact(captured.command,async()=>captured!.mutation)).resolves.toEqual(captured.mutation.receipt);
    const saved=await f.store.read();expect(saved.graphs[0].tasks).toHaveLength(1);expect(saved.outbox).toHaveLength(1);expect(saved.runs).toEqual([]);
  }finally{await f.cleanup()}
});
