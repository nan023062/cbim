import {describe,it,expect,vi} from 'vitest';
import {AgentCallScheduler} from '../../../../../src/logic/execution/assembly/agent-call-scheduler';
import type {AgentSchedulerPorts} from '../../../../../src/logic/execution/assembly/agent-call-scheduler';
import type {AgentToolContext} from '../../../../../src/logic/agents/contracts';
import type {RunSummary,TaskSpec,EngineEvent} from '../../../../../src/logic/execution/rules/types';

const task=(id='root'):TaskSpec=>({taskId:id,workspaceId:'workspace',root:'/project',mode:'chat',agentId:'cbim:main',goal:'work',moduleIds:[],acceptance:[]});
const summary=(id:string):RunSummary=>({task:task(id),runId:id+'-run',status:'completed',acceptance:'not_evaluated',events:[],unresolvedTools:[]});
function context(id='root',events:EngineEvent[]=[]):AgentToolContext{return {task:task(id),runId:id+'-run',AssertExclusive:()=>{},Emit:async event=>{events.push(event)}}}
function result(value:any){return JSON.parse(value.content[0].text)}
function prepared(id:string,body:()=>Promise<RunSummary>=async()=>summary(id)){
  const agent={definition:{id,name:id,instructions:'role',permission:'read' as const},conversation:{workspaceId:'workspace',taskId:id}};
  const release=vi.fn(),stop=vi.fn(async()=>{}),close=vi.fn(async()=>{});
  const runtime:Exclude<Awaited<ReturnType<AgentSchedulerPorts['Prepare']>>, { rejection: unknown }>['runtime']={Start:async(t,_message,_resume,_source,control)=>{
    const abort=()=>{void stop()};control?.signal.addEventListener('abort',abort,{once:true});
    await control?.BeforeRun?.({task:t,runId:id+'-run'});
    return {runId:id+'-run',done:body().finally(()=>control?.signal.removeEventListener('abort',abort))};
  },Close: close};
  return {agent,task:task(id),runtime,Release: release,stop,close};
}
describe('AgentCallScheduler',()=>{
  it('routes A to B to C using the same tool and preserves direct caller identities',async()=>{
    const events:EngineEvent[]=[],releases:ReturnType<typeof vi.fn>[]=[];
    let scheduler:AgentCallScheduler;
    const prepare:AgentSchedulerPorts['Prepare']=async input=>{
      const child=prepared(input.agentId,async()=>{
        if(input.agentId==='B'){
          const tools=scheduler.Bind(context('B',events),input.parent.depth+1);
          const value=await tools.capability.tools.call('cbim_agent_call',{agentId:'C',message:'nested'},input.signal,'call-C');
          expect(result(value).agentCall.callerTaskId).toBe('B');
        }
        return summary(input.agentId);
      });releases.push(child.Release);return child;
    };
    scheduler=new AgentCallScheduler({maxDepth:2},{Prepare: prepare});
    const root=scheduler.Bind(context('A',events));
    const value=await root.capability.tools.call('cbim_agent_call',{agentId:'B',message:'work'},new AbortController().signal,'call-B');
    expect(result(value).agentCall).toMatchObject({callerTaskId:'A',taskId:'B',toolCallId:'call-B'});
    expect(events.map(e=>(e.data.agentCall as any).taskId)).toEqual(['B','C']);
    expect(releases.every(release=>release.mock.calls.length===1)).toBe(true);
  });
  it('returns a depth error before prepare or persistent events',async()=>{
    const prepare=vi.fn(),events:EngineEvent[]=[];const scheduler=new AgentCallScheduler({maxDepth:0},{Prepare: prepare});
    const value=await scheduler.Bind(context('root',events)).capability.tools.call('cbim_agent_call',{agentId:'B',message:'work'},new AbortController().signal,'call');
    expect(value).toMatchObject({isError:true});expect(result(value).error).toMatchObject({code:'AGENT_DEPTH_LIMIT',current:0,limit:0,started:false});expect(prepare).not.toHaveBeenCalled();expect(events).toEqual([]);
  });
  it('returns the execution admission error without keeping a second capacity counter',async()=>{
    const prepare=vi.fn(async()=>{throw Object.assign(Error('global capacity'),{code:'AGENT_CONCURRENCY_LIMIT'})});
    const scheduler=new AgentCallScheduler({maxDepth:2},{Prepare: prepare});
    const value=await scheduler.Bind(context()).capability.tools.call('cbim_agent_call',{agentId:'B',message:'work'},new AbortController().signal,'one');
    expect(result(value).error).toMatchObject({code:'AGENT_CONCURRENCY_LIMIT',started:false});
    expect(prepare).toHaveBeenCalledTimes(1);
  });
  it('deduplicates a tool invocation and rejects changed input under the same identity',async()=>{
    const child=prepared('B'),prepare=vi.fn(async()=>child),scheduler=new AgentCallScheduler({maxDepth:2},{Prepare: prepare}),tools=scheduler.Bind(context()).capability.tools,signal=new AbortController().signal;
    const a=await tools.call('cbim_agent_call',{agentId:'B',message:'same'},signal,'one');
    expect(await tools.call('cbim_agent_call',{agentId:'B',message:'same'},signal,'one')).toEqual(a);
    expect(result(await tools.call('cbim_agent_call',{agentId:'B',message:'different'},signal,'one')).error.code).toBe('AGENT_CALL_CONFLICT');expect(prepare).toHaveBeenCalledTimes(1);
  });
  it('refuses a non-exclusive caller batch before creating a child',async()=>{
    const prepare=vi.fn(),scheduler=new AgentCallScheduler({maxDepth:2},{Prepare: prepare});
    const value=await scheduler.Bind({...context(),AssertExclusive:()=>{throw Error('other tool running')}}).capability.tools.call('cbim_agent_call',{agentId:'B',message:'work'},new AbortController().signal,'call');
    expect(result(value).error.code).toBe('AGENT_CALL_BUSY');expect(prepare).not.toHaveBeenCalled();
  });
  it('rejects model-supplied caller identity or permission fields',async()=>{
    const prepare=vi.fn(),scheduler=new AgentCallScheduler({maxDepth:2},{Prepare: prepare});
    const value=await scheduler.Bind(context()).capability.tools.call('cbim_agent_call',{agentId:'B',message:'work',permission:'execute'},new AbortController().signal,'call');
    expect(result(value).error.code).toBe('AGENT_CALL_INPUT');expect(prepare).not.toHaveBeenCalled();
  });
  it('propagates cancellation and waits for real completion before releasing resources',async()=>{
    let finish!:(value:RunSummary)=>void;const child=prepared('B',()=>new Promise(resolve=>{finish=resolve})),scheduler=new AgentCallScheduler({maxDepth:2},{Prepare:async()=>child}),binding=scheduler.Bind(context());
    const running=binding.capability.tools.call('cbim_agent_call',{agentId:'B',message:'work'},new AbortController().signal,'call');
    await vi.waitFor(()=>expect(finish).toBeTypeOf('function'));
    const stopping=binding.Stop();await Promise.resolve();expect(child.stop).toHaveBeenCalled();expect(child.Release).not.toHaveBeenCalled();
    finish({...summary('B'),status:'cancelled'});await stopping;expect(await running).toMatchObject({isError:true});expect(child.Release).toHaveBeenCalledTimes(1);
  });
  it('does not release an unconfirmed process; close retries only the drain',async()=>{
    const child=prepared('B');child.close.mockRejectedValue(Error('not drained'));
    const prepare=vi.fn(async()=>child),scheduler=new AgentCallScheduler({maxDepth:2},{Prepare: prepare}),binding=scheduler.Bind(context());
    await expect(binding.capability.tools.call('cbim_agent_call',{agentId:'B',message:'work'},new AbortController().signal,'call')).rejects.toThrow('not drained');
    expect(child.Release).not.toHaveBeenCalled();expect(binding.Active()).toBe(true);
    child.close.mockResolvedValue();await scheduler.Close();expect(child.Release).toHaveBeenCalledTimes(1);expect(prepare).toHaveBeenCalledTimes(1);
  });
});
it('pauses inside one child run, routes answers only from its caller and deduplicates repeated replies',async()=>{
 const events:EngineEvent[]=[],answers:unknown[]=[];let child:ReturnType<typeof prepared>;
 const prepare=vi.fn(async(input:Parameters<AgentSchedulerPorts['Prepare']>[0])=>{
   child=prepared('B',async()=>{answers.push(await input.RequestQuestion({questions:[{question:'Which branch?',options:[{label:'A'},{label:'B'}]}]},input.signal));return summary('B')});return child;
 });
 const scheduler=new AgentCallScheduler({maxDepth:3},{Prepare: prepare}),binding=scheduler.Bind(context('A',events)),tools=binding.capability.tools,signal=new AbortController().signal;
 const waiting=result(await tools.call('cbim_agent_call',{agentId:'B',message:'work'},signal,'original'));
 expect(waiting).toMatchObject({status:'waiting',callId:'original',questionId:'1',agentCall:{taskId:'B',runId:'B-run'}});
 expect(binding.Active()).toBe(true);expect(child!.Release).not.toHaveBeenCalled();
 expect(binding.AllowsWhileWaiting?.('write')).toBe(false);expect(binding.AllowsWhileWaiting?.('cbim_ask_user_question')).toBe(true);
 const reply={callId:'original',questionId:'1',result:{answers:[{question:'Which branch?',answer:'A'}]}};
 expect(result(await scheduler.Bind(context('foreign')).capability.tools.call('cbim_agent_reply',reply,signal,'reply')).error.code).toBe('AGENT_CALL_IDENTITY');
 const bad=await tools.call('cbim_agent_reply',{...reply,result:{answers:[{question:'Other?',answer:'A'}]}},signal,'wrong');expect(bad).toMatchObject({isError:true});expect(answers).toEqual([]);
 const done=await tools.call('cbim_agent_reply',reply,signal,'reply');
 expect(result(done)).toMatchObject({status:'completed',agentCall:{taskId:'B',runId:'B-run',toolCallId:'original'}});
 expect(await tools.call('cbim_agent_reply',reply,signal,'repeat')).toEqual(done);expect(prepare).toHaveBeenCalledTimes(1);expect(answers).toHaveLength(1);
 expect(result(await tools.call('cbim_agent_reply',{...reply,result:{answers:[{question:'Which branch?',answer:'B'}]}},signal,'conflict')).error.code).toBe('AGENT_REPLY_CONFLICT');
 expect(events.filter(e=>e.data.agentCallState).map(e=>e.data.agentCallState)).toEqual(['waiting','running','completed']);
 expect(child!.Release).toHaveBeenCalledTimes(1);
});
it('stopping a question aborts the original wait and rejects late replies without restarting the child',async()=>{
 let child:ReturnType<typeof prepared>;
 const prepare=vi.fn(async(input:Parameters<AgentSchedulerPorts['Prepare']>[0])=>{
   child=prepared('B',async()=>{await input.RequestQuestion({questions:[{question:'Continue?',options:[{label:'Yes'},{label:'No'}]}]},new AbortController().signal);return summary('B')});return child;
 });
 const scheduler=new AgentCallScheduler({maxDepth:2},{Prepare: prepare}),binding=scheduler.Bind(context()),signal=new AbortController().signal;
 const waiting=result(await binding.capability.tools.call('cbim_agent_call',{agentId:'B',message:'work'},signal,'call'));expect(waiting.status).toBe('waiting');
 await binding.Stop();
 const late=await binding.capability.tools.call('cbim_agent_reply',{callId:'call',questionId:'1',result:{answers:[{question:'Continue?',answer:'Yes'}]}},signal,'late');
 expect(late).toMatchObject({isError:true});expect(prepare).toHaveBeenCalledTimes(1);expect(child!.Release).toHaveBeenCalledTimes(1);expect(binding.Active()).toBe(false);
});

