import fs from 'node:fs/promises';
import path from 'node:path';
import {expect,it,vi} from 'vitest';
import {fixture} from '../../application/support/helpers';
import {Application} from '../../../../../src/bridge/server/application';
import {Paths} from '../../../../../src/logic/workspace/service/paths';
import {FileRunStorage} from '../../../../../src/logic/execution/storage/run-storage';
import type {PendingQuestion} from '../../../../../src/logic/tools/rules/questions';
import {completeOutputProvider,completeOutputData as d} from './support/complete-output-provider';
import {seedCompleteOutput,completeOutputRecords} from './support/complete-output-pi-fixture';

// 再审沿原调用重新核实完整集合与 canonical；旧接受不能自动成为新意见。
it.each(['same','changed-set','broken-source'] as const)('recursive reconsideration preserves independent decisions and original proof (%s)',async mode=>{
 const f=await fixture(),provider=await completeOutputProvider('human',false,true,true);let app=f.app;
 try{
  const {entry}=await seedCompleteOutput(app,f.a,provider);
  const start=await app.Dispatch('loop.chat',{id:entry.id,message:d.goal,options:{permission:'execute',turnTimeoutMs:60000}});
  const rootDir=path.join(f.user,entry.id,'loop-engine/tasks',start.taskId,start.runId);
  const read=()=>new FileRunStorage().Read(rootDir);
  const records=async()=>(await read()).events.filter(e=>e.data.humanDecision).map(e=>e.data.humanDecision as any);
  const until=async(check:()=>Promise<void>|void)=>{await vi.waitFor(async()=>{if(provider.errors.length)return;await check()},{timeout:30000,interval:30});expect(provider.errors).toEqual([])};
  const questions=()=>app.Dispatch('loop.questions',{id:entry.id,taskId:start.taskId}) as Promise<PendingQuestion[]>;
  const question=async(previous?:string)=>{await until(async()=>{const q=await questions();expect(q).toHaveLength(1);if(previous)expect(q[0].id).not.toBe(previous)});return (await questions())[0]};
  const answer=async(q:PendingQuestion,label:string)=>{const option=q.questions[0].options.findIndex(o=>o.label===label);expect(option).toBeGreaterThanOrEqual(0);await app.Dispatch('loop.answerQuestion',{id:entry.id,taskId:start.taskId,questionId:q.id,answers:[{option,other:'按当前实际证据独立判断'}]})};
  provider.releaseReview();
  const first=await question();await answer(first,'接受此成果');
  const firstContinuation=await question(first.id),[prior]=await records();
  await answer(firstContinuation,'继续处理意见');
  await until(()=>expect(provider.state.secondReviewReady).toBe(true));
  const ref=provider.state.call.agentCall,childFile=path.join(f.user,entry.id,'loop-engine/tasks',ref.taskId,ref.runId,'events.jsonl'),original=await fs.readFile(childFile,'utf8');
  expect(prior.decision).toBe('accept');expect(provider.member).toHaveLength(8);
  const extra=path.join(f.a,d.root,'extra.txt');
  if(mode==='changed-set')await fs.writeFile(extra,'new file outside accepted complete set');
  if(mode==='broken-source')await fs.appendFile(childFile,'{"partial":');
  provider.releaseContinuation();
  const second=await question();
  expect(second.id).not.toBe(first.id);expect(await records()).toEqual([prior]);
  expect(second.questions[0].options.map(o=>o.label)).toEqual(mode==='same'?['接受此成果','不接受此成果','要求补充证据']:['不接受此成果','要求补充证据']);
  const decision=mode==='same'?'accept':'request_evidence';
  await answer(second,decision==='accept'?'接受此成果':'要求补充证据');
  const next=await question(second.id),saved=await records();
  expect(saved).toHaveLength(2);expect(saved[0]).toEqual(prior);
  expect(saved[1]).toMatchObject({decision,callId:'full-call',original:prior.original});
  expect(saved[1].reviewToolCallId).not.toBe(prior.reviewToolCallId);
  expect(saved[1].current.state).toBe(mode==='same'?'verified':'unverified');
  await answer(next,'只保存意见');
  await until(()=>{expect(provider.state.secondHumanReview).toBeDefined();expect(app.runtime.Snapshot().pressure.activeRuns).toBe(0)});
  expect(provider.state.secondHumanReview).toMatchObject({record:saved[1],continued:false,executionAuthorized:false});
  expect(provider.member).toHaveLength(8);expect(provider.main).toHaveLength(5);
  expect(await fs.readFile(childFile,'utf8')).toBe(original+(mode==='broken-source'?'{"partial":':''));
  const sequence=[...provider.sequence],state=await completeOutputRecords(f.user,entry.id),rootBytes=await fs.readFile(path.join(rootDir,'events.jsonl'),'utf8');
  await app.Shutdown();app=new Application(new Paths(f.user,path.resolve('.')));await app.Init();
  expect(await completeOutputRecords(f.user,entry.id)).toEqual(state);expect(await records()).toEqual(saved);expect(await questions()).toEqual([]);
  expect(await fs.readFile(path.join(rootDir,'events.jsonl'),'utf8')).toBe(rootBytes);expect(provider.sequence).toEqual(sequence);
  expect(await fs.readFile(path.join(f.a,d.file),'utf8')).toBe(d.content);
  if(mode==='changed-set')expect(await fs.readFile(extra,'utf8')).toBe('new file outside accepted complete set');
 }finally{provider.releaseAll();await app.Shutdown();await provider.close();await f.cleanup()}
},90000);
