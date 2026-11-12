import {it,expect} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {fixture} from './helpers';
import {hash} from '../src/backend/core/foundation/serialization';
import type {TaskSpec} from '../src/backend/core/execution/types';
import type {GoalPlanInput,GoalReviewInput} from '../src/backend/core/tasks/scope-goal';
import {goalInputRevision,goalNeedsReplan} from '../src/backend/core/tasks/scope-goal';
import type {GoalContinuationRequest} from '../src/backend/core/tasks/scope-continuation';
import {RunJournal} from '../src/backend/main/run-storage/run-journal';
import {FileDispatchStore} from '../src/backend/main/dispatch-storage/dispatch-store';
import {WorkspaceDispatchService} from '../src/backend/scheduler-engine/dispatch/dispatch-service';

const plan:GoalPlanInput={expectedRevision:1,objective:'先核实目标再交付',constraints:[],criteria:[{id:'human',text:'保留真正人工验收',kind:'human'}],assignments:[{agentId:'cbim:main',moduleIds:[],criterionIds:['human'],reason:'管理目标'}],reason:'先等待补充'};
const review:GoalReviewInput={expectedRevision:2,decision:'awaiting_user',checks:[{criterionId:'human',outcome:'needs_human',reason:'等待用户补充，不等于人工签署',evidence:[]}],superseded:[],gaps:['需补充'],reason:'等待补充输出形式'};
async function setup(mainRunIds?:string[],planningRounds=1){
  const f=await fixture(),entry=await f.app.dispatch('add',{path:f.a}),workspace=f.app.workspace(entry.id),identity={workspaceId:entry.id,rootSessionId:'main-root'},directory=path.join(f.user,'continuations'),runId='main-first';
  const store=new FileDispatchStore(directory,entry.id),journals=new Map<string,RunJournal>();
  const service=new WorkspaceDispatchService(workspace,store,{inspectMain:async(_root,id)=>RunJournal.read(journals.get(id)!.directory),inspectMember:async()=>{throw Error('no member expected')}});
  const task:TaskSpec={mode:'chat',taskId:identity.rootSessionId,workspaceId:entry.id,root:f.a,goal:'原目标',agentId:'cbim:main',moduleIds:[],acceptance:[]},binding=await service.conversationBinding(task);
  const scope=await service.openScope(identity,'scope',{message:'  原始完整目标\n不可覆盖',attachmentIds:[]});
  async function journal(id:string){const value=new RunJournal(path.join(f.user,'main-runs',id),task,id);await value.init();await value.append({type:'run.started',data:{task,message:'用户内容',conversationBinding:binding}});journals.set(id,value);return value}
  const first=await journal(runId);
  for(let i=0;i<planningRounds;i++)await service.goals.plan(identity,scope.scopeId,runId,'plan-'+i,{...plan,expectedRevision:i+1});
  await service.goals.review(identity,scope.scopeId,runId,'review',{...review,expectedRevision:planningRounds+1});
  await first.append({type:'run.settled',data:{status:'completed'}});
  const parked=await service.parkScope(identity,scope.scopeId,await RunJournal.read(first.directory),mainRunIds??[runId]);
  const input:GoalContinuationRequest={...identity,scopeId:scope.scopeId,waitId:parked.wait!.waitId,expectedGoalRevision:parked.goal!.revision,expectedInputRevision:1,commandId:randomUUID(),input:{message:'  补充：使用列表\n保留空白'},options:{provider:'fixture',model:'fixture',profileId:randomUUID(),permission:'ask'}};
  return {...f,entry,workspace,identity,directory,store,service,scope,parked,input,journal,cleanup:async()=>{await store.close();await f.cleanup()}};
}

