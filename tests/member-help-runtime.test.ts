import {expect,it} from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {LoopRuntime,type AgentEngine,type EngineContext,type EngineEvent,type TaskSpec,type MemberRunLaunch,type ToolDecision} from '../src/backend/core/brain';
import {FileRunStorage} from '../src/backend/main/persistence/tasks/run-storage';
import {MemberHelpTools} from '../src/backend/core/tasks/member-help-tools';
import {memberHelpStagedSchema} from '../src/backend/core/tasks/member-help';

const input={kind:'missing_input' as const,reason:'验收所需配置缺失',question:'请确认目标配置',attemptedToolCallIds:[] as string[]};
const binding={workspaceId:'workspace-one',teamId:'.cbim/team',agentId:'cbim:executor',agentInstanceId:'member-one',agentSessionId:'channel-one',rootSessionId:'root-session',taskId:'task-one',runId:'run-one',leaseEpoch:1,planRevision:1};
const gate=()=>{let resolve!:()=>void;const promise=new Promise<void>(r=>{resolve=r});return {promise,resolve}};
async function fixture(work:(context:EngineContext)=>Promise<void>,policy:(name:string)=>Promise<ToolDecision>=async()=>({allow:true,effects:['maintenance']}),beforeAppend?:(event:EngineEvent)=>Promise<void>){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-help-runtime-'));let context!:EngineContext,closed=false,leases=0,stops=0;
  const engine:AgentEngine={kind:'pi',start:async c=>{context=c;await c.emit({type:'session.bound',data:{sessionId:c.nativeSessionId,sessionFile:path.join(c.directory,'native.jsonl')}})},run:async()=>{await work(context);return {status:'completed'}},stop:async()=>{stops++},close:async()=>{closed=true}};
  const storage=new FileRunStorage(),create=storage.createJournal.bind(storage);
  if(beforeAppend)storage.createJournal=(...args)=>{const journal=create(...args),append=journal.append.bind(journal);journal.append=async event=>{await beforeAppend(event);return append(event)};return journal};
  const runtime=new LoopRuntime({directory,storage,acquireLease:async()=>{leases++;return()=>{leases--}},createEngine:()=>engine,toolPolicy:call=>policy(call.name)});
  const task:TaskSpec={taskId:binding.taskId,workspaceId:binding.workspaceId,root:directory,agentId:binding.agentId,goal:'处理目标模块',moduleIds:['.cbim/workspace/project/module'],acceptance:['核实目标']};
  const launch:MemberRunLaunch={binding,session:{nativeSessionId:'native-one'}};
  return {runtime,task,launch,get closed(){return closed},get leases(){return leases},get stops(){return stops},cleanup:async()=>{await runtime.close();const target=path.resolve(directory);if(path.dirname(target)!==path.resolve(os.tmpdir())||!path.basename(target).startsWith('cbim-help-runtime-'))throw Error('Unexpected cleanup');await fs.rm(target,{recursive:true,force:true})}};
}
async function help(c:EngineContext,id='help-one',value=input){
  const decision=await c.beforeTool({id,name:'cbim_task_help',input:value});expect(decision.allow).toBe(true);
  const result=await c.memberHelpTools!.call('cbim_task_help',value,id);
  await c.emit({type:'tool.finished',data:{id,name:'cbim_task_help',result,isError:false}});
  return JSON.parse((result.content[0] as {text:string}).text);
}

it('stages one identity-bound help before its successful receipt and prevents further business or progress tools',async()=>{
  let staged:any;const f=await fixture(async c=>{
    expect((await c.memberHelpTools!.list()).map(t=>t.name)).toEqual(['cbim_task_help']);
    staged=await help(c);
    for(const [id,name] of [['write-after','write'],['delivery-after','cbim_delivery_prepare'],['help-after','cbim_task_help']])expect((await c.beforeTool({id,name,input})).allow).toBe(false);
  });try{
    const run=await f.runtime.startMember(f.task,'处理',f.launch),s=await run.done;
    expect(staged.state).toBe('staged');expect(memberHelpStagedSchema.parse(staged.help).binding).toEqual(binding);
    const requested=s.events.find(e=>e.type==='task.help_requested')!,finished=s.events.find(e=>e.type==='tool.finished')!;
    expect(requested.seq).toBeLessThan(finished.seq);expect(finished.data.receipt).toMatchObject({outcome:'succeeded',toolCallId:'help-one'});
    expect(s.status).toBe('completed');expect(s.taskProgress).toBeUndefined();expect(f.closed).toBe(true);expect(f.leases).toBe(0);
  }finally{await f.cleanup()}
});

