import {test,expect,vi} from 'vitest';
import {DispatchTools,type DispatchToolsPort} from '../src/backend/scheduler-engine/tools/dispatch-tools';
import {authorizeRunTool} from '../src/backend/core/policy/tool-policy';
import {mainToolBinding,mainToolTask,mainToolOwnerSelection} from './main-tool-output-fixture';
import {mainToolCommandId} from '../src/backend/scheduler-engine/tools/main-tool-contracts';

const task={agentId:'.cbim/team/developer',moduleIds:['.cbim/workspace/client'],ownerSelection:mainToolOwnerSelection(['.cbim/workspace/client']),goal:'核实资源加载',acceptance:[{id:'verified',text:'提供真实读取证据'}]};
function fixture(){
  const dispatch=vi.fn<DispatchToolsPort['dispatch']>().mockImplementation(async(_input,call)=>({commandId:mainToolCommandId('cbim_dispatch_task',mainToolBinding,call.toolCallId)!,taskId:'task',messageId:'message',cursor:{workspaceId:'workspace',rootSessionId:'root',streamId:'stream',seq:1},disposition:'queued'}));
  const inspect=vi.fn<DispatchToolsPort['inspect']>().mockResolvedValue(mainToolTask());
  return {tools:new DispatchTools({binding:mainToolBinding,dispatch,inspect}),dispatch,inspect};
}
test('dispatch exposes only implemented main-session tools and uses trusted invocation metadata',async()=>{
  const f=fixture(),signal=new AbortController().signal;
  expect(f.tools.list().map(tool=>tool.name)).toEqual(['cbim_dispatch_task','cbim_dispatch_inspect']);
  expect(f.tools.has('cbim_dispatch_self')).toBe(false);
  expect(f.tools.has('cbim_dispatch_wait')).toBe(false);
  const result=await f.tools.call('cbim_dispatch_task',task,signal,'native-tool-call');
  expect(f.dispatch).toHaveBeenCalledWith({assigneeAgentId:task.agentId,moduleIds:task.moduleIds,ownerSelection:task.ownerSelection,goal:task.goal,acceptance:task.acceptance,prerequisites:[]},{toolCallId:'native-tool-call',signal});
  expect(JSON.parse(result.content[0].text)).toMatchObject({taskId:'task',disposition:'queued'});
  expect(f.tools.list()[0].inputSchema).toMatchObject({additionalProperties:false});
});
test('missing role or owner is rejected; builtin executor needs an explicit owner and main never executes',async()=>{
  const f=fixture(),signal=new AbortController().signal,{agentId,...fallback}=task;
  await expect(f.tools.call('cbim_dispatch_task',fallback,signal,'no-role')).rejects.toThrow('参数无效');
  await expect(f.tools.call('cbim_dispatch_task',{...task,ownerSelection:undefined},signal,'no-owner')).rejects.toThrow('参数无效');
  const result=await f.tools.call('cbim_dispatch_task',{...fallback,agentId:'cbim:executor'},signal,'default-call');
  expect(f.dispatch).toHaveBeenCalledWith({...fallback,prerequisites:[],assigneeAgentId:'cbim:executor'},{toolCallId:'default-call',signal});
  expect(JSON.parse(result.content[0].text)).toMatchObject({disposition:'queued'});
  for(const field of ['assigneeAgentId','agentInstanceId','rootSessionId','permission']){
    await expect(f.tools.call('cbim_dispatch_task',{...fallback,[field]:'forged'},signal,'invalid')).rejects.toThrow('参数无效');
  }
  await expect(f.tools.call('cbim_dispatch_task',{...fallback,agentId:'cbim:main'},signal,'invalid')).rejects.toThrow('主 Agent 只能调度');
  await expect(f.tools.call('cbim_dispatch_task',{...fallback,moduleIds:[]},signal,'invalid')).rejects.toThrow('参数无效');
  expect(f.dispatch).toHaveBeenCalledTimes(1);
});
test('model cannot inject identity, authorization, commands or invalid domain inputs',async()=>{
  const f=fixture(),signal=new AbortController().signal;
  for(const field of ['workspaceId','rootSessionId','runId','agentInstanceId','commandId','permission','approved']){
    const input={...task,[field]:'forged'};
    expect(()=>f.tools.describe('cbim_dispatch_task',input)).toThrow('参数无效');
    await expect(f.tools.call('cbim_dispatch_task',input,signal,'trusted')).rejects.toThrow('参数无效');
  }
  for(const input of [{...task,moduleIds:[]},{...task,acceptance:[]},{...task,goal:''},{...task,prerequisites:[{taskId:'../escape',expectedPlanRevision:1}]}])expect(()=>f.tools.describe('cbim_dispatch_task',input)).toThrow('参数无效');
  expect(f.dispatch).not.toHaveBeenCalled();
});
test('missing trusted call IDs and cancelled calls do not enter the dispatch service',async()=>{
  const f=fixture(),controller=new AbortController();
  await expect(f.tools.call('cbim_dispatch_task',task,controller.signal)).rejects.toThrow('可信调用标识');
  await expect(f.tools.call('cbim_dispatch_task',task,controller.signal,'')).rejects.toThrow('可信调用标识');
  controller.abort(new Error('cancelled'));
  await expect(f.tools.call('cbim_dispatch_task',task,controller.signal,'call')).rejects.toThrow('cancelled');
  expect(f.dispatch).not.toHaveBeenCalled();
});
test('inspection uses only bound graph scope and candidate does not become acceptance',async()=>{
  const f=fixture(),signal=new AbortController().signal;
  await expect(f.tools.call('cbim_dispatch_inspect',{taskId:'task',rootSessionId:'other'},signal,'call')).rejects.toThrow('参数无效');
  await expect(f.tools.call('cbim_dispatch_inspect',{taskId:'../escape'},signal,'call')).rejects.toThrow('参数无效');
  const result=await f.tools.call('cbim_dispatch_inspect',{taskId:'task'},signal,'call');
  expect(f.inspect).toHaveBeenCalledWith('task');
  expect(JSON.parse(result.content[0].text).result.acceptance).toBe('not_evaluated');
  expect(f.dispatch).not.toHaveBeenCalled();
});
test('dispatch only records work; readonly delegation does not grant child writes or invoke approval',async()=>{
  const f=fixture(),approve=vi.fn(),guard=vi.fn();
  const decision=await authorizeRunTool({id:'call',name:'cbim_dispatch_task',input:task},f.tools.describe('cbim_dispatch_task',task),{workspaceId:'workspace',permission:'read',guard,approve});
  expect(decision).toMatchObject({allow:true,effects:['maintenance']});
  expect(approve).not.toHaveBeenCalled();
  expect(guard).not.toHaveBeenCalled();
  expect(f.dispatch).not.toHaveBeenCalled();
});
test('原run/call命令与回执必须一致，坏回包不自动重派或把queued改成running',async()=>{
  const f=fixture(),signal=new AbortController().signal;
  for(const invalid of [
    {commandId:'foreign-command',taskId:'task',messageId:'message',cursor:{workspaceId:'workspace',rootSessionId:'root',streamId:'stream',seq:1},disposition:'queued' as const},
    {commandId:mainToolCommandId('cbim_dispatch_task',mainToolBinding,'call')!,taskId:'task',messageId:'message',cursor:{workspaceId:'workspace',rootSessionId:'foreign',streamId:'stream',seq:1},disposition:'queued' as const},
  ]){f.dispatch.mockResolvedValueOnce(invalid);await expect(f.tools.call('cbim_dispatch_task',task,signal,'call')).rejects.toMatchObject({code:'TOOL_OUTPUT_INVALID'})}
  expect(f.dispatch).toHaveBeenCalledTimes(2);expect(f.inspect).not.toHaveBeenCalled();
  const metadata=f.tools.list().find(tool=>tool.name==='cbim_dispatch_task')!;
  expect(metadata).toMatchObject({version:2,effects:['maintenance'],cancellation:{mode:'preflight_only'},recovery:{mode:'inspect_before_retry',queryTool:'cbim_dispatch_command_report'}});expect(metadata.outputSchema).toBeTruthy();
});