it('显式补充原子消费等待，保留原始输入/旧计划与检查点，新的输入版本强制重规划',async()=>{
  const f=await setup();try{
    const before=await f.service.sessionRead({identity:f.identity}),runId=randomUUID(),original=structuredClone(f.input),pending=f.service.continuations.accept(f.input,runId);f.input.input.message='调用之后修改';
    const accepted=await pending;
    expect(accepted.fresh).toBe(true);expect(accepted.scope).toMatchObject({status:'active',goal:{revision:4,inputRevision:2,input:f.scope.goal!.input,plan:f.parked.goal!.plan}});
    expect(accepted.scope.wait).toBeUndefined();expect(accepted.scope.goal!.review).toBeUndefined();expect(accepted.continuation).toMatchObject({runId,input:original.input,options:original.options,wait:f.parked.wait,inputRevision:2});
    expect(goalNeedsReplan(accepted.scope.goal!)).toBe(true);expect(goalInputRevision(f.parked.goal!)).toBe(1);
    const update=await f.service.sessionRead({identity:f.identity,graphCursor:before.graph.cursor,scopeCursor:before.scopes.cursor});expect(update.graph.mode).toBe('noop');expect(update.scopes.mode).toBe('delta');
    if(update.scopes.mode!=='delta')throw Error('missing delta');expect(update.scopes.batches[0].scopes[0]).toMatchObject({status:'active',inputRevision:2,needsReplan:true});expect(update.detail).toMatchObject({mode:'updated',scope:{continuations:[accepted.continuation]}});
    const next=await f.journal(runId);
    await expect(f.service.goals.review(f.identity,f.scope.scopeId,runId,'stale-review',{...review,expectedRevision:4})).rejects.toMatchObject({code:'GOAL_REPLAN_REQUIRED'});
    const state=await f.store.read();await expect(Promise.resolve().then(()=>f.service.goals.validateDispatch(state,accepted.scope,{assigneeAgentId:'.cbim/team/dev',moduleIds:['module'],goal:'不能直接执行',acceptance:[],prerequisites:[]},f.parked.goal!.plan!.knowledgeRevision))).rejects.toMatchObject({code:'GOAL_REPLAN_REQUIRED'});
    await expect(f.service.goals.plan(f.identity,f.scope.scopeId,runId,'remove-human',{...plan,expectedRevision:4,criteria:[{id:'human',text:'改为机器检查',kind:'evidence'}]})).rejects.toMatchObject({code:'GOAL_HUMAN_REQUIRED'});
    const replanned=await f.service.goals.plan(f.identity,f.scope.scopeId,runId,'replan',{...plan,expectedRevision:4});expect(replanned.goal).toMatchObject({revision:5,inputRevision:2,plan:{inputRevision:2}});expect(goalNeedsReplan(replanned.goal!)).toBe(false);
    await f.service.goals.review(f.identity,f.scope.scopeId,runId,'review-again',{...review,expectedRevision:5});await next.append({type:'run.settled',data:{status:'completed'}});
    const settled=await RunJournal.read(next.directory);
    await expect(f.service.parkScope(f.identity,f.scope.scopeId,settled,[runId])).rejects.toMatchObject({code:'GRAPH_INPUT_INVALID'});
    const secondWait=await f.service.parkScope(f.identity,f.scope.scopeId,settled,['main-first',runId]);
    expect(secondWait.goal).toMatchObject({revision:6,inputRevision:2,review:{inputRevision:2}});expect(secondWait.continuations).toEqual([accepted.continuation]);expect(secondWait.wait!.mainRunIds).toEqual(['main-first',runId]);
  }finally{await f.cleanup()}
});

it('同一命令并发仅一个fresh，变参拒绝，换命令不能再消费同wait；关闭后只读返回原事实',async()=>{
  const f=await setup();try{
    expect(await f.service.continuations.inspect({...f.identity,scopeId:f.scope.scopeId,commandId:f.input.commandId})).toBeUndefined();
    const runs=[randomUUID(),randomUUID()],results=await Promise.all(runs.map(run=>f.service.continuations.accept(f.input,run)));
    expect(results.filter(item=>item.fresh)).toHaveLength(1);expect(results[0].continuation).toEqual(results[1].continuation);
    const original=results[0].continuation,file=path.join(f.directory,'dispatch.jsonl'),before=await fs.readFile(file,'utf8');
    const repeated=await f.service.continuations.accept(f.input,randomUUID());expect(repeated.fresh).toBe(false);expect(repeated.continuation).toEqual(original);expect(await fs.readFile(file,'utf8')).toBe(before);
    await expect(f.service.continuations.accept({...f.input,input:{message:'另一份内容'}},randomUUID())).rejects.toMatchObject({code:'COMMAND_ID_CONFLICT'});
    await expect(f.service.continuations.accept({...f.input,options:{...f.input.options,permission:'execute'}},randomUUID())).rejects.toMatchObject({code:'COMMAND_ID_CONFLICT'});
    await expect(f.service.continuations.accept({...f.input,commandId:randomUUID()},randomUUID())).rejects.toMatchObject({code:'GOAL_NOT_WAITING'});
    await f.service.closeScope(f.identity,f.scope.scopeId,'cancelled');
    const looked=await f.service.continuations.inspect({...f.identity,scopeId:f.scope.scopeId,commandId:f.input.commandId});expect(looked).toMatchObject({...f.identity,scopeId:f.scope.scopeId,scopeStatus:'closed',continuation:original});
    expect((await f.service.continuations.accept(f.input,randomUUID())).scope.status).toBe('closed');
  }finally{await f.cleanup()}
});