it('refuses help while a write is awaiting policy, then accepts a new help only after that call finishes',async()=>{
  const entered=gate(),release=gate();const f=await fixture(async c=>{
    const awaiting=c.beforeTool({id:'pending-write',name:'write',input:{path:'result.txt',content:'one'}});await entered.promise;
    expect((await c.beforeTool({id:'early-help',name:'cbim_task_help',input})).allow).toBe(false);
    release.resolve();expect((await awaiting).allow).toBe(true);
    expect((await c.beforeTool({id:'still-running-help',name:'cbim_task_help',input})).allow).toBe(false);
    await c.emit({type:'tool.finished',data:{id:'pending-write',name:'write',result:{content:[{type:'text',text:'written'}]},isError:false}});
    await help(c,'safe-help',{...input,attemptedToolCallIds:['pending-write']});
  },async name=>{if(name==='write'){entered.resolve();await release.promise}return {allow:true,effects:name==='write'?['business-write']:['maintenance']}});
  try{const run=await f.runtime.startMember(f.task,'处理',f.launch);expect((await run.done).status).toBe('completed')}finally{release.resolve();await f.cleanup()}
});

it('reserves the help fence before awaiting its policy, so concurrent commands cannot slip through',async()=>{
  const entered=gate(),release=gate();let commandPolicies=0;
  const f=await fixture(async c=>{
    const awaiting=c.beforeTool({id:'help-one',name:'cbim_task_help',input});await entered.promise;
    expect((await c.beforeTool({id:'racing-command',name:'bash',input:{command:'do something'}})).allow).toBe(false);
    release.resolve();expect((await awaiting).allow).toBe(true);
    const result=await c.memberHelpTools!.call('cbim_task_help',input,'help-one');await c.emit({type:'tool.finished',data:{id:'help-one',name:'cbim_task_help',result}});
  },async name=>{if(name==='cbim_task_help'){entered.resolve();await release.promise}else commandPolicies++;return {allow:true,effects:['maintenance']}});
  try{const run=await f.runtime.startMember(f.task,'处理',f.launch);expect((await run.done).status).toBe('completed');expect(commandPolicies).toBe(0)}finally{release.resolve();await f.cleanup()}
});

it('does not expose or authorize member help for an ordinary main run',async()=>{
  const f=await fixture(async c=>{expect(c.memberHelpTools).toBeUndefined();expect((await c.beforeTool({id:'fake-help',name:'cbim_task_help',input})).allow).toBe(false)});
  try{const run=await f.runtime.start({...f.task,mode:'chat',agentId:'cbim:main'});expect((await run.done).events.some(e=>e.type==='task.help_requested')).toBe(false)}finally{await f.cleanup()}
});

it('logging a concurrently rejected tool does not poison the already authorized help fence',async()=>{
  const entered=gate(),release=gate();const f=await fixture(async c=>{
    expect((await c.beforeTool({id:'help-one',name:'cbim_task_help',input})).allow).toBe(true);
    const rejected=c.beforeTool({id:'rejected-write',name:'write',input:{path:'file',content:'never'}});await entered.promise;
    const result=await c.memberHelpTools!.call('cbim_task_help',input,'help-one');
    release.resolve();expect((await rejected).allow).toBe(false);
    await c.emit({type:'tool.finished',data:{id:'help-one',name:'cbim_task_help',result,isError:false}});
  },undefined,async event=>{if(event.type==='tool.proposed'&&event.data.id==='rejected-write'){entered.resolve();await release.promise}});
  try{const run=await f.runtime.startMember(f.task,'处理',f.launch);const s=await run.done;expect(s.status).toBe('completed');expect(s.events.filter(e=>e.type==='task.help_requested')).toHaveLength(1)}finally{release.resolve();await f.cleanup()}
});

it('rechecks cancellation before committing an already authorized help',async()=>{
  const entered=gate(),release=gate();const f=await fixture(async c=>{
    expect((await c.beforeTool({id:'help-one',name:'cbim_task_help',input})).allow).toBe(true);entered.resolve();await release.promise;
    await expect(c.memberHelpTools!.call('cbim_task_help',input,'help-one')).rejects.toThrow('停止');
    await c.emit({type:'tool.finished',data:{id:'help-one',name:'cbim_task_help',result:{content:[{type:'text',text:'stopped'}]},isError:true}});
  });try{const run=await f.runtime.startMember(f.task,'处理',f.launch);await entered.promise;await f.runtime.stop(f.task.taskId);release.resolve();expect((await run.done).events.some(e=>e.type==='task.help_requested')).toBe(false)}finally{release.resolve();await f.cleanup()}
});

