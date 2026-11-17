import {it,expect,vi} from 'vitest';
import {AgentCallExchange} from '../../../../src/logic/agents/exchange';
function jsonToolResult(_name:string,value:unknown){return {content:[{type:'text' as const,text:JSON.stringify(value)}]}}
const input={questions:[{question:'Choose',options:[{label:'A'},{label:'B'}]}]},answer={answers:[{question:'Choose',answer:'A'}]};
it('supports successive questions in the same call, refusing changed or stale answers',async()=>{
 const publish=vi.fn(async(phase,id)=>jsonToolResult('call',{phase,id})),exchange=new AgentCallExchange(publish),signal=new AbortController().signal;
 const first=exchange.Ask(input,signal);await exchange.Wait();
 const reply=exchange.Reply('1',answer);expect(await first).toEqual(answer);
 const second=exchange.Ask(input,signal);await reply;expect(exchange.Waiting()).toBe(true);
 await expect(exchange.Reply('1',{answers:[{question:'Choose',answer:'B'}]})).rejects.toMatchObject({code:'AGENT_REPLY_CONFLICT'});
 const last=exchange.Reply('2',answer);expect(await second).toEqual(answer);
 const done=jsonToolResult('call',{status:'completed'});exchange.Finish(done);expect(await last).toEqual(done);
 expect(publish.mock.calls.map(c=>c[0])).toEqual(['waiting','running','waiting','running']);
 expect(await exchange.Reply('2',answer)).toEqual(done);
});
it('a failed durable answer publication does not consume the question or publish twice',async()=>{
 const publish=vi.fn(async(phase:string)=>{if(phase==='running')throw Error('disk failure');return jsonToolResult('call',{phase})});
 const exchange=new AgentCallExchange(publish),signal=new AbortController().signal,waiting=exchange.Ask(input,signal);void waiting.catch(()=>{});
 await exchange.Wait();await expect(exchange.Reply('1',answer)).rejects.toThrow('disk failure');
 expect(exchange.Waiting()).toBe(true);await expect(exchange.Reply('1',answer)).rejects.toThrow('disk failure');
 expect(publish).toHaveBeenCalledTimes(2);exchange.Fail(Error('closed'));await expect(waiting).rejects.toThrow('closed');
});

it('publication cannot mutate the frozen question or the answer consumed by the original child',async()=>{
 const publish=vi.fn(async(phase:string,_id:string,question?:typeof input,result?:Parameters<ConstructorParameters<typeof AgentCallExchange>[0]>[3])=>{
  if(question)question.questions[0].question='private changed question';
  if(result&&'answers' in result)result.answers[0].answer='private changed answer';
  return jsonToolResult('call',{phase});
 });
 const exchange=new AgentCallExchange(publish),waiting=exchange.Ask(input,new AbortController().signal);
 await exchange.Wait();const reply=exchange.Reply('1',answer);
 expect(await waiting).toEqual(answer);expect(input.questions[0].question).toBe('Choose');expect(answer.answers[0].answer).toBe('A');
 const done=jsonToolResult('call',{status:'completed'});exchange.Finish(done);expect(await reply).toEqual(done);
 expect(await exchange.Reply('1',answer)).toEqual(done);expect(publish).toHaveBeenCalledTimes(2);
});
it('cancellation during answer persistence never resumes the child or republishes the original answer',async()=>{
 let release!:()=>void,entered=false;
 const publish=vi.fn(async(phase:string)=>{if(phase==='running'){entered=true;await new Promise<void>(resolve=>{release=resolve})}return jsonToolResult('call',{phase})});
 const exchange=new AgentCallExchange(publish),controller=new AbortController(),waiting=exchange.Ask(input,controller.signal);
 await exchange.Wait();const reply=exchange.Reply('1',answer);void reply.catch(()=>{});
 await vi.waitFor(()=>expect(entered).toBe(true));controller.abort();await expect(waiting).rejects.toMatchObject({code:'AGENT_CALL_CANCELLED'});
 release();await expect(reply).rejects.toMatchObject({code:'AGENT_QUESTION_STALE'});
 await expect(exchange.Reply('1',answer)).rejects.toMatchObject({code:'AGENT_QUESTION_STALE'});expect(publish).toHaveBeenCalledTimes(2);
 exchange.Finish(jsonToolResult('call',{status:'cancelled'}));
});
it('a lost waiting publication receipt preserves no live question and does not invent a successful handoff',async()=>{
 const journal:unknown[]=[];
 const publish=vi.fn(async(phase:string,id:string,question?:typeof input)=>{journal.push(structuredClone({phase,id,question}));throw Error('saved but acknowledgement lost')});
 const exchange=new AgentCallExchange(publish);
 await expect(exchange.Ask(input,new AbortController().signal)).rejects.toThrow('acknowledgement lost');
 expect(journal).toHaveLength(1);expect(exchange.Waiting()).toBe(false);expect(exchange.yielded).toBe(false);
 await expect(exchange.Reply('1',answer)).rejects.toMatchObject({code:'AGENT_QUESTION_STALE'});
 exchange.Fail(Error('original run failed'));await expect(exchange.Wait()).rejects.toThrow('original run failed');expect(publish).toHaveBeenCalledTimes(1);
});
