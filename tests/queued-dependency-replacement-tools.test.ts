import {expect,test,vi} from 'vitest';
import {DispatchTools,type DispatchToolsPort} from '../src/backend/scheduler-engine/tools/dispatch-tools';
import {authorizeRunTool} from '../src/backend/core/policy/tool-policy';
import {mainToolBinding} from './main-tool-output-fixture';

const input={expectedGraphCursor:{streamId:'stream',seq:5},expectedGoalRevision:3,target:{taskId:'B',expectedRevision:1,expectedPlanRevision:1},replace:{edgeId:'A-B',expectedRevision:1},with:{taskId:'A2',expectedRevision:4,expectedPlanRevision:1,runId:'A2-run',resultId:'A2-result'},reason:'使用补做任务的真实结果'};
const name='cbim_dispatch_replace_dependency';
function fixture(){const replaceDependency=vi.fn<NonNullable<DispatchToolsPort['replaceDependency']>>();return {replaceDependency,tools:new DispatchTools({binding:mainToolBinding,dispatch:vi.fn(),inspect:vi.fn(),replaceDependency})}}

test('仅装配可信主调度端口时暴露依赖替换，模型不得注入scope、run、权限或递归选项',async()=>{
  const absent=new DispatchTools({binding:mainToolBinding,dispatch:vi.fn(),inspect:vi.fn()});expect(absent.has(name)).toBe(false);expect(absent.list().some(tool=>tool.name===name)).toBe(false);
  const f=fixture();expect(f.tools.list().find(tool=>tool.name===name)?.inputSchema).toMatchObject({additionalProperties:false});
  for(const field of ['workspaceId','rootSessionId','scopeId','mainRunId','commandId','permission','cascade','resume'])await expect(f.tools.call(name,{...input,[field]:'forged'},new AbortController().signal,'call')).rejects.toThrow('参数无效');
  for(const malformed of [{...input,reason:' '},{...input,target:{...input.target,expectedRevision:0}},{...input,with:{...input.with,approved:true}}])expect(()=>f.tools.describe(name,malformed)).toThrow('参数无效');
  expect(f.replaceDependency).not.toHaveBeenCalled();
});

test('依赖替换是maintenance，真实call ID与signal进入端口，缺ID或取消不产生调用',async()=>{
  const f=fixture(),signal=new AbortController(),call={id:'native-call',name,input},approve=vi.fn(),guard=vi.fn();
  const decision=await authorizeRunTool(call,f.tools.describe(name,input),{workspaceId:'workspace',permission:'read',approve,guard});
  expect(decision).toMatchObject({allow:true,effects:['maintenance']});expect(approve).not.toHaveBeenCalled();expect(guard).not.toHaveBeenCalled();
  await expect(f.tools.call(name,input,signal.signal)).rejects.toThrow('可信调用标识');
  const rejected=Object.assign(Error('候选过期'),{code:'DEPENDENCY_KNOWLEDGE_STALE'});f.replaceDependency.mockRejectedValue(rejected);
  await expect(f.tools.call(name,input,signal.signal,call.id)).rejects.toBe(rejected);expect(f.replaceDependency).toHaveBeenCalledExactlyOnceWith(input,{toolCallId:call.id,signal:signal.signal});
  signal.abort(Error('停止后不能修改'));await expect(f.tools.call(name,input,signal.signal,'later')).rejects.toThrow('停止后不能修改');expect(f.replaceDependency).toHaveBeenCalledTimes(1);
});
