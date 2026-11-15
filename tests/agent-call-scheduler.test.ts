import {describe,it,expect,vi} from 'vitest';
import {AgentCallScheduler} from '../src/logic/execution/assembly/agent-call-scheduler';
import type {AgentSchedulerPorts} from '../src/logic/execution/assembly/agent-call-scheduler';
import type {AgentToolContext} from '../src/logic/agents/contracts';
import type {RunSummary,TaskSpec,EngineEvent} from '../src/logic/execution/rules/types';

const task=(id='root'):TaskSpec=>({taskId:id,workspaceId:'workspace',root:'/project',mode:'chat',agentId:'cbim:main',goal:'work',moduleIds:[],acceptance:[]});
const summary=(id:string):RunSummary=>({task:task(id),runId:id+'-run',status:'completed',acceptance:'not_evaluated',events:[],unresolvedTools:[]});
function context(id='root',events:EngineEvent[]=[]):AgentToolContext{return {task:task(id),runId:id+'-run',assertExclusive:()=>{},emit:async event=>{events.push(event)}}}
function result(value:any){return JSON.parse(value.content[0].text)}
function prepared(id:string,body:()=>Promise<RunSummary>=async()=>summary(id)){
  const agent={definition:{id,name:id,instructions:'role',permission:'read' as const},conversation:{workspaceId:'workspace',taskId:id}};
  const release=vi.fn(),stop=vi.fn(async()=>{}),close=vi.fn(async()=>{});
  const runtime:Awaited<ReturnType<AgentSchedulerPorts['prepare']>>['runtime']={start:async(t,_message,_resume,_source,control)=>{
    const abort=()=>{void stop()};control?.signal.addEventListener('abort',abort,{once:true});
    await control?.beforeRun?.({task:t,runId:id+'-run'});
    return {runId:id+'-run',done:body().finally(()=>control?.signal.removeEventListener('abort',abort))};
  },close};
  return {agent,task:task(id),runtime,release,stop,close};
}
describe('AgentCallScheduler',()=>{
  it('routes A to B to C using the same tool and preserves direct caller identities',async()=>{
    const events:EngineEvent[]=[],releases:ReturnType<typeof vi.fn>[]=[];
    let scheduler:AgentCallScheduler;
    const prepare:AgentSchedulerPorts['prepare']=async input=>{
      const child=prepared(input.agentId,async()=>{
        if(input.agentId==='B'){
          const tools=scheduler.bind(context('B',events),input.parent.depth+1);
          const value=await tools.capability.tools.call('cbim_agent_call',{agentId:'C',message:'nested'},input.signal,'call-C');
          expect(result(value).agentCall.callerTaskId).toBe('B');
        }
        return summary(input.agentId);
      });releases.push(child.release);return child;
    };
    scheduler=new AgentCallScheduler({maxDepth:2},{prepare});
    const root=scheduler.bind(context('A',events));
    const value=await root.capability.tools.call('cbim_agent_call',{agentId:'B',message:'work'},new AbortController().signal,'call-B');
    expect(result(value).agentCall).toMatchObject({callerTaskId:'A',taskId:'B',toolCallId:'call-B'});
    expect(events.map(e=>(e.data.agentCall as any).taskId)).toEqual(['B','C']);
    expect(releases.every(release=>release.mock.calls.length===1)).toBe(true);
  });
  it('returns a depth error before prepare or persistent events',async()=>{
    const prepare=vi.fn(),events:EngineEvent[]=[];const scheduler=new AgentCallScheduler({maxDepth:0},{prepare});
    const value=await scheduler.bind(context('root',events)).capability.tools.call('cbim_agent_call',{agentId:'B',message:'work'},new AbortController().signal,'call');
    expect(value).toMatchObject({isError:true});expect(result(value).error).toMatchObject({code:'AGENT_DEPTH_LIMIT',current:0,limit:0,started:false});expect(prepare).not.toHaveBeenCalled();expect(events).toEqual([]);
  });
  it('returns the execution admission error without keeping a second capacity counter',async()=>{
    const prepare=vi.fn(async()=>{throw Object.assign(Error('global capacity'),{code:'AGENT_CONCURRENCY_LIMIT'})});
    const scheduler=new AgentCallScheduler({maxDepth:2},{prepare});
    const value=await scheduler.bind(context()).capability.tools.call('cbim_agent_call',{agentId:'B',message:'work'},new AbortController().signal,'one');
    expect(result(value).error).toMatchObject({code:'AGENT_CONCURRENCY_LIMIT',started:false});
    expect(prepare).toHaveBeenCalledTimes(1);
  });
  it('deduplicates a tool invocation and rejects changed input under the same identity',async()=>{
    const child=prepared('B'),prepare=vi.fn(async()=>child),scheduler=new AgentCallScheduler({maxDepth:2},{prepare}),tools=scheduler.bind(context()).capability.tools,signal=new AbortController().signal;
    const a=await tools.call('cbim_agent_call',{agentId:'B',message:'same'},signal,'one');
    expect(await tools.call('cbim_agent_call',{agentId:'B',message:'same'},signal,'one')).toEqual(a);
    expect(result(await tools.call('cbim_agent_call',{agentId:'B',message:'different'},signal,'one')).error.code).toBe('AGENT_CALL_CONFLICT');expect(prepare).toHaveBeenCalledTimes(1);
  });
  it('refuses a non-exclusive caller batch before creating a child',async()=>{
    const prepare=vi.fn(),scheduler=new AgentCallScheduler({maxDepth:2},{prepare});
    const value=await scheduler.bind({...context(),assertExclusive:()=>{throw Error('other tool running')}}).capability.tools.call('cbim_agent_call',{agentId:'B',message:'work'},new AbortController().signal,'call');
    expect(result(value).error.code).toBe('AGENT_CALL_BUSY');expect(prepare).not.toHaveBeenCalled();
  });
  it('rejects model-supplied caller identity or permission fields',async()=>{
    const prepare=vi.fn(),scheduler=new AgentCallScheduler({maxDepth:2},{prepare});
    const value=await scheduler.bind(context()).capability.tools.call('cbim_agent_call',{agentId:'B',message:'work',permission:'execute'},new AbortController().signal,'call');
    expect(result(value).error.code).toBe('AGENT_CALL_INPUT');expect(prepare).not.toHaveBeenCalled();
  });
  it('propagates cancellation and waits for real completion before releasing resources',async()=>{
    let finish!:(value:RunSummary)=>void;const child=prepared('B',()=>new Promise(resolve=>{finish=resolve})),scheduler=new AgentCallScheduler({maxDepth:2},{prepare:async()=>child}),binding=scheduler.bind(context());
    const running=binding.capability.tools.call('cbim_agent_call',{agentId:'B',message:'work'},new AbortController().signal,'call');
    await vi.waitFor(()=>expect(finish).toBeTypeOf('function'));
    const stopping=binding.stop();await Promise.resolve();expect(child.stop).toHaveBeenCalled();expect(child.release).not.toHaveBeenCalled();
    finish({...summary('B'),status:'cancelled'});await stopping;expect(await running).toMatchObject({isError:true});expect(child.release).toHaveBeenCalledTimes(1);
  });
  it('does not release an unconfirmed process; close retries only the drain',async()=>{
    const child=prepared('B');child.close.mockRejectedValue(Error('not drained'));
    const prepare=vi.fn(async()=>child),scheduler=new AgentCallScheduler({maxDepth:2},{prepare}),binding=scheduler.bind(context());
    await expect(binding.capability.tools.call('cbim_agent_call',{agentId:'B',message:'work'},new AbortController().signal,'call')).rejects.toThrow('not drained');
    expect(child.release).not.toHaveBeenCalled();expect(binding.active()).toBe(true);
    child.close.mockResolvedValue();await scheduler.close();expect(child.release).toHaveBeenCalledTimes(1);expect(prepare).toHaveBeenCalledTimes(1);
  });
});
it('pauses inside one child run, routes answers only from its caller and deduplicates repeated replies',async()=>{
 const events:EngineEvent[]=[],answers:unknown[]=[];let child:ReturnType<typeof prepared>;
 const prepare=vi.fn(async(input:Parameters<AgentSchedulerPorts['prepare']>[0])=>{
   child=prepared('B',async()=>{answers.push(await input.requestQuestion({questions:[{question:'Which branch?',options:[{label:'A'},{label:'B'}]}]},input.signal));return summary('B')});return child;
 });
 const scheduler=new AgentCallScheduler({maxDepth:3},{prepare}),binding=scheduler.bind(context('A',events)),tools=binding.capability.tools,signal=new AbortController().signal;
 const waiting=result(await tools.call('cbim_agent_call',{agentId:'B',message:'work'},signal,'original'));
 expect(waiting).toMatchObject({status:'waiting',callId:'original',questionId:'1',agentCall:{taskId:'B',runId:'B-run'}});
 expect(binding.active()).toBe(true);expect(child!.release).not.toHaveBeenCalled();
 expect(binding.allowsWhileWaiting?.('write')).toBe(false);expect(binding.allowsWhileWaiting?.('cbim_ask_user_question')).toBe(true);
 const reply={callId:'original',questionId:'1',result:{answers:[{question:'Which branch?',answer:'A'}]}};
 expect(result(await scheduler.bind(context('foreign')).capability.tools.call('cbim_agent_reply',reply,signal,'reply')).error.code).toBe('AGENT_CALL_IDENTITY');
 const bad=await tools.call('cbim_agent_reply',{...reply,result:{answers:[{question:'Other?',answer:'A'}]}},signal,'wrong');expect(bad).toMatchObject({isError:true});expect(answers).toEqual([]);
 const done=await tools.call('cbim_agent_reply',reply,signal,'reply');
 expect(result(done)).toMatchObject({status:'completed',agentCall:{taskId:'B',runId:'B-run',toolCallId:'original'}});
 expect(await tools.call('cbim_agent_reply',reply,signal,'repeat')).toEqual(done);expect(prepare).toHaveBeenCalledTimes(1);expect(answers).toHaveLength(1);
 expect(result(await tools.call('cbim_agent_reply',{...reply,result:{answers:[{question:'Which branch?',answer:'B'}]}},signal,'conflict')).error.code).toBe('AGENT_REPLY_CONFLICT');
 expect(events.filter(e=>e.data.agentCallState).map(e=>e.data.agentCallState)).toEqual(['waiting','running','completed']);
 expect(child!.release).toHaveBeenCalledTimes(1);
});
it('stopping a question aborts the original wait and rejects late replies without restarting the child',async()=>{
 let child:ReturnType<typeof prepared>;
 const prepare=vi.fn(async(input:Parameters<AgentSchedulerPorts['prepare']>[0])=>{
   child=prepared('B',async()=>{await input.requestQuestion({questions:[{question:'Continue?',options:[{label:'Yes'},{label:'No'}]}]},new AbortController().signal);return summary('B')});return child;
 });
 const scheduler=new AgentCallScheduler({maxDepth:2},{prepare}),binding=scheduler.bind(context()),signal=new AbortController().signal;
 const waiting=result(await binding.capability.tools.call('cbim_agent_call',{agentId:'B',message:'work'},signal,'call'));expect(waiting.status).toBe('waiting');
 await binding.stop();
 const late=await binding.capability.tools.call('cbim_agent_reply',{callId:'call',questionId:'1',result:{answers:[{question:'Continue?',answer:'Yes'}]}},signal,'late');
 expect(late).toMatchObject({isError:true});expect(prepare).toHaveBeenCalledTimes(1);expect(child!.release).toHaveBeenCalledTimes(1);expect(binding.active()).toBe(false);
});

