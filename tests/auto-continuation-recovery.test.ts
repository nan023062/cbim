import {expect,it,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fixture} from './helpers';
import {AutoCollaboration} from '../src/logic/dispatch/runtime/auto-collaboration';
import {WorkspaceExecutionLease} from '../src/logic/execution/admission/workspace-lease';
import {WorkspaceDispatchService} from '../src/logic/dispatch/runtime/dispatch-service';
import type {ExecutionCollaboration,WorkspaceExecutionManager} from '../src/logic/conversation/runtime/execution-manager';
import type {MemberExecutionManager} from '../src/logic/team/runtime/member-execution';
import {FileDispatchStore} from '../src/logic/dispatch/storage/dispatch-store';
import {RunJournal} from '../src/logic/execution/storage/run-journal';
import type {TaskSpec} from '../src/logic/execution/rules/types';
import type {GoalContinuationRequest} from '../src/logic/tasks/rules/scope-continuation';

async function setup(){
  const f=await fixture(),entry=await f.app.dispatch('add',{path:f.a}),workspace=f.app.workspace(entry.id),identity={workspaceId:entry.id,rootSessionId:'root'},directory=path.join(f.user,'recovery-dispatch');
  const store=new FileDispatchStore(directory,entry.id),dispatch=new WorkspaceDispatchService(workspace,store,{inspectMain:async()=>RunJournal.read(journal.directory),inspectMember:async()=>{throw Error('no member expected')}});
  const task:TaskSpec={taskId:identity.rootSessionId,workspaceId:identity.workspaceId,root:f.a,mode:'chat',goal:'原目标',agentId:'cbim:main',moduleIds:[],acceptance:[]},binding=await dispatch.conversationBinding(task);
  const scope=await dispatch.openScope(identity,'scope',{message:'原始目标'}),journal=new RunJournal(path.join(f.user,'main-journal'),task,'first-main');await journal.init();await journal.append({type:'run.started',data:{task,message:'原始目标',conversationBinding:binding}});
  await dispatch.goals.plan(identity,scope.scopeId,'first-main','plan',{expectedRevision:1,objective:'明确输出',constraints:[],criteria:[{id:'c',text:'先补充格式',kind:'human'}],assignments:[{agentId:'cbim:main',moduleIds:[],criterionIds:['c'],reason:'整理需求'}],reason:'等待补充'});
  await dispatch.goals.review(identity,scope.scopeId,'first-main','review',{expectedRevision:2,decision:'awaiting_user',checks:[{criterionId:'c',outcome:'needs_human',reason:'缺少用户补充',evidence:[]}],superseded:[],gaps:['格式'],reason:'请选择格式'});
  await journal.append({type:'run.settled',data:{status:'completed'}});
  const parked=await dispatch.parkScope(identity,scope.scopeId,await RunJournal.read(journal.directory),['first-main']);
  const options={provider:'fixture',model:'fixture',profileId:randomUUID(),permission:'ask' as const,allowNativeExecution:true};
  const request:GoalContinuationRequest={...identity,scopeId:scope.scopeId,waitId:parked.wait!.waitId,expectedGoalRevision:3,expectedInputRevision:1,commandId:randomUUID(),input:{message:'请使用列表'},options:{provider:options.provider,model:options.model,profileId:options.profileId,permission:options.permission}};
  let hooks!:ExecutionCollaboration;
  const execution={attachCollaboration:(value:ExecutionCollaboration)=>{hooks=value},continueFromResults:vi.fn(),collaborationReady:vi.fn(),pauseCollaboration:vi.fn(),cancelPendingLaunches:vi.fn()},members={stop:vi.fn(),waitForSettlement:vi.fn(),start:vi.fn()},issues=vi.fn();
  const coordinator=new AutoCollaboration(workspace,dispatch,members as unknown as MemberExecutionManager,execution as unknown as WorkspaceExecutionManager,new WorkspaceExecutionLease(),issues);
  await coordinator.initialize();
  return {f,identity,store,dispatch,scope,parked,task,options,request,directory,coordinator,execution,members,issues,hooks,cleanup:async()=>{await coordinator.close();await store.close();await f.cleanup()}};
}

