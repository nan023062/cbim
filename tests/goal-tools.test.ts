import {test,expect,vi} from 'vitest';
import {GoalTools,type GoalToolsPort} from '../src/backend/scheduler-engine/tools/goal-tools';
import {DispatchTools,type DispatchToolsPort} from '../src/backend/scheduler-engine/tools/dispatch-tools';
import {authorizeRunTool} from '../src/backend/core/policy/tool-policy';

const taskId='f8878ef0-4c3e-42f2-8afc-0020036a49b0';
const runId='e5f28867-d117-451e-826e-b5bb4f7962c0';
const resultId='18b0994e-1b69-452f-bb9a-4f2755bbff4f';
const plan={expectedRevision:1,objective:'完成网页',constraints:[],criteria:[{id:'c1',text:'页面可打开',kind:'evidence'}],assignments:[{agentId:'cbim:executor',moduleIds:['.cbim/workspace/app'],criterionIds:['c1'],reason:'实现页面'}],reason:'按需求拆分'};
const review={expectedRevision:2,decision:'complete',checks:[{criterionId:'c1',outcome:'satisfied',reason:'已验证',evidence:[{kind:'member-result',taskId,runId,resultId,planRevision:1,toolCallIds:['call_1']}]}],superseded:[],gaps:[],reason:'满足目标'};
function fixture(){
  const state={scope:{scopeId:'bound-scope',status:'active',goal:{revision:2}},graph:{identity:{workspaceId:'workspace',rootSessionId:'root'},tasks:[]}};
  const inspect=vi.fn<GoalToolsPort['inspect']>().mockResolvedValue(state);
  const savePlan=vi.fn<GoalToolsPort['plan']>().mockResolvedValue({scopeId:'bound-scope',status:'active',goal:{revision:2,plan}});
  const saveReview=vi.fn<GoalToolsPort['review']>().mockResolvedValue({scopeId:'bound-scope',status:'active',goal:{revision:3,review:{decision:'complete'}}});
  return {tools:new GoalTools({inspect,plan:savePlan,review:saveReview}),inspect,savePlan,saveReview,state};
}
test('goal tools expose only implemented strict schemas and inspection is read-only',async()=>{
  const f=fixture();
  expect(f.tools.list().map(tool=>tool.name)).toEqual(['cbim_goal_inspect','cbim_goal_plan','cbim_goal_review']);
  for(const tool of f.tools.list())expect(tool.inputSchema).toMatchObject({additionalProperties:false});
  expect(f.tools.has('cbim_goal_review')).toBe(true);
  expect(f.tools.has('cbim_goal_finish')).toBe(false);
  expect(f.tools.describe('cbim_goal_inspect',{})).toEqual({effects:['read'],native:false});
  const result=await f.tools.call('cbim_goal_inspect',{},new AbortController().signal,'inspect-call');
  expect(JSON.parse(result.content[0].text)).toEqual(f.state);
  expect(f.inspect).toHaveBeenCalledWith();
  expect(f.savePlan).not.toHaveBeenCalled();expect(f.saveReview).not.toHaveBeenCalled();
});
test('planning forwards domain input with separate trusted invocation metadata',async()=>{
  const f=fixture(),signal=new AbortController().signal;
  expect(f.tools.describe('cbim_goal_plan',plan)).toEqual({effects:['maintenance'],native:false});
  expect(f.savePlan).not.toHaveBeenCalled();
  const result=await f.tools.call('cbim_goal_plan',plan,signal,'plan-call');
  expect(f.savePlan).toHaveBeenCalledWith(plan,{toolCallId:'plan-call',signal});
  expect(JSON.parse(result.content[0].text)).toMatchObject({status:'active',goal:{revision:2}});
});
test('complete review keeps the service pending result without closing scope or granting human acceptance',async()=>{
  const f=fixture(),signal=new AbortController().signal;
  expect(f.tools.describe('cbim_goal_review',review)).toEqual({effects:['maintenance'],native:false});
  expect(f.saveReview).not.toHaveBeenCalled();
  const result=await f.tools.call('cbim_goal_review',review,signal,'review-call');
  expect(f.saveReview).toHaveBeenCalledWith(review,{toolCallId:'review-call',signal});
  expect(JSON.parse(result.content[0].text)).toEqual({scopeId:'bound-scope',status:'active',goal:{revision:3,review:{decision:'complete'}}});
  expect(f.tools.list().find(tool=>tool.name==='cbim_goal_review')!.description).toContain('不立即结束任务');
});
test('goal inputs reject forged identity, authority and nested acceptance fields without entering services',async()=>{
  const f=fixture(),signal=new AbortController().signal;
  for(const [name,input] of [['cbim_goal_inspect',{}],['cbim_goal_plan',plan],['cbim_goal_review',review]] as const){
    for(const field of ['workspaceId','rootSessionId','scopeId','runId','commandId','toolCallId','permission','approved']){
      const forged={...input,[field]:'forged'};
      expect(()=>f.tools.describe(name,forged)).toThrow('目标工具参数无效');
      await expect(f.tools.call(name,forged,signal,'trusted-call')).rejects.toThrow('目标工具参数无效');
    }
  }
  expect(()=>f.tools.describe('cbim_goal_plan',{...plan,criteria:[{...plan.criteria[0],approved:true}]})).toThrow('目标工具参数无效');
  expect(()=>f.tools.describe('cbim_goal_review',{...review,checks:[{...review.checks[0],humanApproved:true}]})).toThrow('目标工具参数无效');
  expect(()=>f.tools.describe('cbim_goal_review',{...review,checks:[{...review.checks[0],evidence:[{kind:'main-knowledge',runId:'other-run',toolCallIds:['call']}]}]})).toThrow('目标工具参数无效');
  expect(f.inspect).not.toHaveBeenCalled();expect(f.savePlan).not.toHaveBeenCalled();expect(f.saveReview).not.toHaveBeenCalled();
});
test('missing bridge IDs, unknown tools and pre-cancelled calls do not execute',async()=>{
  const f=fixture(),controller=new AbortController();
  for(const id of [undefined,'',' '.repeat(2),'x'.repeat(513)])await expect(f.tools.call('cbim_goal_plan',plan,controller.signal,id)).rejects.toThrow('可信调用标识');
  await expect(f.tools.call('cbim_goal_finish',{},controller.signal,'trusted')).rejects.toThrow('没有此目标规划工具');
  controller.abort(new Error('用户已停止'));
  await expect(f.tools.call('cbim_goal_review',review,controller.signal,'trusted')).rejects.toThrow('用户已停止');
  expect(f.savePlan).not.toHaveBeenCalled();expect(f.saveReview).not.toHaveBeenCalled();
});
test('domain errors and invalid service results remain failures and are not retried',async()=>{
  const f=fixture(),signal=new AbortController().signal;
  f.saveReview.mockRejectedValueOnce(new Error('证据已过期'));
  await expect(f.tools.call('cbim_goal_review',review,signal,'review-call')).rejects.toThrow('证据已过期');
  expect(f.saveReview).toHaveBeenCalledTimes(1);
  f.savePlan.mockResolvedValueOnce(undefined);
  await expect(f.tools.call('cbim_goal_plan',plan,signal,'plan-call')).rejects.toThrow('返回无效工具结果');
  expect(f.savePlan).toHaveBeenCalledTimes(1);
});
test('read-only policy may maintain goals but neither grants writes nor invokes approval',async()=>{
  const f=fixture(),approve=vi.fn(),guard=vi.fn();
  const decision=await authorizeRunTool({id:'review-call',name:'cbim_goal_review',input:review},f.tools.describe('cbim_goal_review',review),{workspaceId:'workspace',permission:'read',guard,approve});
  expect(decision).toMatchObject({allow:true,effects:['maintenance']});
  expect(approve).not.toHaveBeenCalled();expect(guard).not.toHaveBeenCalled();expect(f.saveReview).not.toHaveBeenCalled();
});
test('dispatch composition registers and routes goals only when a real adapter is supplied',async()=>{
  const f=fixture(),signal=new AbortController().signal;
  const dispatch=vi.fn<DispatchToolsPort['dispatch']>();
  const inspect=vi.fn<DispatchToolsPort['inspect']>().mockResolvedValue({taskId,status:'result_ready'});
  const legacy=new DispatchTools({dispatch,inspect}),combined=new DispatchTools({dispatch,inspect},f.tools);
  expect(legacy.has('cbim_goal_inspect')).toBe(false);
  await expect(legacy.call('cbim_goal_inspect',{},signal,'legacy')).rejects.toThrow('没有此成员派发工具');
  expect(combined.list().map(tool=>tool.name)).toEqual(['cbim_dispatch_task','cbim_dispatch_inspect','cbim_goal_inspect','cbim_goal_plan','cbim_goal_review']);
  expect(combined.has('cbim_goal_plan')).toBe(true);expect(combined.has('cbim_goal_finish')).toBe(false);
  expect(combined.describe('cbim_goal_plan',plan)).toEqual({effects:['maintenance'],native:false});
  const result=await combined.call('cbim_goal_plan',plan,signal,'composed-plan');
  expect(JSON.parse(result.content[0].text)).toMatchObject({status:'active'});
  expect(f.savePlan).toHaveBeenCalledWith(plan,{toolCallId:'composed-plan',signal});
  await combined.call('cbim_dispatch_inspect',{taskId},signal,'old-inspect');
  expect(inspect).toHaveBeenCalledWith(taskId);expect(dispatch).not.toHaveBeenCalled();
});
