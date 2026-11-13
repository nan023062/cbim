import {expect,it,vi} from 'vitest';
import http from 'node:http';
import {requestBudgetFixture,budgetTestModel} from './model-request-budget-fixture';
import {openRequestBudgetTransport,requestBudgetEndpoint} from '../src/logic/execution/engines/transport/request-budget-transport';
import type {RequestBudgetPort} from '../src/logic/budget/rules/request-budget';

async function upstream(reply:(res:http.ServerResponse,body:any,req:http.IncomingMessage)=>void|Promise<void>){let calls=0;const errors:unknown[]=[];const server=http.createServer(async(req,res)=>{try{let text='';for await(const part of req)text+=part;calls++;await reply(res,JSON.parse(text),req)}catch(e){errors.push(e);res.destroy()}});await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));return {url:'http://127.0.0.1:'+(server.address() as import('node:net').AddressInfo).port,get calls(){return calls},errors,close:async()=>{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))}}}
const good=(res:http.ServerResponse)=>{res.writeHead(200,{'content-type':'text/event-stream'});res.end('data: '+JSON.stringify({choices:[{index:0,delta:{content:'ok'},finish_reason:'stop'}],usage:{prompt_tokens:100,completion_tokens:20,total_tokens:120}})+'\n\ndata: [DONE]\n\n')};

it('预算代理保留输出上限原因，未完整响应仍保留未知并禁止自动重试',async()=>{
  const provider=await upstream(res=>{res.writeHead(200,{'content-type':'text/event-stream'});res.end('data: '+JSON.stringify({type:'response.incomplete',response:{incomplete_details:{reason:'max_output_tokens'},message:'private-provider-text'}})+'\n\n')});
  const llm=structuredClone(budgetTestModel);llm.profile.api='openai-responses';llm.profile.baseUrl=provider.url+'/v1';
  const f=await requestBudgetFixture({tokens:300000},llm);let gate:Awaited<ReturnType<typeof openRequestBudgetTransport>>|undefined;
  try{
    gate=await openRequestBudgetTransport(llm,f.port);await ready(gate);
    await send(gate,{model:'budget-model',stream:true,max_output_tokens:4096}).then(r=>r.text()).catch(()=>{});
    await expect(gate.assertSettled()).rejects.toThrow('max_output_tokens');
    expect(gate.error()).not.toContain('private-provider-text');
    expect(await f.service.report(f.query)).toMatchObject({unknown:1,reported:0});
    expect((await send(gate,{model:'budget-model',stream:true,max_output_tokens:4096})).status).toBe(409);
    expect(provider.calls).toBe(1);
  }finally{await gate?.close();await f.cleanup();await provider.close()}
});
async function ready(gate:Awaited<ReturnType<typeof openRequestBudgetTransport>>){expect((await fetch(gate.url+'/ready',{method:'POST',headers:{authorization:'Bearer '+gate.token}})).status).toBe(200);gate.assertReady()}
function send(gate:Awaited<ReturnType<typeof openRequestBudgetTransport>>,body:unknown={model:'budget-model',stream:true,max_tokens:4096},signal?:AbortSignal){return fetch(gate.url+'/request',{method:'POST',headers:{authorization:'Bearer '+gate.token,'content-type':'application/json','x-api-key':'child-key-must-not-forward'},body:JSON.stringify(body),signal})}

it('真实HTTP先预留再发送，终态先结算；余额不足到达供应商次数为零且凭据仅用父进程快照',async()=>{
  const provider=await upstream((res,_body,req)=>{expect(req.headers.authorization).toBe('Bearer parent-key');expect(req.headers['x-api-key']).toBeUndefined();good(res)});
  const llm=structuredClone(budgetTestModel);llm.profile.baseUrl=provider.url+'/v1';llm.profile.auth='api-key';llm.apiKey='parent-key';const f=await requestBudgetFixture({tokens:69632},llm);let gate:Awaited<ReturnType<typeof openRequestBudgetTransport>>|undefined;
  try{gate=await openRequestBudgetTransport(llm,f.port);await ready(gate);const response=await send(gate),text=await response.text();expect(text).toContain('[DONE]');expect(await f.service.report(f.query)).toMatchObject({reported:1,tokens:120,inFlight:0});
    expect((await send(gate)).status).toBe(409);expect(provider.calls).toBe(1);expect(await f.service.report(f.query)).toMatchObject({reported:1,denied:1,lastDenial:'token_reserve'});expect(provider.errors).toEqual([]);
  }finally{await gate?.close();await f.cleanup();await provider.close()}
});