it('Auto补充事务真实落盘后读取失败，只关闭本次run对应的意图并清除等待占位，不启动或重复重放',async()=>{
  const f=await setup();try{
    const transact=f.store.transact.bind(f.store),read=f.store.read.bind(f.store);let failNextRead=false;
    vi.spyOn(f.store,'transact').mockImplementation(async(command,prepare)=>{const result=await transact(command,prepare);if(command.commandId==='scope-continue-'+f.request.commandId)failNextRead=true;return result});
    vi.spyOn(f.store,'read').mockImplementation(async()=>{if(failNextRead){failNextRead=false;throw Error('故障注入：提交后read失败')}return read()});
    const close=vi.spyOn(f.dispatch,'closeScope'),launchModel=vi.fn(),runId=randomUUID();
    await expect(f.hooks.acceptContinuation!(f.request,f.task,runId).then(()=>launchModel(runId))).rejects.toThrow('提交后read失败');
    const receipt=await f.dispatch.continuations.inspect({...f.identity,scopeId:f.scope.scopeId,commandId:f.request.commandId});
    expect(receipt).toMatchObject({scopeStatus:'closed',continuation:{runId,input:f.request.input,wait:f.parked.wait}});
    expect((await f.store.read()).scopes![0]).toMatchObject({outcome:'interrupted',continuations:[{runId}]});
    expect(close).toHaveBeenCalledTimes(1);expect(close).toHaveBeenCalledWith(f.identity,f.scope.scopeId,'interrupted');
    expect(f.hooks.waiting?.(f.task.taskId)).toBe(false);expect(f.coordinator.busy(f.task.taskId)).toBe(false);
    expect(launchModel).not.toHaveBeenCalled();expect(f.members.start).not.toHaveBeenCalled();expect(f.execution.continueFromResults).not.toHaveBeenCalled();
    const before=await fs.readFile(path.join(f.directory,'dispatch.jsonl'),'utf8');
    await expect(f.hooks.acceptContinuation!(f.request,f.task,randomUUID()).then(()=>launchModel('duplicate'))).rejects.toMatchObject({code:'GOAL_WAIT_CONFLICT'});
    expect(close).toHaveBeenCalledTimes(1);expect(await fs.readFile(path.join(f.directory,'dispatch.jsonl'),'utf8')).toBe(before);expect(launchModel).not.toHaveBeenCalled();
  }finally{await f.cleanup()}
});

it('Auto迟到重复补充读到不同run的旧receipt，不关闭原活动周期且不重复启动',async()=>{
  const f=await setup();try{
    const close=vi.spyOn(f.dispatch,'closeScope'),launchModel=vi.fn(),originalRun=randomUUID();
    await f.hooks.acceptContinuation!(f.request,f.task,originalRun);launchModel(originalRun);
    const accepted=await f.store.read();expect(accepted.scopes![0]).toMatchObject({status:'active',continuations:[{runId:originalRun}]});
    await expect(f.hooks.acceptContinuation!(f.request,f.task,randomUUID()).then(()=>launchModel('duplicate'))).rejects.toMatchObject({code:'GOAL_WAIT_CONFLICT'});
    expect(close).not.toHaveBeenCalled();expect(await f.store.read()).toEqual(accepted);expect(f.coordinator.busy(f.task.taskId)).toBe(true);expect(f.hooks.waiting?.(f.task.taskId)).toBe(false);
    expect(launchModel).toHaveBeenCalledExactlyOnceWith(originalRun);expect(f.members.start).not.toHaveBeenCalled();expect(f.execution.continueFromResults).not.toHaveBeenCalled();
    expect(()=>f.coordinator.tools(f.task,originalRun,f.options)).not.toThrow();
  }finally{await f.cleanup()}
});