it('starts a frozen business run once and rechecks only the original caller result',async()=>{
 const child=prepared('B'),startMember=vi.fn(async(task,message,launch,control)=>child.runtime.Start(task,message,undefined,undefined,control));
 let stale=false;const verify=vi.fn(async()=>{if(stale)throw Object.assign(Error('changed bytes'),{code:'WORKFLOW_VALIDATION_STALE'});return {state:'verified'}});
 const launch={binding:{} as any,session:{nativeSessionId:'session'}};
 const prepare=vi.fn(async()=>({...child,runtime:{...child.runtime,StartMember: startMember},launch,Verify: verify}));
 const scheduler=new AgentCallScheduler({maxDepth:2},{Prepare: prepare}),tools=scheduler.Bind(context()).capability.tools,signal=new AbortController().signal;
 const value=await tools.call('cbim_agent_call',{agentId:'B',message:'work',business:{moduleIds:['module'],acceptance:['actual bytes']}},signal,'original');
 expect(result(value)).toMatchObject({status:'completed',verification:{state:'verified'}});
 expect(startMember).toHaveBeenCalledTimes(1);expect(prepare.mock.calls).toHaveLength(1);expect(child.Release).toHaveBeenCalledTimes(1);
 expect(result(await tools.call('cbim_agent_result_check',{callId:'original'},signal,'check'))).toEqual({state:'verified'});
 expect(result(await scheduler.Bind(context('other')).capability.tools.call('cbim_agent_result_check',{callId:'original'},signal,'check')).error.code).toBe('AGENT_RESULT_UNAVAILABLE');
 stale=true;
 expect(result(await tools.call('cbim_agent_result_check',{callId:'original'},signal,'stale')).error.code).toBe('WORKFLOW_VALIDATION_STALE');
 expect(startMember).toHaveBeenCalledTimes(1);expect(prepare).toHaveBeenCalledTimes(1);
 await scheduler.Close();
 expect(await tools.call('cbim_agent_result_check',{callId:'original'},signal,'closed')).toMatchObject({isError:true});
});
it('returns a business verification failure instead of completed when model execution ends',async()=>{
 const child=prepared('B'),verify=vi.fn(async()=>{throw Object.assign(Error('no valid proof'),{code:'WORKFLOW_EVIDENCE_INVALID'})});
 const scheduler=new AgentCallScheduler({maxDepth:1},{Prepare:async()=>({...child,Verify: verify})});
 const value=await scheduler.Bind(context()).capability.tools.call('cbim_agent_call',{agentId:'B',message:'work'},new AbortController().signal,'call');
 expect(value).toMatchObject({isError:true});expect(result(value)).toMatchObject({error:{code:'WORKFLOW_EVIDENCE_INVALID',started:true}});
 expect(result(value)).not.toHaveProperty('status','completed');expect(child.Release).toHaveBeenCalledTimes(1);
});