it('rejects invented attempted tool IDs and permits corrected help only with a new authorized call',async()=>{
  const f=await fixture(async c=>{
    const forged={...input,attemptedToolCallIds:['foreign-call']};expect((await c.beforeTool({id:'help-one',name:'cbim_task_help',input:forged})).allow).toBe(true);
    await expect(c.memberHelpTools!.call('cbim_task_help',forged,'help-one')).rejects.toThrow('不存在');
    await c.emit({type:'tool.finished',data:{id:'help-one',name:'cbim_task_help',result:{content:[{type:'text',text:'invalid'}]},isError:true}});
    await help(c,'corrected-help');
  });try{const run=await f.runtime.startMember(f.task,'处理',f.launch);const events=(await run.done).events.filter(e=>e.type==='task.help_requested');expect(events).toHaveLength(1);expect((events[0].data.help as any).toolCallId).toBe('corrected-help')}finally{await f.cleanup()}
});

it('does not replay a help whose canonical append failed, or change its authorized body',async()=>{
  let writes=0;const tool=new MemberHelpTools(binding,{save:async()=>{writes++;throw Error('disk unavailable')},assertReady:()=>{}});
  expect(tool.guard('cbim_task_help','help-one',input,[])).toBeUndefined();
  await expect(tool.call('cbim_task_help',{...input,question:'changed'},'help-one')).rejects.toThrow('不一致');expect(writes).toBe(0);
  expect(tool.guard('cbim_task_help','help-two',input,[])).toBeUndefined();await expect(tool.call('cbim_task_help',input,'help-two')).rejects.toThrow('disk unavailable');
  tool.denied('help-two');expect(tool.guard('write','write-one',{},[])).toContain('结束本轮');
  await expect(tool.call('cbim_task_help',input,'help-two')).rejects.toThrow('一次性');expect(writes).toBe(1);
});

it('still aborts the engine when the stop intent cannot be written, retaining interrupted status',async()=>{
  const entered=gate(),release=gate();const f=await fixture(async()=>{entered.resolve();await release.promise},undefined,async event=>{if(event.type==='run.stop_requested')throw Error('stop disk failed')});
  try{
    const run=await f.runtime.startMember(f.task,'处理',f.launch);await entered.promise;
    await expect(f.runtime.stop(f.task.taskId)).rejects.toThrow('stop disk failed');expect(f.stops).toBe(1);release.resolve();
    const s=await run.done;expect(s.status).toBe('interrupted');expect(s.events.at(-1)?.data.error).toBe('stop disk failed');expect(f.closed).toBe(true);
  }finally{release.resolve();await f.cleanup()}
});

it('releases only an unconsumed policy-denied reservation and rejects unknown runtime identity parameters',async()=>{
  const tool=new MemberHelpTools(binding,{save:async()=>{},assertReady:()=>{}});
  expect(tool.guard('cbim_task_help','invalid',{...input,rootSessionId:'other'},[])).toContain('参数');
  expect(tool.guard('cbim_task_help','denied',input,[])).toBeUndefined();tool.denied('other');expect(tool.guard('read','read-one',{},[])).toBeTruthy();
  tool.denied('denied');expect(tool.guard('read','read-two',{},[])).toBeUndefined();
  expect(tool.guard('cbim_task_help','retry',input,[])).toBeUndefined();await expect(tool.call('cbim_task_help',input)).rejects.toThrow('一次性');
  expect(JSON.parse(((await tool.call('cbim_task_help',input,'retry')).content[0] as {text:string}).text).state).toBe('staged');
});

it('cancellation during engine close cannot commit a normal help terminal',async()=>{
  const closing=gate(),release=gate();const directory=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-help-runtime-'));let context!:EngineContext;
  const engine:AgentEngine={kind:'pi',start:async c=>{context=c},run:async()=>{await help(context);return {status:'completed'}},stop:async()=>{},close:async()=>{closing.resolve();await release.promise}};
  const runtime=new LoopRuntime({directory,storage:new FileRunStorage(),acquireLease:async()=>()=>{},createEngine:()=>engine,toolPolicy:async()=>({allow:true,effects:['maintenance']})});
  const task:TaskSpec={taskId:binding.taskId,workspaceId:binding.workspaceId,root:directory,agentId:binding.agentId,goal:'处理',moduleIds:['.cbim/workspace/module'],acceptance:['检查']};
  try{
    const run=await runtime.startMember(task,'处理',{binding,session:{nativeSessionId:'native-one'}});await closing.promise;await runtime.stop(task.taskId);release.resolve();
    const s=await run.done;expect(s.status).toBe('cancelled');expect(s.events.some(e=>e.type==='task.help_requested')).toBe(true);expect(s.events.at(-1)?.data.status).toBe('cancelled');
  }finally{release.resolve();await runtime.close();const target=path.resolve(directory);if(path.dirname(target)!==path.resolve(os.tmpdir())||!path.basename(target).startsWith('cbim-help-runtime-'))throw Error('Unexpected cleanup');await fs.rm(target,{recursive:true,force:true})}
});
