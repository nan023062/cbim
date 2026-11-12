import {expect,it} from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {LoopRuntime,checkedConversationAgentBinding,type AgentEngine,type EngineContext,type TaskSpec,type ConversationAgentBinding} from '../src/backend/core/execution';
import {FileRunStorage} from '../src/backend/main/run-storage/run-storage';

const binding=():ConversationAgentBinding=>({workspaceId:'workspace',teamId:'.cbim/team/team.md',agentId:'cbim:main',agentInstanceId:'main-instance',agentSessionId:'conversation-channel',rootSessionId:'main-session'});
class Engine implements AgentEngine {
  readonly kind='test';context!:EngineContext;
  async start(context:EngineContext){this.context=context;await context.emit({type:'session.bound',data:{sessionId:context.nativeSessionId??'native-'+context.task.taskId,sessionFile:context.sessionFile??path.join(context.directory,'session.jsonl')}})}
  async run(){return {status:'completed' as const}}
  async stop(){}
  async close(){}
}
async function fixture(){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-conversation-binding-')),engines:Engine[]=[],runtimes:LoopRuntime[]=[];
  const task:TaskSpec={taskId:'main-session',workspaceId:'workspace',root:directory,goal:'Review current project',moduleIds:[],acceptance:[],mode:'chat',agentId:'cbim:main'};
  let leases=0;
  const create=(conversationBinding?:ConversationAgentBinding)=>{
    const runtime=new LoopRuntime({directory,conversationBinding,storage:new FileRunStorage(),acquireLease:async()=>{leases++;return()=>{leases--}},toolPolicy:async()=>({allow:false}),createEngine:()=>{const engine=new Engine();engines.push(engine);return engine}});
    runtimes.push(runtime);return runtime;
  };
  return {directory,task,engines,create,leases:()=>leases,cleanup:async()=>{
    await Promise.all(runtimes.map(runtime=>runtime.close()));
    const target=path.resolve(directory);
    if(path.dirname(target)!==path.resolve(os.tmpdir())||!path.basename(target).startsWith('cbim-conversation-binding-'))throw Error('Unexpected cleanup path');
    await fs.rm(target,{recursive:true,force:true});
  }};
}

it('checks explicit main chat identity and rejects invalid, foreign and extra binding fields',async()=>{
  const f=await fixture();try{
    const value=binding(),checked=checkedConversationAgentBinding(value,f.task);value.agentSessionId='changed';expect(checked).toEqual(binding());
    for(const candidate of [null,[],{}, {...binding(),agentId:'other'}, {...binding(),teamId:' '}, {...binding(),workspaceId:'foreign'}, {...binding(),rootSessionId:'another-root'}, {...binding(),agentInstanceId:'../instance'}, {...binding(),agentSessionId:''}, {...binding(),permission:'full-access'}])expect(()=>checkedConversationAgentBinding(candidate,f.task)).toThrow();
    for(const task of [{...f.task,mode:undefined},{...f.task,agentId:undefined},{...f.task,agentId:'other'}])expect(()=>checkedConversationAgentBinding(binding(),task)).toThrow();
  }finally{await f.cleanup()}
});

it('persists a trusted main instance snapshot while preserving ordinary native history on resume',async()=>{
  const f=await fixture();try{
    const original=binding(),runtime=f.create(original),pending=runtime.start(f.task);
    original.agentSessionId='caller-mutated-after-start';
    const first=await pending,summary=await first.done;
    expect(summary.conversationBinding).toEqual(binding());expect(summary.events[0].data.conversationBinding).toEqual(binding());
    expect(f.engines[0].context.conversationBinding).toEqual(binding());expect(f.engines[0].context.nativeSessionId).toBeUndefined();expect(summary.memberBinding).toBeUndefined();
    const secondRuntime=f.create(binding()),second=await secondRuntime.start(f.task,'Continue',{runId:first.runId}),continued=await second.done;
    expect(continued.conversationBinding).toEqual(binding());expect(continued.sessionFile).toBe(summary.sessionFile);
    expect(f.engines[1].context.sessionFile).toBe(summary.sessionFile);expect(f.engines[1].context.nativeSessionId).toBe('native-'+f.task.taskId);
    expect(f.engines[1].context.nativeSessionId).not.toBe(binding().agentSessionId);
    expect(f.leases()).toBe(0);
  }finally{await f.cleanup()}
});