async function reviewFixture(requestReview:NonNullable<AgentSchedulerPorts['RequestReview']>){
 const events:EngineEvent[]=[],child=prepared('B');let stale=false;
 const verify=vi.fn(async()=>{if(stale)throw Object.assign(Error('changed'),{code:'WORKFLOW_VALIDATION_STALE'});return {state:'verified',taskId:'B',runId:'B-run',files:[{relativePath:'out.json',sha256:'original'}]}});
 const prepare=vi.fn(async()=>({...child,Verify: verify}));
 const scheduler=new AgentCallScheduler({maxDepth:2},{Prepare: prepare,RequestReview: requestReview}),tools=scheduler.Bind(context('root',events)).capability.tools;
 const signal=new AbortController().signal;
 const original=await tools.call('cbim_agent_call',{agentId:'B',message:'work'},signal,'original');
 return {scheduler,tools,events,prepare,verify,original,stale:()=>{stale=true}};
}
it('records negative human feedback before a separate continuation and blocks automatic child reexecution',async()=>{
 let continueReview!:(value:unknown)=>void;
 const request=vi.fn(async(input:any)=>request.mock.calls.length===1?{answers:[{question:input.questions[0].question,answer:'不接受此成果',supplement:'keep original evidence'}]}:new Promise(resolve=>{continueReview=value=>resolve({answers:[{question:input.questions[0].question,answer:value}]})}));
 const f=await reviewFixture(request);f.stale();const signal=new AbortController().signal;
 const pending=f.tools.call('cbim_agent_result_review',{callId:'original'},signal,'review');
 await vi.waitFor(()=>expect(request).toHaveBeenCalledTimes(2));
 expect(f.events.find(e=>e.data.humanDecision)?.data.humanDecision).toMatchObject({decision:'reject',allowedDecisions:['reject','request_evidence'],original:{files:[{sha256:'original'}]},current:{code:'WORKFLOW_VALIDATION_STALE'}});
 expect(f.prepare).toHaveBeenCalledTimes(1);
 continueReview('继续处理意见');const receipt=await pending;
 expect(result(receipt)).toMatchObject({continued:true,executionAuthorized:false,record:{decision:'reject'}});
 expect(await f.tools.call('cbim_agent_result_review',{callId:'original'},signal,'review')).toEqual(receipt);
 expect(result(await f.tools.call('cbim_agent_call',{agentId:'B',message:'rework'},signal,'new')).error.code).toBe('AGENT_HUMAN_DECISION_REQUIRED');
 expect(await f.tools.call('cbim_agent_call',{agentId:'B',message:'work'},signal,'original')).toEqual(f.original);
 expect(f.prepare).toHaveBeenCalledTimes(1);expect(request).toHaveBeenCalledTimes(2);
 const guard=f.scheduler.Bind(context()).GuardEffects!;
 expect(guard(['read','preview'])).toBeUndefined();
 for(const effects of [undefined,[],['write'],['read','command'],['external']])expect(guard(effects)).toContain('AGENT_HUMAN_DECISION_REQUIRED');
 expect(f.scheduler.Bind(context('other')).GuardEffects?.(['write'])).toBeUndefined();
});
it('rechecks bytes after an accept choice and never stores acceptance for a changed candidate',async()=>{
 let f:Awaited<ReturnType<typeof reviewFixture>>;
 const request=vi.fn(async(input:any)=>{f.stale();return {answers:[{question:input.questions[0].question,answer:'接受此成果'}]}});
 f=await reviewFixture(request);
 const value=await f.tools.call('cbim_agent_result_review',{callId:'original'},new AbortController().signal,'review');
 expect(result(value)).toMatchObject({error:{code:'WORKFLOW_VALIDATION_STALE'}});
 expect(f.events.some(e=>e.data.humanDecision)).toBe(false);expect(request).toHaveBeenCalledTimes(1);expect(f.prepare).toHaveBeenCalledTimes(1);
});
it('stopping after a saved decision keeps its audit fact and never repeats the question or child run',async()=>{
 const request=vi.fn(async(input:any,signal:AbortSignal)=>{
   if(request.mock.calls.length===1)return {answers:[{question:input.questions[0].question,answer:'要求补充证据'}]};
   return new Promise(resolve=>signal.addEventListener('abort',()=>resolve({cancelled:true}),{once:true}));
 });
 const f=await reviewFixture(request),controller=new AbortController();
 const pending=f.tools.call('cbim_agent_result_review',{callId:'original'},controller.signal,'review');
 await vi.waitFor(()=>expect(request).toHaveBeenCalledTimes(2));await f.scheduler.Close();
 const receipt=await pending;expect(receipt).toMatchObject({isError:true});
 expect(f.events.filter(e=>e.data.humanDecision)).toHaveLength(1);
 expect(await f.tools.call('cbim_agent_result_review',{callId:'original'},new AbortController().signal,'review')).toEqual(receipt);
 expect(f.prepare).toHaveBeenCalledTimes(1);expect(request).toHaveBeenCalledTimes(2);
});
it('does not expose direct user reviews to child Agents or permit foreign candidate identities',async()=>{
 const request=vi.fn(),f=await reviewFixture(request),signal=new AbortController().signal;
 const child=f.scheduler.Bind(context('child'),1).capability.tools;
 expect((await child.list()).some(tool=>tool.name==='cbim_agent_result_review')).toBe(false);
 expect(result(await child.call('cbim_agent_result_review',{callId:'original'},signal,'review')).error.code).toBe('AGENT_REVIEW_UNAVAILABLE');
 expect(result(await f.tools.call('cbim_agent_result_review',{callId:'foreign'},signal,'review')).error.code).toBe('AGENT_REVIEW_UNAVAILABLE');
 expect(request).not.toHaveBeenCalled();
});

