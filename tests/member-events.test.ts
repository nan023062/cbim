import {expect,it,vi} from 'vitest';
import {MemberEventStreams} from '../src/backend/scheduler-engine/execution/member-events';
import type {DispatchRun} from '../src/backend/core/tasks/dispatch-execution';
import type {RunSummary,StoredEvent,TaskSpec} from '../src/backend/core/brain/types';
import {toolReceipt} from '../src/backend/core/tools/receipts';
import path from 'node:path';

function fixture(){
  const task:TaskSpec={taskId:'task-1',workspaceId:'workspace-1',root:path.resolve('public-workspace'),agentId:'.cbim/team/dev',goal:'公开目标',moduleIds:['.cbim/workspace/game'],acceptance:['公开验收']};
  // This projection fixture never executes: domain preparation is exercised by the Application/Pi integration test.
  const run={binding:{workspaceId:task.workspaceId,teamId:'.cbim/team',agentId:task.agentId!,agentInstanceId:'member-1',agentSessionId:'channel-1',rootSessionId:'root-1',taskId:task.taskId,runId:'run-1',leaseEpoch:1,planRevision:1},status:'running',session:{nativeSessionId:'PRIVATE_NATIVE_SESSION',sessionFile:'PRIVATE_SESSION_FILE'},createdAt:'2026-11-06T00:00:00.000Z',startedAt:'2026-11-06T00:00:01.000Z'} as DispatchRun;
  const events:StoredEvent[]=[];
  const add=(type:StoredEvent['type'],data:Record<string,unknown>)=>{const event:StoredEvent={version:1,type,data,seq:events.length+1,workspaceId:task.workspaceId,taskId:task.taskId,runId:run.binding.runId,time:'2026-11-06T00:00:01.000Z'};events.push(event);return event};
  add('run.started',{task:{...task,workflowContext:{text:'PRIVATE_FROZEN_KNOWLEDGE'}},message:'PRIVATE_PROMPT_OVERRIDE',nativeSessionId:'PRIVATE_NATIVE_SESSION'});
  add('session.bound',{sessionFile:'PRIVATE_SESSION_FILE',sessionId:'PRIVATE_NATIVE_SESSION'});
  add('tool.proposed',{id:'write-1',name:'write',input:{path:'src/result.ts',content:'PRIVATE_WRITE_BODY',apiKey:'PRIVATE_KEY'}});
  add('tool.allowed',{id:'write-1',name:'write',allow:true,input:{path:'src/result.ts',content:'PRIVATE_WRITE_BODY'}});
  const receipt=toolReceipt({workspaceId:task.workspaceId,taskId:task.taskId,runId:run.binding.runId},{id:'write-1',name:'write',input:{path:'src/result.ts'}},{allow:true,effects:['business-write']},'succeeded','result');
  add('tool.finished',{id:'write-1',name:'write',isError:false,receipt,result:{content:[{type:'text',text:'PRIVATE_TOOL_BODY'}],apiKey:'PRIVATE_KEY',truncated:true}});
  add('message',{role:'assistant',text:'公开执行结论',thinking:'PRIVATE_REASONING',usage:{input:10,output:2,apiKey:'PRIVATE_KEY'}});
  add('engine.status',{label:'PRIVATE_STATUS_TEXT',error:'PRIVATE_ERROR',metric:'context',tokens:12,contextWindow:65536});
  const summary:RunSummary={task,runId:run.binding.runId,status:'completed',acceptance:'not_evaluated',memberBinding:run.binding,sessionFile:'PRIVATE_SESSION_FILE',unresolvedTools:[],events};
  return {task,run,events,add,summary};
}

it('merges an in-flight initial log read with live events, keeps pagination contiguous, and never rereads unchanged history',async()=>{
  const f=fixture();let release!:()=>void,entered!:()=>void;
  const enteredGate=new Promise<void>(resolve=>{entered=resolve}),gate=new Promise<void>(resolve=>{release=resolve});
  const inspect=vi.fn(async()=>{const snapshot={...f.summary,events:structuredClone(f.events.slice(0,2))};entered();await gate;return snapshot});
  const streams=new MemberEventStreams(inspect);streams.begin(f.run,f.task);streams.append(f.run,f.task,f.events[0]);
  const pending=streams.read(f.run,f.task,undefined,2);await enteredGate;
  for(const event of f.events.slice(1))streams.append(f.run,f.task,event);release();
  let page=await pending;expect(page).toMatchObject({mode:'reset',cursor:{runId:'run-1',seq:2},hasMore:true});
  const received:StoredEvent[]=[];
  while(page.mode!=='noop'){
    received.push(...page.events);if(!page.hasMore)break;
    page=await streams.read(f.run,f.task,page.cursor,2);
  }
  expect(received.map(event=>event.seq)).toEqual([1,2,3,4,5,6,7]);
  expect(received[1]).toMatchObject({type:'engine.status',data:{label:'成员会话已连接'}});
  expect(received[2].data.input).toEqual({path:'src/result.ts'});
  expect(received[4].data).toMatchObject({receipt:{outcome:'succeeded'},result:{content:[{type:'text',text:'工具已完成；详细正文未公开'}]},truncated:true});
  expect(received[5].data).toMatchObject({text:'公开执行结论',usage:{input:10,output:2}});
  expect(JSON.stringify(received)).not.toContain('PRIVATE_');
  const noop=await streams.read({...f.run,status:'completed'},f.task,page.cursor,2);
  expect(noop).toMatchObject({mode:'noop',cursor:{seq:7},run:{status:'completed',unresolvedTools:[]}});expect(inspect).toHaveBeenCalledTimes(1);
  noop.run.task.goal='client mutation';
  expect((await streams.read(f.run,f.task,page.cursor,2)).run.task.goal).toBe('公开目标');
  expect(await streams.read(f.run,f.task,{runId:'run-1',seq:99},2)).toMatchObject({mode:'reset',cursor:{seq:2},hasMore:true});
});

