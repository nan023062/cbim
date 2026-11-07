import {expect,it,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fixture} from './helpers';
import {Application} from '../src/backend/main/application';
import {Paths} from '../src/backend/main/platform/paths';
import {QuestionQueue} from '../src/backend/scheduler-engine/conversation/questions';
import type {PendingQuestion} from '../src/backend/core/tools/questions';
import type {GraphSnapshot} from '../src/backend/core/tasks/graph-types';
import {questionContractData as data,questionContractProvider,type QuestionContractMode} from './question-tool-contract-provider';
import {questionWait,questionRun,seedQuestionContract} from './question-tool-contract-fixture';

it.each(['complete','cancel-question','invalid-output','stop'] as QuestionContractMode[])('strict real question answers are communication, not business completion evidence (%s)',async mode=>{
  const f=await fixture(),provider=await questionContractProvider(mode);let app=f.app,askSpy:{mockRestore:()=>void}|undefined;
  let realMemberConsumption=0;
  try{
    if(mode==='invalid-output'){
      const original=QuestionQueue.prototype.ask;
      askSpy=vi.spyOn(QuestionQueue.prototype,'ask').mockImplementation(async function(this:QuestionQueue,taskId,args,signal){const result=await original.call(this,taskId,args,signal);if((args as {questions:{question:string}[]}).questions[0].question===data.memberQuestions[0].question){realMemberConsumption++;return {answers:[{question:'消费之后的错误题目，必须被输出契约拒绝',answer:'真实读取'}]}}return result});
    }
    const seed=await seedQuestionContract(app,f.a,provider),started=await app.dispatch('loop.chat',{id:seed.entry.id,message:data.goal,options:seed.options}),identity={workspaceId:seed.entry.id,rootSessionId:started.taskId};
    const mainQuestions=()=>app.dispatch('loop.questions',{id:seed.entry.id,taskId:started.taskId}) as Promise<PendingQuestion[]>,graph=()=>app.dispatch('dispatch.graphSnapshot',{identity}) as Promise<GraphSnapshot>;
    await questionWait(async()=>(await mainQuestions()).length===1,'主问题卡');const main=(await mainQuestions())[0];expect(main.questions).toEqual(data.mainQuestions);expect(provider.mainRequests).toHaveLength(1);expect(provider.memberRequests).toHaveLength(0);
    await expect(app.dispatch('loop.answerQuestion',{id:seed.entry.id,taskId:'wrong-task',questionId:main.id,answers:data.mainAnswers})).rejects.toThrow();
    await expect(app.dispatch('loop.answerQuestion',{id:seed.entry.id,taskId:started.taskId,questionId:main.id,answers:data.mainAnswers.slice(0,1)})).rejects.toThrow();expect(await mainQuestions()).toEqual([main]);expect(provider.mainRequests).toHaveLength(1);
    await app.dispatch('loop.answerQuestion',{id:seed.entry.id,taskId:started.taskId,questionId:main.id,answers:data.mainAnswers});await expect(app.dispatch('loop.answerQuestion',{id:seed.entry.id,taskId:started.taskId,questionId:main.id,answers:data.mainAnswers})).rejects.toThrow();
    await questionWait(async()=>(await graph()).tasks.length===1&&provider.memberRequests.length===1,'成员等待');const task=(await graph()).tasks[0],memberIdentity={...identity,taskId:task.taskId},memberQuestions=()=>app.dispatch('dispatch.questions',memberIdentity) as Promise<PendingQuestion[]>;
    await questionWait(async()=>(await memberQuestions()).length===1,'成员问题卡');const member=(await memberQuestions())[0];expect(member.questions).toEqual(data.memberQuestions);expect(await mainQuestions()).toEqual([]);expect(provider.mainRequests).toHaveLength(4);
    if(mode==='stop')await app.dispatch('loop.stop',{id:seed.entry.id,taskId:started.taskId});
    else if(mode==='cancel-question'){
      // 测试直接取消域等待以观察合法 cancelled wire；不是 UI 用户回答，也不是整任务 stop。
      const queue=(app.memberExecution(seed.entry.id) as unknown as {questions:QuestionQueue}).questions;queue.cancel(task.taskId);
    }else await app.dispatch('dispatch.answerQuestion',{...memberIdentity,questionId:member.id,answers:data.memberAnswers});
    await questionWait(async()=>(await seed.records()).scopes[0].status==='closed'&&app.runtime.snapshot().pressure.activeRuns===0,'真实结算');
    const records=await seed.records(),finalGraph=await graph(),thread=await app.execution(seed.entry.id).thread(started.taskId),run=records.runs[0],summary=await questionRun(f.user,seed.entry.id,task.taskId,run.binding.runId);
    expect(await mainQuestions()).toEqual([]);expect(await memberQuestions()).toEqual([]);expect(thread[0].toolReceipts?.find(receipt=>receipt.toolCallId==='question-main-ask')?.outcome).toBe('succeeded');
    const ask=summary.toolReceipts?.find(receipt=>receipt.toolCallId==='question-member-ask');
    if(mode==='stop'){
      expect(records.scopes[0]).toMatchObject({outcome:'cancelled'});expect(summary.status).toBe('cancelled');expect(finalGraph.tasks[0].result).toBeUndefined();expect(provider.mainRequests).toHaveLength(4);expect(provider.memberRequests).toHaveLength(1);
    }else{
      expect(records.scopes[0]).toMatchObject({outcome:'completed'});expect(summary.status).toBe('completed');expect(ask?.outcome).toBe(mode==='invalid-output'?'failed':'succeeded');
      const event=summary.events.find(event=>event.type==='tool.finished'&&event.data.id==='question-member-ask');
      if(mode==='cancel-question')expect(JSON.stringify(event?.data.result)).toContain('cancelled');
      if(mode==='invalid-output'){expect(realMemberConsumption).toBe(1);expect(JSON.stringify(event?.data)).toContain('TOOL_OUTPUT_INVALID')}
      expect(summary.toolReceipts?.find(receipt=>receipt.toolCallId==='question-bad-step')?.outcome).toBe('failed');expect(summary.taskProgress?.steps[0].evidence).toEqual(['question-real-read']);expect(finalGraph.tasks[0].result?.evidenceRefs).toEqual(['question-real-read']);
      expect(thread[1].toolReceipts?.find(receipt=>receipt.toolCallId==='question-bad-review')?.outcome).toBe('failed');expect(thread[1].toolReceipts?.find(receipt=>receipt.toolCallId==='question-final-review')?.outcome).toBe('succeeded');expect(provider.mainRequests).toHaveLength(8);expect(provider.memberRequests).toHaveLength(7);
    }
    expect(summary.events.filter(event=>event.type==='tool.proposed'&&event.data.id==='question-member-ask')).toHaveLength(1);expect(provider.errors).toEqual([]);
    const before={records,graph:finalGraph,thread,summary},count=[provider.mainRequests.length,provider.memberRequests.length];await app.shutdown();app=new Application(new Paths(f.user,path.resolve('.')),path.resolve('design'));await app.init();
    expect(await seed.records()).toEqual(before.records);expect(await graph()).toEqual(before.graph);expect(await app.execution(seed.entry.id).thread(started.taskId)).toEqual(before.thread);expect(await questionRun(f.user,seed.entry.id,task.taskId,run.binding.runId)).toEqual(before.summary);expect(await mainQuestions()).toEqual([]);expect(await memberQuestions()).toEqual([]);expect([provider.mainRequests.length,provider.memberRequests.length]).toEqual(count);
    await expect(app.dispatch('dispatch.answerQuestion',{...memberIdentity,questionId:member.id,answers:data.memberAnswers})).rejects.toThrow();expect([provider.mainRequests.length,provider.memberRequests.length]).toEqual(count);
  }catch(error){await fs.mkdir('test-results',{recursive:true});await fs.writeFile(`test-results/question-tool-contract-${mode}-pi-failure.json`,JSON.stringify({error:String(error),mainRequests:provider.mainRequests,memberRequests:provider.memberRequests,errors:provider.errors},null,2));throw error}
  finally{askSpy?.mockRestore();await app.shutdown();await provider.close();await f.cleanup()}
},120000);
