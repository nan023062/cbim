import {expect,it} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {QuestionQueue} from '../../../../../src/logic/conversation/runtime/questions';
import {prepareRecursivePause} from './support/recursive-pause-fixture';
import {memberCheckpointFixture as data} from '../../team/runtime/support/member-checkpoint-provider';

// 两次暂停是同一普通工具的连续状态，不产生新执行层级或复制业务运行。
it.each(['complete','stop','abandon','changed-original'] as const)('two recursive pauses preserve the entire original proof and reject stale answers (%s)',async mode=>{
 const c=await prepareRecursivePause(true);
 try{
  const before=await c.child(),file=path.join(c.f.a,data.files[0]),stat=await fs.stat(file);
  await c.answer(c.first);
  const second=await c.question(c.first.id);
  expect(c.provider.state.waitingAgain.agentCall).toEqual(c.provider.state.waiting.agentCall);
  expect(c.provider.state.waitingAgain.questionId).not.toBe(c.provider.state.waiting.questionId);
  expect((await c.child()).runId).toBe(before.runId);expect((await c.child()).sessionFile).toBe(before.sessionFile);
  expect(c.provider.byChild.map(a=>a.length)).toEqual([7,0,0]);
  const waitingState=await c.state(),sequence=[...c.provider.sequence];
  await expect(c.answer(c.first)).rejects.toThrow();
  expect(await c.state()).toEqual(waitingState);expect(c.provider.sequence).toEqual(sequence);
  expect(await c.questions()).toEqual([second]);
  if(mode==='stop')await c.stop();
  else if(mode==='abandon')(c.app.Execution(c.entry.id) as unknown as {questions:QuestionQueue}).questions.Cancel(c.start.taskId);
  else{
   if(mode==='changed-original')await fs.writeFile(file,'changed file captured before first pause');
   await c.answer(second);
  }
  await c.until(async()=>{expect(c.app.runtime.Snapshot().pressure.activeRuns).toBe(0);expect((await c.state()).scopes![0].status).toBe('closed')});
  const final=await c.state(),child=await c.child();
  expect(child.events.filter(e=>e.type==='tool.proposed'&&e.data.name==='write')).toHaveLength(1);
  expect(child.events.filter(e=>e.type==='tool.proposed'&&['pause-ask','pause-ask-again'].includes(String(e.data.id)))).toHaveLength(2);
  if(mode==='complete'){
   expect(c.provider.byChild.map(a=>a.length)).toEqual([11,6,6]);expect(final.agentBusinessRuns).toHaveLength(3);
   expect(c.provider.state.results.map(r=>r.status)).toEqual(['completed','completed','completed']);
   expect((await fs.stat(file)).mtimeMs).toBe(stat.mtimeMs);
  }else{
   expect(final.agentBusinessRuns).toHaveLength(1);expect(c.provider.byChild.slice(1)).toEqual([[],[]]);
   if(mode==='changed-original')expect(c.provider.state.result.error.code).toBe('ARTIFACT_BASELINE_STALE');
   else if(mode==='abandon'){expect(c.provider.state.result.error).toBeTruthy();expect(child.taskProgress?.delivery).toBeUndefined()}
   else expect(child.status).toBe('cancelled');
  }
  const bytes=await fs.readFile(path.join(c.directory,'events.jsonl'),'utf8'),native=await fs.readFile(child.sessionFile!),requests=[...c.provider.sequence];
  await c.reopen();expect(await c.state()).toEqual(final);expect(await c.questions()).toEqual([]);
  expect(await fs.readFile(path.join(c.directory,'events.jsonl'),'utf8')).toBe(bytes);expect(await fs.readFile(child.sessionFile!)).toEqual(native);
  await expect(c.answer(second)).rejects.toThrow();expect(c.provider.sequence).toEqual(requests);
  expect(await fs.readFile(file,'utf8')).toBe(mode==='changed-original'?'changed file captured before first pause':data.facts[0]);
 }finally{await c.cleanup()}
},90000);
