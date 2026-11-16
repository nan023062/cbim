import {expect,it,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fixture} from './helpers';
import {Application} from '../src/bridge/server/application';
import {Paths} from '../src/logic/workspace/service/paths';
import {FileRunStorage} from '../src/logic/execution/storage/run-storage';
import type {PendingQuestion} from '../src/logic/tools/rules/questions';
import {humanDecisionProvider,humanDecisionFixture as data} from './human-decisions-provider';
import {seedHumanDecision,humanDecisionLogBytes} from './human-decisions-fixture';

const labels={accept:'接受此成果',reject:'不接受此成果',request_evidence:'要求补充证据'} as const;

/** 使用实际新工具链、问题队列、文件与 canonical；不创建旧目标/派工等待图。 */
async function ready(reconsider=false){
  const f=await fixture(),provider=await humanDecisionProvider(reconsider);let app=f.app;
  try{
    const {entry}=await seedHumanDecision(app,f.a,provider);
    const start=await app.dispatch('loop.chat',{id:entry.id,message:data.goal,options:{permission:'execute',turnTimeoutMs:60000}});
    const rootDir=path.join(f.user,entry.id,'loop-engine/tasks',start.taskId,start.runId);
    const read=()=>new FileRunStorage().read(rootDir);
    const questions=()=>app.dispatch('loop.questions',{id:entry.id,taskId:start.taskId}) as Promise<PendingQuestion[]>;
    const until=async(check:()=>Promise<void>|void)=>{
      await vi.waitFor(async()=>{if(provider.errors.length)return;await check()},{timeout:20000,interval:30});
      expect(provider.errors).toEqual([]);
    };
    const question=async(previous?:string)=>{
      await until(async()=>{const list=await questions();expect(list).toHaveLength(1);if(previous)expect(list[0].id).not.toBe(previous)});
      return (await questions())[0];
    };
    const answer=async(q:PendingQuestion,label:string)=>{
      const option=q.questions[0].options.findIndex(o=>o.label===label);expect(option).toBeGreaterThanOrEqual(0);
      await app.dispatch('loop.answerQuestion',{id:entry.id,taskId:start.taskId,questionId:q.id,answers:[{option,other:data.comment}]});
    };
    const first=await question();
    expect(provider.main).toHaveLength(2);expect(provider.member).toHaveLength(7);
    expect(provider.state.baselineId).toBeTruthy();expect(await fs.readFile(path.join(f.a,data.file),'utf8')).toBe(data.fact);
    const reference=provider.state.call.agentCall,childDir=path.join(f.user,entry.id,'loop-engine/tasks',reference.taskId,reference.runId);
    const childBefore=await fs.readFile(path.join(childDir,'events.jsonl'),'utf8');
    const stateBefore=await app.workspace(entry.id).dispatchStore.read();
    expect(stateBefore.graphs[0].tasks).toEqual([]);expect(stateBefore.agentBusinessRuns).toHaveLength(1);
    const decisions=async()=>(await read()).events.filter(e=>e.data.humanDecision).map(e=>e.data.humanDecision as any);
    const saved=async(q:PendingQuestion,decision:keyof typeof labels)=>{
      await answer(q,labels[decision]);const continuation=await question(q.id);
      const records=await decisions(),record=records.at(-1);
      expect(record).toMatchObject({callerTaskId:start.taskId,callerRunId:start.runId,callId:'human-call',decision,original:provider.state.call.verification,answer:{answer:labels[decision],supplement:data.comment}});
      expect((await read()).events.some(e=>e.type==='tool.finished'&&e.data.id===record.reviewToolCallId)).toBe(false);
      expect(await fs.readFile(path.join(childDir,'events.jsonl'),'utf8')).toBe(childBefore);
      expect((await app.workspace(entry.id).dispatchStore.read()).agentBusinessRuns).toEqual(stateBefore.agentBusinessRuns);
      expect(provider.member).toHaveLength(7);return {continuation,record};
    };
    const stopAndReopen=async()=>{
      await app.dispatch('loop.stop',{id:entry.id,taskId:start.taskId});
      await until(()=>expect(app.runtime.snapshot().pressure.activeRuns).toBe(0));
      const sequence=[...provider.sequence],logs=await humanDecisionLogBytes(f.user,entry.id),state=await app.workspace(entry.id).dispatchStore.read(),records=await decisions();
      expect(await fs.readFile(path.join(childDir,'events.jsonl'),'utf8')).toBe(childBefore);
      await app.shutdown();app=new Application(new Paths(f.user,path.resolve('.')),path.resolve('assets'));await app.init();await app.open(entry.id);
      expect(await questions()).toEqual([]);expect(await decisions()).toEqual(records);
      expect(await humanDecisionLogBytes(f.user,entry.id)).toEqual(logs);
      expect(await app.workspace(entry.id).dispatchStore.read()).toEqual(state);
      expect(provider.sequence).toEqual(sequence);expect(provider.errors).toEqual([]);
      return records;
    };
    return {f,provider,app,entry,start,first,read,question,answer,decisions,saved,stopAndReopen,cleanup:async()=>{await app.shutdown();await provider.close();await f.cleanup()}};
  }catch(error){await app.shutdown();await provider.close();await f.cleanup();throw error}
}

it.each(['accept','reject','request_evidence'] as const)('persists explicit %s on the original Agent call; continuation and restart cannot replay work',async decision=>{
  const c=await ready(decision==='accept');
  try{
    const first=await c.saved(c.first,decision);expect(c.provider.main).toHaveLength(2);
    if(decision==='accept'){
      // 第二次独立评价保留首次意见；不改写旧事件，不重新调用执行 Agent。
      await c.answer(first.continuation,'继续处理意见');
      const next=await c.question(first.continuation.id);
      expect(c.provider.state.review).toMatchObject({record:first.record,continued:true,executionAuthorized:false});
      const second=await c.saved(next,'reject'),records=await c.decisions();
      expect(records).toHaveLength(2);expect(records[0]).toEqual(first.record);
      expect(records[1].reviewToolCallId).not.toBe(first.record.reviewToolCallId);
      expect(second.record.original).toEqual(first.record.original);
      expect(c.provider.main).toHaveLength(3);
    }
    const records=await c.stopAndReopen();expect(records.map(r=>r.decision)).toEqual(decision==='accept'?['accept','reject']:[decision]);
    expect(await fs.readFile(path.join(c.f.a,data.file),'utf8')).toBe(data.fact);
  }finally{await c.cleanup()}
},60000);

it('rejects stale acceptance, then offers a fresh negative decision without rewriting the source proof',async()=>{
  const c=await ready();
  try{
    expect(c.first.questions[0].options.map(o=>o.label)).toContain(labels.accept);
    await fs.writeFile(path.join(c.f.a,data.file),data.changed);
    await c.answer(c.first,labels.accept);
    const next=await c.question(c.first.id);
    expect(c.provider.state.review.error).toBeTruthy();expect(await c.decisions()).toEqual([]);
    expect(next.questions[0].options.map(o=>o.label)).toEqual([labels.reject,labels.request_evidence]);
    const {record}=await c.saved(next,'reject');
    expect(record.current).toMatchObject({state:'unverified'});
    expect(record.allowedDecisions).not.toContain('accept');
    expect((await c.stopAndReopen()).map(r=>r.decision)).toEqual(['reject']);
    expect(await fs.readFile(path.join(c.f.a,data.file),'utf8')).toBe(data.changed);
  }finally{await c.cleanup()}
},60000);