it('请求拒绝越权字段、跨身份、过期wait/版本、重复run和超限；失败不消费等待或记录补充',async()=>{
  const f=await setup();try{
    const attempts:[unknown,string][]=[
      [{...f.input,source:{kind:'user-continuation'}},'GOAL_CONTINUATION_INPUT'],
      [{...f.input,input:{message:'补充',attachmentIds:[]}},'GOAL_CONTINUATION_INPUT'],
      [{...f.input,input:{message:' '}},'GOAL_CONTINUATION_INPUT'],
      [{...f.input,input:{message:'a'.repeat(64_001)}},'GOAL_CONTINUATION_INPUT'],
      [{...f.input,options:{...f.input.options,allowAll:true}},'GOAL_CONTINUATION_INPUT'],
      [{...f.input,rootSessionId:'other'},'GOAL_IDENTITY'],
      [{...f.input,workspaceId:'other'},'GOAL_IDENTITY'],
      [{...f.input,waitId:'other'},'GOAL_WAIT_CONFLICT'],
      [{...f.input,expectedGoalRevision:2},'GOAL_REVISION_CONFLICT'],
      [{...f.input,expectedInputRevision:2},'GOAL_REVISION_CONFLICT'],
    ];
    for(const [input,code] of attempts)await expect(f.service.continuations.accept(input as GoalContinuationRequest,randomUUID())).rejects.toMatchObject({code});
    await expect(f.service.continuations.accept(f.input,'main-first')).rejects.toMatchObject({code:'GOAL_RUN_CONFLICT'});
    expect((await f.store.read()).scopes![0]).toEqual(f.parked);
    await f.service.closeScope(f.identity,f.scope.scopeId,'failed');await expect(f.service.continuations.accept(f.input,randomUUID())).rejects.toMatchObject({code:'GOAL_NOT_WAITING'});
  }finally{await f.cleanup()}
});

it('32轮及64次目标变更预算跨补充保留，预算不足在消费前拒绝',async()=>{
  const full=await setup(Array.from({length:32},(_,index)=>index?'earlier-'+index:'main-first'));try{await expect(full.service.continuations.accept(full.input,randomUUID())).rejects.toMatchObject({code:'GOAL_CYCLE_LIMIT'});expect((await full.store.read()).scopes![0].status).toBe('waiting')}finally{await full.cleanup()}
  const decisions=await setup(undefined,61);try{expect(decisions.parked.goal!.revision).toBe(63);await expect(decisions.service.continuations.accept(decisions.input,randomUUID())).rejects.toMatchObject({code:'GOAL_DECISION_LIMIT'});expect((await decisions.store.read()).scopes![0].status).toBe('waiting')}finally{await decisions.cleanup()}
  const last=await setup(Array.from({length:31},(_,index)=>index?'earlier-'+index:'main-first'));try{const accepted=await last.service.continuations.accept(last.input,randomUUID());expect(accepted.continuation.wait.mainRunIds).toHaveLength(31);expect(new Set([...accepted.continuation.wait.mainRunIds,accepted.continuation.runId]).size).toBe(32)}finally{await last.cleanup()}
});