it('does not turn a typed accept into approval when only negative decisions are available',async()=>{
 const request=vi.fn(async(input:any)=>({answers:[{question:input.questions[0].question,answer:'接受此成果'}]}));
 const f=await reviewFixture(request);f.stale();
 expect(result(await f.tools.call('cbim_agent_result_review',{callId:'original'},new AbortController().signal,'review')).error.code).toBe('AGENT_REVIEW_INPUT');
 expect(f.events.some(e=>e.data.humanDecision)).toBe(false);expect(request).toHaveBeenCalledTimes(1);
});

it('rechecks saved acceptance before continuation without rewriting the decision or replaying execution',async()=>{
 let f:Awaited<ReturnType<typeof reviewFixture>>;
 const request=vi.fn(async(input:any)=>{
   if(request.mock.calls.length===1)return {answers:[{question:input.questions[0].question,answer:'接受此成果'}]};
   f.stale();return {answers:[{question:input.questions[0].question,answer:'继续处理意见'}]};
 });
 f=await reviewFixture(request);const signal=new AbortController().signal;
 const receipt=await f.tools.call('cbim_agent_result_review',{callId:'original'},signal,'review');
 expect(result(receipt)).toMatchObject({error:{code:'WORKFLOW_VALIDATION_STALE'}});
 const decisions=f.events.filter(e=>e.data.humanDecision);expect(decisions).toHaveLength(1);
 expect(decisions[0].data.humanDecision).toMatchObject({decision:'accept',original:{files:[{sha256:'original'}]}});
 expect(f.events.find(e=>e.data.phase==='decision_released')?.data).toMatchObject({continued:false,reason:'verification_failed'});
 expect(result(await f.tools.call('cbim_agent_call',{agentId:'B',message:'rework'},signal,'new')).error.code).toBe('AGENT_HUMAN_DECISION_REQUIRED');
 expect(await f.tools.call('cbim_agent_result_review',{callId:'original'},signal,'review')).toEqual(receipt);
 expect(f.events.filter(e=>e.data.humanDecision)).toEqual(decisions);expect(request).toHaveBeenCalledTimes(2);expect(f.prepare).toHaveBeenCalledTimes(1);
});

