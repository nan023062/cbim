import {describe,it,expect,vi} from 'vitest';
import {Agent} from '../src/logic/agents/agent';
import {AgentExecutionLoop} from '../src/logic/agents/loop';
import {AgentCallScheduler} from '../src/logic/agents/scheduler';
import type {AgentSchedulerPorts} from '../src/logic/agents/scheduler';
import type {AgentToolContext} from '../src/logic/agents/contracts';
import type {RunSummary,TaskSpec,EngineEvent} from '../src/logic/execution/rules/types';

const task=(id='root'):TaskSpec=>({taskId:id,workspaceId:'workspace',root:'/project',mode:'chat',agentId:'cbim:main',goal:'work',moduleIds:[],acceptance:[]});
const summary=(id:string):RunSummary=>({task:task(id),runId:id+'-run',status:'completed',acceptance:'not_evaluated',events:[],unresolvedTools:[]});
function context(id='root',events:EngineEvent[]=[]):AgentToolContext{return {task:task(id),runId:id+'-run',assertExclusive:()=>{},emit:async event=>{events.push(event)}}}
function result(value:any){return JSON.parse(value.content[0].text)}
function prepared(id:string,body:()=>Promise<RunSummary>=async()=>summary(id)){
  const agent=new Agent({id,name:id,instructions:'role',permission:'read'},{workspaceId:'workspace',taskId:id});
  const release=vi.fn(),stop=vi.fn(async()=>{}),close=vi.fn(async()=>{});
  const loop=new AgentExecutionLoop(agent,{start:async(_message,_signal,before)=>{await before(id+'-run');return {runId:id+'-run',done:body()}},stop,close});
  return {agent,loop,release,stop,close};
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
    scheduler=new AgentCallScheduler({maxDepth:2,maxConcurrent:3},{prepare});
    const root=scheduler.bind(context('A',events));
    const value=await root.capability.tools.call('cbim_agent_call',{agentId:'B',message:'work'},new AbortController().signal,'call-B');
    expect(result(value).agentCall).toMatchObject({callerTaskId:'A',taskId:'B',toolCallId:'call-B'});
    expect(events.map(e=>(e.data.agentCall as any).taskId)).toEqual(['B','C']);
    expect(releases.every(release=>release.mock.calls.length===1)).toBe(true);
  });
  it('returns a depth error before prepare or persistent events',async()=>{
    const prepare=vi.fn(),events:EngineEvent[]=[];const scheduler=new AgentCallScheduler({maxDepth:0,maxConcurrent:2},{prepare});
    const value=await scheduler.bind(context('root',events)).capability.tools.call('cbim_agent_call',{agentId:'B',message:'work'},new AbortController().signal,'call');
    expect(value).toMatchObject({isError:true});expect(result(value).error).toMatchObject({code:'AGENT_DEPTH_LIMIT',current:0,limit:0,started:false});expect(prepare).not.toHaveBeenCalled();expect(events).toEqual([]);
  });
  it('reserves capacity synchronously before async preparation',async()=>{
    let finish!:(value:ReturnType<typeof prepared>)=>void;
    const prepare=vi.fn(()=>new Promise<ReturnType<typeof prepared>>(resolve=>{finish=resolve}));
    const scheduler=new AgentCallScheduler({maxDepth:2,maxConcurrent:1},{prepare});
    const tools=scheduler.bind(context()).capability.tools;
    const first=tools.call('cbim_agent_call',{agentId:'B',message:'one'},new AbortController().signal,'one');
    const second=await tools.call('cbim_agent_call',{agentId:'C',message:'two'},new AbortController().signal,'two');
    expect(result(second).error.code).toBe('AGENT_CONCURRENCY_LIMIT');expect(prepare).toHaveBeenCalledTimes(1);finish(prepared('B'));await first;
  });
  it('deduplicates a tool invocation and rejects changed input under the same identity',async()=>{
    const child=prepared('B'),prepare=vi.fn(async()=>child),scheduler=new AgentCallScheduler({maxDepth:2,maxConcurrent:2},{prepare}),tools=scheduler.bind(context()).capability.tools,signal=new AbortController().signal;
    const a=await tools.call('cbim_agent_call',{agentId:'B',message:'same'},signal,'one');
    expect(await tools.call('cbim_agent_call',{agentId:'B',message:'same'},signal,'one')).toEqual(a);
    expect(result(await tools.call('cbim_agent_call',{agentId:'B',message:'different'},signal,'one')).error.code).toBe('AGENT_CALL_CONFLICT');expect(prepare).toHaveBeenCalledTimes(1);
  });
  it('refuses a non-exclusive caller batch before creating a child',async()=>{
    const prepare=vi.fn(),scheduler=new AgentCallScheduler({maxDepth:2,maxConcurrent:2},{prepare});
    const value=await scheduler.bind({...context(),assertExclusive:()=>{throw Error('other tool running')}}).capability.tools.call('cbim_agent_call',{agentId:'B',message:'work'},new AbortController().signal,'call');
    expect(result(value).error.code).toBe('AGENT_CALL_BUSY');expect(prepare).not.toHaveBeenCalled();
  });
  it('rejects model-supplied caller identity or permission fields',async()=>{
    const prepare=vi.fn(),scheduler=new AgentCallScheduler({maxDepth:2,maxConcurrent:2},{prepare});
    const value=await scheduler.bind(context()).capability.tools.call('cbim_agent_call',{agentId:'B',message:'work',permission:'execute'},new AbortController().signal,'call');
    expect(result(value).error.code).toBe('AGENT_CALL_INPUT');expect(prepare).not.toHaveBeenCalled();
  });
  it('propagates cancellation and waits for real completion before releasing resources',async()=>{
    let finish!:(value:RunSummary)=>void;const child=prepared('B',()=>new Promise(resolve=>{finish=resolve})),scheduler=new AgentCallScheduler({maxDepth:2,maxConcurrent:2},{prepare:async()=>child}),binding=scheduler.bind(context());
    const running=binding.capability.tools.call('cbim_agent_call',{agentId:'B',message:'work'},new AbortController().signal,'call');
    await vi.waitFor(()=>expect(finish).toBeTypeOf('function'));
    const stopping=binding.stop();await Promise.resolve();expect(child.stop).toHaveBeenCalled();expect(child.release).not.toHaveBeenCalled();
    finish({...summary('B'),status:'cancelled'});await stopping;expect(await running).toMatchObject({isError:true});expect(child.release).toHaveBeenCalledTimes(1);
  });
  it('does not release an unconfirmed process; close retries only the drain',async()=>{
    const child=prepared('B');child.close.mockRejectedValue(Error('not drained'));
    const prepare=vi.fn(async()=>child),scheduler=new AgentCallScheduler({maxDepth:2,maxConcurrent:2},{prepare}),binding=scheduler.bind(context());
    await expect(binding.capability.tools.call('cbim_agent_call',{agentId:'B',message:'work'},new AbortController().signal,'call')).rejects.toThrow('not drained');
    expect(child.release).not.toHaveBeenCalled();expect(binding.active()).toBe(true);
    child.close.mockResolvedValue();await scheduler.close();expect(child.release).toHaveBeenCalledTimes(1);expect(prepare).toHaveBeenCalledTimes(1);
  });
});