it('starts a frozen business run once and rechecks only the original caller result',async()=>{
 const child=prepared('B'),startMember=vi.fn(async(task,message,launch,control)=>child.runtime.start(task,message,undefined,undefined,control));
 let stale=false;const verify=vi.fn(async()=>{if(stale)throw Object.assign(Error('changed bytes'),{code:'WORKFLOW_VALIDATION_STALE'});return {state:'verified'}});
 const launch={binding:{} as any,session:{nativeSessionId:'session'}};
 const prepare=vi.fn(async()=>({...child,runtime:{...child.runtime,startMember},launch,verify}));
 const scheduler=new AgentCallScheduler({maxDepth:2},{prepare}),tools=scheduler.bind(context()).capability.tools,signal=new AbortController().signal;
 const value=await tools.call('cbim_agent_call',{agentId:'B',message:'work',business:{moduleIds:['module'],acceptance:['actual bytes']}},signal,'original');
 expect(result(value)).toMatchObject({status:'completed',verification:{state:'verified'}});
 expect(startMember).toHaveBeenCalledTimes(1);expect(prepare.mock.calls).toHaveLength(1);expect(child.release).toHaveBeenCalledTimes(1);
 expect(result(await tools.call('cbim_agent_result_check',{callId:'original'},signal,'check'))).toEqual({state:'verified'});
 expect(result(await scheduler.bind(context('other')).capability.tools.call('cbim_agent_result_check',{callId:'original'},signal,'check')).error.code).toBe('AGENT_RESULT_UNAVAILABLE');
 stale=true;
 expect(result(await tools.call('cbim_agent_result_check',{callId:'original'},signal,'stale')).error.code).toBe('WORKFLOW_VALIDATION_STALE');
 expect(startMember).toHaveBeenCalledTimes(1);expect(prepare).toHaveBeenCalledTimes(1);
 await scheduler.close();
 expect(await tools.call('cbim_agent_result_check',{callId:'original'},signal,'closed')).toMatchObject({isError:true});
});
it('returns a business verification failure instead of completed when model execution ends',async()=>{
 const child=prepared('B'),verify=vi.fn(async()=>{throw Object.assign(Error('no valid proof'),{code:'WORKFLOW_EVIDENCE_INVALID'})});
 const scheduler=new AgentCallScheduler({maxDepth:1},{prepare:async()=>({...child,verify})});
 const value=await scheduler.bind(context()).capability.tools.call('cbim_agent_call',{agentId:'B',message:'work'},new AbortController().signal,'call');
 expect(value).toMatchObject({isError:true});expect(result(value)).toMatchObject({error:{code:'WORKFLOW_EVIDENCE_INVALID',started:true}});
 expect(result(value)).not.toHaveProperty('status','completed');expect(child.release).toHaveBeenCalledTimes(1);
});
