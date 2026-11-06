import {expect,test,vi} from 'vitest';
import {DispatchTools,type DispatchToolsPort} from '../src/backend/scheduler-engine/tools/dispatch-tools';
import {authorizeRunTool} from '../src/backend/core/policy/tool-policy';

const input={expectedGraphCursor:{streamId:'stream-one',seq:5},targets:[{taskId:'task-one',expectedRevision:2},{taskId:'task-two',expectedRevision:1}],reason:'等待用户补充，撤销尚未启动的依赖工作'};
function fixture(){
  const receipt={workspaceId:'workspace-one',rootSessionId:'root-one',scopeId:'scope-one',mainRunId:'main-one',commandId:'command-one',cancelledTaskIds:['task-one','task-two'],graphCursor:{streamId:'stream-one',seq:6}};
  const cancel=vi.fn<NonNullable<DispatchToolsPort['cancel']>>().mockResolvedValue(receipt),dispatch=vi.fn(),inspect=vi.fn();
  return {cancel,receipt,tools:new DispatchTools({dispatch,inspect,cancel})};
}
test('unconfigured compatibility ports neither advertise nor allow cancellation',async()=>{
  const tools=new DispatchTools({dispatch:vi.fn(),inspect:vi.fn()});
  expect(tools.list().some(tool=>tool.name==='cbim_dispatch_cancel')).toBe(false);expect(tools.has('cbim_dispatch_cancel')).toBe(false);
  expect(()=>tools.describe('cbim_dispatch_cancel',input)).toThrow('没有此');
  await expect(tools.call('cbim_dispatch_cancel',input,new AbortController().signal,'call-one')).rejects.toThrow('没有此');
});
test('exposes the real cancellation port with strict schema and trusted invocation ID',async()=>{
  const f=fixture(),signal=new AbortController().signal;
  expect(f.tools.has('cbim_dispatch_cancel')).toBe(true);
  expect(f.tools.list().find(tool=>tool.name==='cbim_dispatch_cancel')?.inputSchema).toMatchObject({additionalProperties:false});
  const result=await f.tools.call('cbim_dispatch_cancel',input,signal,'native-call-one');
  expect(f.cancel).toHaveBeenCalledExactlyOnceWith(input,{toolCallId:'native-call-one',signal});
  expect(JSON.parse(result.content[0].text)).toEqual(f.receipt);
});
test('does not accept scope, caller, permissions, history flags or implicit dependency expansion from model arguments',async()=>{
  const f=fixture(),signal=new AbortController().signal;
  for(const field of ['workspaceId','rootSessionId','scopeId','mainRunId','commandId','permission','cancelRunning','cascade','approved']){
    const args={...input,[field]:'forged'};
    expect(()=>f.tools.describe('cbim_dispatch_cancel',args)).toThrow('参数无效');
    await expect(f.tools.call('cbim_dispatch_cancel',args,signal,'native-call')).rejects.toThrow('参数无效');
  }
  for(const args of [
    {...input,targets:[]}, {...input,targets:[input.targets[0],input.targets[0]]}, {...input,reason:'  '},
    {...input,expectedGraphCursor:{...input.expectedGraphCursor,workspaceId:'other'}},
    {...input,targets:[{taskId:'task-one',expectedRevision:0}]},
    {...input,targets:[{taskId:'task-one',expectedRevision:1,status:'cancelled'}]},
  ])expect(()=>f.tools.describe('cbim_dispatch_cancel',args)).toThrow('参数无效');
  expect(f.cancel).not.toHaveBeenCalled();
});
test('requires a real call ID and refuses pre-aborted requests without entering the service',async()=>{
  const f=fixture(),abort=new AbortController();
  await expect(f.tools.call('cbim_dispatch_cancel',input,abort.signal)).rejects.toThrow('可信调用标识');
  abort.abort(Error('stop before cancel'));await expect(f.tools.call('cbim_dispatch_cancel',input,abort.signal,'native-call')).rejects.toThrow('stop before cancel');
  expect(f.cancel).not.toHaveBeenCalled();
});
test('cancellation is task maintenance, not business authorization or successful delivery evidence',async()=>{
  const f=fixture(),approve=vi.fn(),guard=vi.fn();
  const call={id:'call-one',name:'cbim_dispatch_cancel',input};
  expect(await authorizeRunTool(call,f.tools.describe(call.name,input),{workspaceId:'workspace-one',permission:'read',approve,guard})).toMatchObject({allow:true,effects:['maintenance']});
  expect(approve).not.toHaveBeenCalled();expect(guard).not.toHaveBeenCalled();expect(f.cancel).not.toHaveBeenCalled();
});
test('preserves typed service rejection instead of turning an omitted dependency into an accepted cancellation',async()=>{
  const f=fixture(),error=Object.assign(Error('需一并处理下游 task-three'),{code:'CANCEL_DEPENDENTS_REQUIRED'});f.cancel.mockRejectedValue(error);
  await expect(f.tools.call('cbim_dispatch_cancel',input,new AbortController().signal,'native-call')).rejects.toBe(error);
  expect(f.cancel).toHaveBeenCalledTimes(1);
});