it('permits a registered fresh run before its first journal record but later live events are not lost',async()=>{
  const f=fixture(),run={...f.run,status:'starting' as const,startedAt:undefined,session:{nativeSessionId:'native-new'}};
  const inspect=vi.fn(async():Promise<RunSummary>=>{throw Object.assign(Error('not created yet'),{code:'ENOENT'})});
  const streams=new MemberEventStreams(inspect);streams.begin(run,f.task);
  expect(await streams.read(run,f.task,undefined,200)).toMatchObject({mode:'reset',cursor:{seq:0},events:[],hasMore:false,run:{status:'running'}});
  streams.append(run,f.task,f.events[0]);
  expect(await streams.read(run,f.task,{runId:'run-1',seq:0},200)).toMatchObject({mode:'delta',cursor:{seq:1},events:[{seq:1}]});
  expect(inspect).toHaveBeenCalledTimes(1);
});

it('retries a transient initial read failure once requested, then caches the successful recovery',async()=>{
  const f=fixture(),transient=Object.assign(Error('temporary file access failure'),{code:'EIO'});
  const inspect=vi.fn<()=>Promise<RunSummary>>().mockRejectedValueOnce(transient).mockResolvedValue(f.summary);
  const streams=new MemberEventStreams(inspect);
  const failed=await Promise.allSettled([streams.read(f.run,f.task,undefined,200),streams.read(f.run,f.task,undefined,200)]);
  expect(failed).toEqual([{status:'rejected',reason:transient},{status:'rejected',reason:transient}]);expect(inspect).toHaveBeenCalledTimes(1);
  streams.append(f.run,f.task,f.events[0]);
  const recovered=await streams.read(f.run,f.task,undefined,200);
  expect(recovered).toMatchObject({mode:'reset',cursor:{seq:7},hasMore:false});
  expect(await streams.read(f.run,f.task,recovered.cursor,200)).toMatchObject({mode:'noop'});expect(inspect).toHaveBeenCalledTimes(2);
  streams.append(f.run,f.task,{...f.events[5],data:{role:'assistant',text:'conflicting persisted event'}});
  await expect(streams.read(f.run,f.task,recovered.cursor,200)).rejects.toMatchObject({code:'MEMBER_EVENT_STREAM_INVALID'});
  expect(inspect).toHaveBeenCalledTimes(2);
});

it('rejects a corrupted historical identity, duplicate sequence changes and missing event prefixes instead of hiding gaps',async()=>{
  const f=fixture();
  const wrong=new MemberEventStreams(async()=>({...f.summary,memberBinding:{...f.run.binding,agentSessionId:'other'}}));
  await expect(wrong.read(f.run,f.task,undefined,200)).rejects.toMatchObject({code:'MEMBER_EVENT_STREAM_INVALID'});
  const streams=new MemberEventStreams(async()=>f.summary);await streams.read(f.run,f.task,undefined,200);
  streams.append(f.run,f.task,{...f.events[5],data:{role:'assistant',text:'conflicting text'}});
  await expect(streams.read(f.run,f.task,undefined,200)).rejects.toMatchObject({code:'MEMBER_EVENT_STREAM_INVALID'});
  const gap=new MemberEventStreams(async()=>({...f.summary,events:[f.events[0],f.events[2]]}));
  await expect(gap.read(f.run,f.task,undefined,200)).rejects.toMatchObject({code:'MEMBER_EVENT_STREAM_INVALID'});
});

it('does not disguise deleted completed logs as empty runs or publish external/knowledge paths',async()=>{
  const f=fixture();
  const inspect=vi.fn(async():Promise<RunSummary>=>{throw Object.assign(Error('missing journal'),{code:'ENOENT'})});
  const missing=new MemberEventStreams(inspect);
  await expect(missing.read({...f.run,status:'completed'},f.task,undefined,200)).rejects.toMatchObject({code:'ENOENT'});
  await expect(missing.read({...f.run,status:'completed'},f.task,undefined,200)).rejects.toMatchObject({code:'ENOENT'});expect(inspect).toHaveBeenCalledTimes(2);
  f.add('tool.proposed',{id:'private-path',name:'read',input:{path:'.cbim/team/dev/agent.json'}});
  f.add('tool.proposed',{id:'external-path',name:'read',input:{path:'../private/key.txt'}});
  const result=await new MemberEventStreams(async()=>f.summary).read(f.run,f.task,undefined,200);
  if(result.mode==='noop')throw Error('expected initial reset');
  expect(result.events.slice(-2).every(event=>event.data.input===undefined)).toBe(true);
});