it('接收后未写运行日志即崩溃，恢复关闭active而不重放；原receipt与输入保留',async()=>{
  const f=await setup();try{
    const runId=randomUUID(),accepted=await f.service.continuations.accept(f.input,runId),reader=new FileDispatchStore(f.directory,f.entry.id);
    try{const recovered=new WorkspaceDispatchService(f.workspace,reader);await recovered.recoverScopes();const receipt=await recovered.continuations.inspect({...f.identity,scopeId:f.scope.scopeId,commandId:f.input.commandId});expect(receipt).toMatchObject({scopeStatus:'closed',continuation:accepted.continuation});const state=await reader.read();expect(state.scopes![0]).toMatchObject({outcome:'interrupted',goal:{input:f.scope.goal!.input,inputRevision:2}});expect(state.runs).toEqual([]);expect((await recovered.continuations.accept(f.input,randomUUID())).fresh).toBe(false)}finally{await reader.close()}
  }finally{await f.cleanup()}
});

it('多次补充累计保留正文和运行预算，累计文本超限拒绝且当前检查点不被消费',async()=>{
  const f=await setup();try{
    let waiting=f.parked;const ids=['main-first'];
    for(let index=0;index<4;index++){
      const request={...f.input,waitId:waiting.wait!.waitId,expectedGoalRevision:waiting.goal!.revision,expectedInputRevision:goalInputRevision(waiting.goal!),commandId:randomUUID(),input:{message:'x'.repeat(64_000)}},runId=randomUUID();
      const accepted=await f.service.continuations.accept(request,runId);ids.push(runId);
      const journal=await f.journal(runId),revision=accepted.scope.goal!.revision;
      await f.service.goals.plan(f.identity,f.scope.scopeId,runId,'plan-'+runId,{...plan,expectedRevision:revision});
      await f.service.goals.review(f.identity,f.scope.scopeId,runId,'review-'+runId,{...review,expectedRevision:revision+1});await journal.append({type:'run.settled',data:{status:'completed'}});
      waiting=await f.service.parkScope(f.identity,f.scope.scopeId,await RunJournal.read(journal.directory),ids);
      expect(waiting.continuations).toHaveLength(index+1);expect(waiting.wait!.mainRunIds).toEqual(ids);
    }
    await expect(f.service.continuations.accept({...f.input,waitId:waiting.wait!.waitId,expectedGoalRevision:waiting.goal!.revision,expectedInputRevision:5,commandId:randomUUID(),input:{message:'超限'}},randomUUID())).rejects.toMatchObject({code:'GOAL_INPUT_LIMIT'});
    expect((await f.store.read()).scopes![0]).toEqual(waiting);
  }finally{await f.cleanup()}
});

it('提交与重放拒绝改写旧wait、补充原文、输入版本或没有continuation的恢复',async()=>{
  const f=await setup();try{
    const accepted=await f.service.continuations.accept(f.input,randomUUID()),scope=accepted.scope;
    const invalid=[{...scope,continuations:[]},{...scope,goal:{...scope.goal!,inputRevision:1}},{...scope,continuations:[{...accepted.continuation,input:{message:'篡改'}}]},{...scope,continuations:[{...accepted.continuation,wait:{...accepted.continuation.wait,reason:'篡改检查点'}}]}];
    for(const [index,value] of invalid.entries())await expect(f.store.transact({commandId:'tamper-'+index,fingerprint:'tamper-'+index},async()=>({scopes:[value],receipt:true}))).rejects.toMatchObject({code:'GRAPH_INPUT_INVALID'});
    const file=path.join(f.directory,'dispatch.jsonl'),original=await fs.readFile(file,'utf8');
    for(const mutate of [(value:any)=>{delete value.continuations},(value:any)=>{value.continuations[0].wait.mainRunIds=[]},(value:any)=>{value.goal.inputRevision=1},(value:any)=>{value.continuations[0].inputRevision=3}]){
      const records=original.trim().split('\n').map(line=>JSON.parse(line));mutate(records.at(-1).body.mutation.scopes[0]);let previousHash='';
      for(const record of records){record.body.previousHash=previousHash;record.checksum=hash(JSON.stringify(record.body));previousHash=record.checksum}
      await fs.writeFile(file,records.map(record=>JSON.stringify(record)).join('\n')+'\n');const reader=new FileDispatchStore(f.directory,f.entry.id);try{await expect(reader.read()).rejects.toMatchObject({code:'GRAPH_LOG_CORRUPT'})}finally{await reader.close();await fs.writeFile(file,original)}
    }
  }finally{await f.cleanup()}
});
