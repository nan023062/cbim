import {expect,it} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {humanDecisionFixture as data} from '../../../tasks/runtime/unittest/support/human-decisions-provider';
import {prepareRecursiveHumanReview as ready,humanReviewLabels as labels} from './support/recursive-human-review-fixture';

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