it('refuses missing or changed bound identities before a new engine or run is created',async()=>{
  const f=await fixture();try{
    const runtime=f.create(binding()),first=await runtime.start(f.task);await first.done;
    for(const next of [undefined,{...binding(),teamId:'other-team'}, {...binding(),agentInstanceId:'other-instance'}, {...binding(),agentSessionId:'other-channel'}]){
      const attempted=f.create(next);
      await expect(attempted.start(f.task,'Continue',{runId:first.runId})).rejects.toThrow('原主对话实例与通道身份');
      expect(f.leases()).toBe(0);
    }
    expect(f.engines).toHaveLength(1);expect(await fs.readdir(path.join(f.directory,f.task.taskId))).toEqual([first.runId]);
  }finally{await f.cleanup()}
});

it('binds an explicit legacy continuation without rewriting old logs or replacing the native session',async()=>{
  const f=await fixture();try{
    const legacy=f.create(),first=await legacy.start(f.task),original=await first.done;
    const file=path.join(f.directory,f.task.taskId,first.runId,'events.jsonl'),before=await fs.readFile(file,'utf8');
    expect(original.conversationBinding).toBeUndefined();
    const current=f.create(binding()),second=await current.start(f.task,'Continue',{runId:first.runId}),continued=await second.done;
    expect(continued.conversationBinding).toEqual(binding());expect(continued.sessionFile).toBe(original.sessionFile);
    expect((await current.inspect(f.task.taskId,first.runId)).conversationBinding).toBeUndefined();expect(await fs.readFile(file,'utf8')).toBe(before);
    await expect(current.start({...f.task,goal:'Changed original definition'},'Continue',{runId:second.runId})).rejects.toThrow('原任务定义');
  }finally{await f.cleanup()}
});

it('keeps trusted member result sources alongside conversation identity on a safe continuation',async()=>{
  const f=await fixture();try{
    const runtime=f.create(binding()),first=await runtime.start(f.task);await first.done;
    const source={kind:'member-results' as const,continuationId:'result-batch',messageIds:['result-one'],taskIds:['business-task']};
    const next=await runtime.start(f.task,'Member candidate data',{runId:first.runId},source),summary=await next.done;
    expect(summary.source).toEqual(source);expect(summary.conversationBinding).toEqual(binding());
    expect(f.engines[1].context).toMatchObject({source,conversationBinding:binding()});
  }finally{await f.cleanup()}
});

it('rejects corrupted or mixed persisted identity rather than inventing a valid main instance',async()=>{
  const f=await fixture();try{
    const runtime=f.create(binding()),first=await runtime.start(f.task);await first.done;
    const file=path.join(f.directory,f.task.taskId,first.runId,'events.jsonl'),lines=(await fs.readFile(file,'utf8')).trimEnd().split('\n'),initial=JSON.parse(lines[0]);
    for(const data of [{...initial.data,conversationBinding:{...binding(),rootSessionId:'another-root'}},{...initial.data,conversationBinding:{...binding(),unknown:'value'}},{...initial.data,memberBinding:{}}]){
      await fs.writeFile(file,[JSON.stringify({...initial,data}),...lines.slice(1)].join('\n')+'\n');
      await expect(runtime.inspect(f.task.taskId,first.runId)).rejects.toThrow();
    }
  }finally{await f.cleanup()}
});

it('does not allow conversation identity to become a formal member task binding',async()=>{
  const f=await fixture();try{
    const runtime=f.create(binding()),task={...f.task,mode:undefined,taskId:'business-task',moduleIds:['module-one']};
    await expect(runtime.startMember(task,'Implement module',{binding:{...binding(),agentSessionId:'task-channel',taskId:task.taskId,runId:'member-run',leaseEpoch:0,planRevision:1},session:{nativeSessionId:'member-native'}})).rejects.toThrow('普通对话');
    expect(f.engines).toHaveLength(0);expect(f.leases()).toBe(0);
  }finally{await f.cleanup()}
});
