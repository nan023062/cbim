import {it,expect,vi} from 'vitest';
import {AgentCallExchange} from '../src/logic/agents/exchange';
function jsonToolResult(_name:string,value:unknown){return {content:[{type:'text' as const,text:JSON.stringify(value)}]}}
const input={questions:[{question:'Choose',options:[{label:'A'},{label:'B'}]}]},answer={answers:[{question:'Choose',answer:'A'}]};
it('supports successive questions in the same call, refusing changed or stale answers',async()=>{
 const publish=vi.fn(async(phase,id)=>jsonToolResult('call',{phase,id})),exchange=new AgentCallExchange(publish),signal=new AbortController().signal;
 const first=exchange.ask(input,signal);await exchange.wait();
 const reply=exchange.reply('1',answer);expect(await first).toEqual(answer);
 const second=exchange.ask(input,signal);await reply;expect(exchange.waiting()).toBe(true);
 await expect(exchange.reply('1',{answers:[{question:'Choose',answer:'B'}]})).rejects.toMatchObject({code:'AGENT_REPLY_CONFLICT'});
 const last=exchange.reply('2',answer);expect(await second).toEqual(answer);
 const done=jsonToolResult('call',{status:'completed'});exchange.finish(done);expect(await last).toEqual(done);
 expect(publish.mock.calls.map(c=>c[0])).toEqual(['waiting','running','waiting','running']);
 expect(await exchange.reply('2',answer)).toEqual(done);
});
it('a failed durable answer publication does not consume the question or publish twice',async()=>{
 const publish=vi.fn(async(phase:string)=>{if(phase==='running')throw Error('disk failure');return jsonToolResult('call',{phase})});
 const exchange=new AgentCallExchange(publish),signal=new AbortController().signal,waiting=exchange.ask(input,signal);void waiting.catch(()=>{});
 await exchange.wait();await expect(exchange.reply('1',answer)).rejects.toThrow('disk failure');
 expect(exchange.waiting()).toBe(true);await expect(exchange.reply('1',answer)).rejects.toThrow('disk failure');
 expect(publish).toHaveBeenCalledTimes(2);exchange.fail(Error('closed'));await expect(waiting).rejects.toThrow('closed');
});