it('awaits durable release after runtime close and retries only settlement when persistence is unknown',async()=>{
 const body=vi.fn(async()=>summary('B'));const owned=prepared('B',body);
 const release=vi.fn(async():Promise<void>=>{throw Error('fsync unknown')});
 const prepare=vi.fn(async()=>({...owned,Release: release})),scheduler=new AgentCallScheduler({maxDepth:2},{Prepare: prepare}),binding=scheduler.Bind(context());
 await expect(binding.capability.tools.call('cbim_agent_call',{agentId:'B',message:'work'},new AbortController().signal,'call')).rejects.toThrow('fsync unknown');
 expect(owned.close).toHaveBeenCalledTimes(1);expect(binding.Active()).toBe(true);expect(body).toHaveBeenCalledTimes(1);
 release.mockImplementation(async()=>{});await scheduler.Close();expect(release).toHaveBeenCalledTimes(2);expect(body).toHaveBeenCalledTimes(1);expect(prepare).toHaveBeenCalledTimes(1);
});
it('does not start the child body when durable registration fails after publishing its reference',async()=>{
 const body=vi.fn(async()=>summary('B')),child=prepared('B',body),events:EngineEvent[]=[];
 const beforeRun=vi.fn(async()=>{throw Object.assign(Error('registration failed'),{code:'AGENT_RUN_AUDIT'})});
 const scheduler=new AgentCallScheduler({maxDepth:2},{Prepare:async()=>({...child,BeforeRun: beforeRun})});
 const value=await scheduler.Bind(context('root',events)).capability.tools.call('cbim_agent_call',{agentId:'B',message:'work'},new AbortController().signal,'call');
 expect(result(value).error).toMatchObject({code:'AGENT_RUN_AUDIT',started:true});expect(body).not.toHaveBeenCalled();expect(events[0].data.agentCall).toMatchObject({runId:'B-run'});expect(child.close).toHaveBeenCalledTimes(1);expect(child.Release).toHaveBeenCalledTimes(1);
});

it('同名岗位技能和工作区 Workflow 按来源独立读取', async () => {
  const scheduler = new AgentCallScheduler({ maxDepth: 1 }, { Prepare: async () => prepared('child') });
  const agent = prepared('worker').agent;
  const skill = { skillId: 'review', content: 'role instructions' };
  const workflow = { workspaceId: 'design', skillId: 'review', content: 'workspace instructions' };
  const binding = scheduler.Bind(context(), 0, { ...agent, definition: { ...agent.definition, effectiveSkills: [{ ...skill, ownerId: 'worker', inherited: false }] } }, [workflow]);
  const read = (args: Record<string, unknown>) => binding.capability.tools.call('cbim_agent_skill_read', args, new AbortController().signal);
  expect(result(await read({ skillId: 'review' })).skill.content).toBe(skill.content);
  expect(result(await read({ skillId: 'review', workspaceId: 'design' })).workflow).toEqual(workflow);
  await expect(read({ skillId: 'review', workspaceId: 'other' })).rejects.toThrow();
});
