import {expect,it} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {prepareRecursiveHumanReview as ready,humanReviewLabels} from './support/recursive-human-review-fixture';
import {humanDecisionFixture as data} from '../../tasks/runtime/support/human-decisions-provider';

/** 继续是原工具内的明确选择；不恢复旧目标服务，不把意见当成执行授权。 */
it.each(['accept','reject','request_evidence'] as const)('continues only after an explicit choice and restricts followup work (%s)',async decision=>{
 const c=await ready(false,decision==='accept'?'read':'call');
 try{
  const {continuation,record}=await c.saved(c.first,decision);
  expect(c.provider.main).toHaveLength(2);expect(c.provider.state.review).toBeUndefined();
  await c.answer(continuation,'继续处理意见');
  await c.until(()=>expect(c.provider.state.followup).toBeDefined());
  expect(c.provider.state.review).toMatchObject({record,continued:true,executionAuthorized:false});
  if(decision==='accept')expect(JSON.stringify(c.provider.state.followup)).toContain(data.fact);
  else expect(c.provider.state.followup).toMatchObject({error:{code:'AGENT_HUMAN_DECISION_REQUIRED',started:false}});
  expect(c.provider.member).toHaveLength(7);expect(await fs.readFile(path.join(c.f.a,data.file),'utf8')).toBe(data.fact);
  await c.until(()=>expect(c.app.runtime.Snapshot().pressure.activeRuns).toBe(0));
  expect(await c.stopAndReopen()).toEqual([record]);
 }finally{await c.cleanup()}
},60000);

it.each(['accept','reject'] as const)('saving an opinion alone cannot authorize a direct native write (%s)',async decision=>{
 const c=await ready(false,'write');
 try{
  const {continuation,record}=await c.saved(c.first,decision);await c.answer(continuation,'只保存意见');
  await c.until(()=>expect(c.provider.state.followup).toBeDefined());
  expect(c.provider.state.review).toMatchObject({record,continued:false,executionAuthorized:false});
  expect(JSON.stringify(c.provider.state.followup)).toContain('AGENT_HUMAN_DECISION_REQUIRED');
  expect((await c.read()).toolReceipts?.find(r=>r.toolCallId==='human-followup')).toMatchObject({outcome:'denied'});
  expect(await fs.readFile(path.join(c.f.a,data.file),'utf8')).toBe(data.fact);
  await c.until(()=>expect(c.app.runtime.Snapshot().pressure.activeRuns).toBe(0));
  expect(await c.stopAndReopen()).toEqual([record]);
 }finally{await c.cleanup()}
},60000);

it('a changed file after saved acceptance blocks release and native repair while preserving that opinion',async()=>{
 const c=await ready(false,'write');
 try{
  const {continuation,record}=await c.saved(c.first,'accept');await fs.writeFile(path.join(c.f.a,data.file),data.changed);
  await c.answer(continuation,'继续处理意见');
  await c.until(()=>expect(c.provider.state.followup).toBeDefined());
  expect(c.provider.state.review.error.code).toBe('ARTIFACT_BASELINE_STALE');
  expect(JSON.stringify(c.provider.state.followup)).toContain('AGENT_HUMAN_DECISION_REQUIRED');
  expect((await c.read()).events.find(e=>e.data.phase==='decision_released')?.data).toMatchObject({continued:false,reason:'verification_failed'});
  await c.until(()=>expect(c.app.runtime.Snapshot().pressure.activeRuns).toBe(0));
  expect(await c.stopAndReopen()).toEqual([record]);expect(c.provider.member).toHaveLength(7);
 }finally{await c.cleanup()}
},60000);

it('stopping while the saved opinion awaits continuation never releases another model request',async()=>{
 const c=await ready(false,'write');
 try{
  const {record}=await c.saved(c.first,'request_evidence');
  expect(await c.stopAndReopen()).toEqual([record]);
  expect(c.provider.main).toHaveLength(2);expect(c.provider.state.followup).toBeUndefined();
 }finally{await c.cleanup()}
},60000);

it('a frozen request budget can deny continuation without losing the saved decision or replaying the child',async()=>{
 const c=await ready(false,'read',71551);
 try{
  const {continuation,record}=await c.saved(c.first,'accept');await c.answer(continuation,'继续处理意见');
  await c.until(()=>expect(c.app.runtime.Snapshot().pressure.activeRuns).toBe(0));
  const scope=(await c.app.Workspace(c.entry.id).dispatchStore.Read()).scopes![0];
  const budget=await c.app.Dispatch('dispatch.requestBudget',{workspaceId:c.entry.id,rootSessionId:c.start.taskId,scopeId:scope.scopeId});
  expect(budget).toMatchObject({reported:9,denied:1,tokens:1920,lastDenial:'token_reserve'});
  expect(scope.outcome).toBe('failed');expect(c.provider.main).toHaveLength(2);expect(c.provider.member).toHaveLength(7);
  expect(await c.stopAndReopen()).toEqual([record]);
 }finally{await c.cleanup()}
},60000);
