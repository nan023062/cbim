import {expect,it,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fixture} from './helpers';
import {Application} from '../src/bridge/server/application';
import {Paths} from '../src/logic/workspace/service/paths';
import {QuestionQueue} from '../src/logic/conversation/runtime/questions';
import {AgentCallExchange} from '../src/logic/agents/exchange';
import type {PendingQuestion} from '../src/logic/tools/rules/questions';
import type {GraphSnapshot} from '../src/logic/tasks/rules/graph-types';
import {questionContractData as data,questionContractProvider,type QuestionContractMode} from './question-tool-contract-provider';
import {questionWait,questionRun,seedQuestionContract} from './question-tool-contract-fixture';

it.each(['complete','cancel-question','invalid-output','stop'] as QuestionContractMode[])('strict real question answers are communication, not business completion evidence (%s)',async mode=>{
  const f=await fixture(),provider=await questionContractProvider(mode);let app=f.app,askSpy:{mockRestore:()=>void}|undefined;
  let realMemberConsumption=0;
  try{
    if(mode==='invalid-output'){
      const original=AgentCallExchange.prototype.Ask;
      askSpy=vi.spyOn(AgentCallExchange.prototype,'Ask').mockImplementation(async function(this:AgentCallExchange,args,signal){const result=await original.call(this,args,signal);if((args as {questions:{question:string}[]}).questions[0].question===data.memberQuestions[0].question){realMemberConsumption++;return {answers:[{question:'消费之后的错误题目，必须被输出契约拒绝',answer:'真实读取'}]}}return result});
    }
    const seed=await seedQuestionContract(app,f.a,provider),started=await app.Dispatch('loop.chat',{id:seed.entry.id,message:data.goal,options:seed.options}),identity={workspaceId:seed.entry.id,rootSessionId:started.taskId};
    const mainQuestions=()=>app.Dispatch('loop.questions',{id:seed.entry.id,taskId:started.taskId}) as Promise<PendingQuestion[]>,graph=()=>app.Dispatch('dispatch.graphSnapshot',{identity}) as Promise<GraphSnapshot>;
    await questionWait(async()=>(await mainQuestions()).length===1,'主问题卡');const main=(await mainQuestions())[0];expect(main.questions).toEqual(data.mainQuestions);expect(provider.mainRequests).toHaveLength(1);expect(provider.memberRequests).toHaveLength(0);
    await expect(app.Dispatch('loop.answerQuestion',{id:seed.entry.id,taskId:'wrong-task',questionId:main.id,answers:data.mainAnswers})).rejects.toThrow();
    await expect(app.Dispatch('loop.answerQuestion',{id:seed.entry.id,taskId:started.taskId,questionId:main.id,answers:data.mainAnswers.slice(0,1)})).rejects.toThrow();expect(await mainQuestions()).toEqual([main]);expect(provider.mainRequests).toHaveLength(1);
    await app.Dispatch('loop.answerQuestion',{id:seed.entry.id,taskId:started.taskId,questionId:main.id,answers:data.mainAnswers});await expect(app.Dispatch('loop.answerQuestion',{id:seed.entry.id,taskId:started.taskId,questionId:main.id,answers:data.mainAnswers})).rejects.toThrow();
    await questionWait(async()=>(await mainQuestions()).length===1&&provider.memberRequests.length===1,'主 Agent 转交原子调用的问题');
    const registered=(await app.Workspace(seed.entry.id).dispatchStore.Read()).agentBusinessRuns!;expect(registered).toHaveLength(1);
    const binding=registered[0].binding,memberIdentity={...identity,taskId:binding.taskId},memberQuestions=()=>app.Dispatch('dispatch.questions',memberIdentity) as Promise<PendingQuestion[]>;
    const member=(await mainQuestions())[0];expect(member.taskId).toBe(started.taskId);expect(member.questions).toEqual(data.memberQuestions);await expect(memberQuestions()).rejects.toThrow(/TASK_NOT_FOUND|当前主会话没有此派发任务/);expect(provider.mainRequests).toHaveLength(3);
    expect((await graph()).tasks).toEqual([]);
    await expect(app.Dispatch('dispatch.answerQuestion',{...memberIdentity,questionId:member.id,answers:data.memberAnswers})).rejects.toThrow();
    expect(await mainQuestions()).toEqual([member]);
    if(mode==='stop')await app.Dispatch('loop.stop',{id:seed.entry.id,taskId:started.taskId});
    else if(mode==='cancel-question'){
      // 测试直接取消域等待以观察合法 cancelled wire；不是 UI 用户回答，也不是整任务 stop。
      const queue=(app.Execution(seed.entry.id) as unknown as {questions:QuestionQueue}).questions;queue.Cancel(started.taskId);
    }else await app.Dispatch('loop.answerQuestion',{id:seed.entry.id,taskId:started.taskId,questionId:member.id,answers:data.memberAnswers});
    await questionWait(async()=>(await seed.records()).scopes[0].status==='closed'&&app.runtime.Snapshot().pressure.activeRuns===0,'真实结算');
    const records=await seed.records(),finalGraph=await graph(),thread=await app.Execution(seed.entry.id).Thread(started.taskId),summary=await questionRun(f.user,seed.entry.id,binding.taskId,binding.runId);
    expect(thread).toHaveLength(1);expect(records.runs).toEqual([]);expect(finalGraph.tasks).toEqual([]);
    expect((await app.Workspace(seed.entry.id).dispatchStore.Read()).agentBusinessRuns).toEqual([expect.objectContaining({binding,status:'closed'})]);
    expect(summary.events[0].data.agentCall).toMatchObject({callerTaskId:started.taskId,callerRunId:started.runId,toolCallId:'question-call',taskId:binding.taskId,runId:binding.runId});
    const frames=thread[0].events.filter(e=>e.type==='tool.updated'&&e.data.id==='question-call');
    expect(frames.filter(e=>e.data.agentCallState==='waiting')).toHaveLength(1);
    expect(frames.filter(e=>e.data.agentCallState==='running')).toHaveLength(mode==='stop'?0:1);
    expect(await mainQuestions()).toEqual([]);await expect(memberQuestions()).rejects.toThrow(/TASK_NOT_FOUND|当前主会话没有此派发任务/);expect(thread[0].toolReceipts?.find(receipt=>receipt.toolCallId==='question-main-ask')?.outcome).toBe('succeeded');
    const ask=summary.toolReceipts?.find(receipt=>receipt.toolCallId==='question-member-ask');
    if(mode==='stop'){
      expect(records.scopes[0]).toMatchObject({outcome:'cancelled'});expect(summary.status).toBe('cancelled');expect(summary.taskProgress?.delivery).toBeUndefined();expect(provider.mainRequests).toHaveLength(3);expect(provider.memberRequests).toHaveLength(1);
    }else{
      expect(records.scopes[0]).toMatchObject({outcome:'completed'});expect(summary.status).toBe('completed');expect(ask?.outcome).toBe(mode==='invalid-output'?'failed':'succeeded');
      const event=summary.events.find(event=>event.type==='tool.finished'&&event.data.id==='question-member-ask');
      if(mode==='cancel-question')expect(JSON.stringify(event?.data.result)).toContain('cancelled');
      if(mode==='invalid-output'){expect(realMemberConsumption).toBe(1);expect(JSON.stringify(event?.data)).toContain('TOOL_OUTPUT_INVALID')}
      expect(summary.toolReceipts?.find(receipt=>receipt.toolCallId==='question-bad-step')?.outcome).toBe('failed');expect(summary.taskProgress?.steps[0].evidence).toEqual(['question-real-read']);expect(summary.taskProgress?.delivery?.summary).toBe('实际读取 '+data.fact);
      expect(thread[0].toolReceipts?.find(receipt=>receipt.toolCallId==='question-check')?.outcome).toBe('succeeded');expect(records.scopes[0].goal?.review).toBeUndefined();expect(provider.mainRequests).toHaveLength(6);expect(provider.memberRequests).toHaveLength(7);
    }
    expect(summary.events.filter(event=>event.type==='tool.proposed'&&event.data.id==='question-member-ask')).toHaveLength(1);expect(provider.errors).toEqual([]);
    const before={records,graph:finalGraph,thread,summary},count=[provider.mainRequests.length,provider.memberRequests.length];await app.Shutdown();app=new Application(new Paths(f.user,path.resolve('.')),path.resolve('assets'));await app.Init();
    expect(await seed.records()).toEqual(before.records);expect(await graph()).toEqual(before.graph);expect(await app.Execution(seed.entry.id).Thread(started.taskId)).toEqual(before.thread);expect(await questionRun(f.user,seed.entry.id,binding.taskId,binding.runId)).toEqual(before.summary);expect(await mainQuestions()).toEqual([]);await expect(memberQuestions()).rejects.toThrow(/TASK_NOT_FOUND|当前主会话没有此派发任务/);expect([provider.mainRequests.length,provider.memberRequests.length]).toEqual(count);
    await expect(app.Dispatch('loop.answerQuestion',{id:seed.entry.id,taskId:started.taskId,questionId:member.id,answers:data.memberAnswers})).rejects.toThrow();expect([provider.mainRequests.length,provider.memberRequests.length]).toEqual(count);
  }catch(error){await fs.mkdir('test-results',{recursive:true});await fs.writeFile(`test-results/question-tool-contract-${mode}-pi-failure.json`,JSON.stringify({error:String(error),mainRequests:provider.mainRequests,memberRequests:provider.memberRequests,errors:provider.errors},null,2));throw error}
  finally{askSpy?.mockRestore();await app.Shutdown();await provider.close();await f.cleanup()}
},120000);
