import {it,expect,vi} from 'vitest';
import {Agent} from '../src/logic/agents/agent';
import {AgentExecutionLoop} from '../src/logic/agents/loop';
import type {RunSummary} from '../src/logic/execution/rules/types';

it('runs once, returns actual terminal facts, and closes the injected loop',async()=>{
  const agent=new Agent({id:'agent',name:'Agent',instructions:'role',permission:'read'},{workspaceId:'workspace',taskId:'task'}),summary={status:'failed'} as RunSummary;
  const close=vi.fn(async()=>{}),start=vi.fn(async(_message,_signal,before)=>{await before('run');return {runId:'run',done:Promise.resolve(summary)}}),loop=new AgentExecutionLoop(agent,{start,close,stop:async()=>{}}),before=vi.fn(async()=>{});
  expect(await loop.run('work',new AbortController().signal,before)).toBe(summary);expect(before).toHaveBeenCalledWith('run');expect(close).toHaveBeenCalledTimes(1);
  await expect(loop.run('again',new AbortController().signal,before)).rejects.toThrow('不能重复执行');expect(start).toHaveBeenCalledTimes(1);
});