it.each(['missing-usage','broken-stream','http-error','redirect','bad-usage'] as const)('已发送后 %s 保留未知并阻止换调用重试',async mode=>{
  const provider=await upstream(res=>{
    if(mode==='http-error'){res.writeHead(429);res.end('rate limit');return}if(mode==='redirect'){res.writeHead(302,{location:'/secret'});res.end();return}
    res.writeHead(200,{'content-type':'text/event-stream'});res.write('data: '+JSON.stringify({choices:[{index:0,delta:{content:'partial'},finish_reason:'stop'}],...(mode==='bad-usage'?{usage:{prompt_tokens:100,completion_tokens:20,total_tokens:0}}:{})})+'\n\n');if(mode==='broken-stream')res.end();else res.end('data: [DONE]\n\n');
  });const llm=structuredClone(budgetTestModel);llm.profile.baseUrl=provider.url+'/v1';const f=await requestBudgetFixture({tokens:200000},llm);let gate:Awaited<ReturnType<typeof openRequestBudgetTransport>>|undefined;
  try{gate=await openRequestBudgetTransport(llm,f.port);await ready(gate);await send(gate).then(r=>r.text()).catch(()=>{});await vi.waitFor(async()=>expect(await f.service.report(f.query)).toMatchObject({unknown:1,reservedTokens:69632,reported:0}),{timeout:3000});
    expect((await send(gate)).status).toBe(409);expect(provider.calls).toBe(1);expect(gate.error()).toBeTruthy();
  }finally{await gate?.close();await f.cleanup();await provider.close()}
});

it('发送意图保存后取消但尚未fetch可以明确未发送；真实发出后取消不能释放预留',async()=>{
  const provider=await upstream(res=>{res.writeHead(200,{'content-type':'text/event-stream'});res.write(': waiting\n\n')});const llm=structuredClone(budgetTestModel);llm.profile.baseUrl=provider.url+'/v1';const f=await requestBudgetFixture({tokens:300000},llm);let gate:Awaited<ReturnType<typeof openRequestBudgetTransport>>|undefined;
  try{
    const controller=new AbortController(),port:RequestBudgetPort={model:f.port.model,reserve:async input=>{const ticket=await f.port.reserve(input);return {...ticket,issue:async()=>{await ticket.issue();controller.abort();await new Promise(r=>setTimeout(r,20))}}}};
    gate=await openRequestBudgetTransport(llm,port);await ready(gate);await send(gate,undefined,controller.signal).catch(()=>{});await gate.close();expect(provider.calls).toBe(0);expect(await f.service.report(f.query)).toMatchObject({notSent:1,reservedTokens:0});
    gate=await openRequestBudgetTransport(llm,f.port);await ready(gate);const second=new AbortController(),pending=send(gate,undefined,second.signal).then(r=>r.text()).catch(()=>{});
    await vi.waitFor(()=>expect(provider.calls).toBe(1));second.abort();await pending;await gate.close();expect(await f.service.report(f.query)).toMatchObject({notSent:1,unknown:1,reservedTokens:69632});
  }finally{await gate?.close();await f.cleanup();await provider.close()}
});

it('结算保存失败不交付终态；越界路径、模型和无上限请求不向供应商转发',async()=>{
  const provider=await upstream(good),llm=structuredClone(budgetTestModel);llm.profile.baseUrl=provider.url+'/v1';const f=await requestBudgetFixture({tokens:300000},llm);let gate:Awaited<ReturnType<typeof openRequestBudgetTransport>>|undefined;
  try{
    const port:RequestBudgetPort={model:f.port.model,reserve:async input=>{const ticket=await f.port.reserve(input);return {...ticket,report:async()=>{throw Error('fixture settlement failure')}}}};
    gate=await openRequestBudgetTransport(llm,port);await ready(gate);const text=await send(gate).then(r=>r.text()).catch(()=>'<aborted>');expect(text).not.toContain('[DONE]');expect(provider.calls).toBe(1);expect(await f.service.report(f.query)).toMatchObject({unknown:1,reported:0});await gate.close();
    for(const body of [{model:'other',stream:true,max_tokens:4096},{model:'budget-model',stream:true},{model:'budget-model',stream:true,max_tokens:9999}]){
      gate=await openRequestBudgetTransport(llm,f.port);await ready(gate);expect((await fetch(gate.url+'/external',{method:'POST',headers:{authorization:'Bearer '+gate.token}})).status).toBe(404);expect((await send(gate,body)).status).toBe(409);await gate.close();
    }expect(provider.calls).toBe(1);
  }finally{await gate?.close();await f.cleanup();await provider.close()}
});

it('固定三协议目标保留原base路径，Anthropic只允许固定beta参数',()=>{
  const llm=structuredClone(budgetTestModel);expect(requestBudgetEndpoint(llm)).toBe('http://127.0.0.1:1/v1/chat/completions');llm.profile.api='openai-responses';expect(requestBudgetEndpoint(llm)).toBe('http://127.0.0.1:1/v1/responses');llm.profile.api='anthropic-messages';llm.profile.baseUrl='http://127.0.0.1:1';expect(requestBudgetEndpoint(llm)).toBe('http://127.0.0.1:1/v1/messages?beta=true');
});
