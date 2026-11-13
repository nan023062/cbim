import {expect,it,vi} from 'vitest';
import type {TaskNode} from '../src/bridge/contracts/dispatch';
import {CandidateReviewTools} from '../src/backend/scheduler-engine/tools/candidate-review-tools';
import {binding,request,approved} from './support/candidate-review';
it('审阅工具要求可信调用，输出绑定当前主运行；坏回包不重放',async()=>{
  const save=vi.fn(async()=>approved()),tools=new CandidateReviewTools(binding,save),signal=new AbortController().signal;
  expect(tools.has('cbim_dispatch_review')).toBe(true);expect(tools.list()[0].outputSchema).toBeDefined();
  await expect(tools.call('cbim_dispatch_review',request,signal)).rejects.toMatchObject({code:'DISPATCH_CALL_ID_REQUIRED'});expect(save).not.toHaveBeenCalled();
  await tools.call('cbim_dispatch_review',request,signal,'call');expect(save).toHaveBeenCalledTimes(1);
  for(const mutate of [(t:TaskNode)=>{t.identity.workspaceId='other'},(t:TaskNode)=>{t.candidateReview!.mainRunId='old'},(t:TaskNode)=>{t.candidateReview!.decision='reject'},(t:TaskNode)=>{t.result!.resultId='old'}]){
    const bad=approved();mutate(bad);save.mockResolvedValueOnce(bad);
    await expect(tools.call('cbim_dispatch_review',request,signal,'bad')).rejects.toMatchObject({code:'TOOL_OUTPUT_INVALID'});
  }
  expect(save).toHaveBeenCalledTimes(5);
});
