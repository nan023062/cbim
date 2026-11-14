import {test,expect,vi,afterEach} from 'vitest';
import {ModelJsonRequests} from '../src/logic/execution/engines/transport/model-json-requests';
import {requestBudgetModelFor} from '../src/logic/budget/rules/model-request-configuration';
import type {ResolvedEngineModel} from '../src/logic/engines';
import type {RequestBudgetTicket} from '../src/logic/budget/rules/request-budget';
const vector={kind:'embedding' as const,id:'22222222-2222-4222-8222-222222222222',name:'Vector',api:'openai-embeddings' as const,baseUrl:'https://vector.example/v1',auth:'api-key' as const,model:'vector',inputTokens:8192,dimensions:2};
const llm:ResolvedEngineModel={profile:{id:'11111111-1111-4111-8111-111111111111',name:'Chat',api:'openai-completions',baseUrl:'https://chat.example/v1',auth:'api-key',model:'chat',contextWindow:8192,maxTokens:1024,reasoning:false,modelRoles:{version:2,roles:{embedding:{kind:'embedding',profile:vector}}}},apiKey:'chat-key',modelRoles:{embedding:{profile:vector,apiKey:'vector-key'}}};
const reply=(usage:unknown)=>new Response(JSON.stringify({data:[{index:0,embedding:[1,0]}],usage}),{headers:{'content-type':'application/json'}});
afterEach(()=>vi.unstubAllGlobals());
function harness(override:Partial<RequestBudgetTicket>={}){
  const entries:unknown[]=[],controller=new AbortController();
  const ticket:RequestBudgetTicket={requestId:'request',issue:async()=>{entries.push('issue')},assertSend:()=>{entries.push('send')},report:async usage=>{entries.push(usage)},unknown:async reason=>{entries.push(['unknown',reason])},notSent:async reason=>{entries.push(['not_sent',reason])},...override};
  const api=new ModelJsonRequests(llm,async role=>({model:requestBudgetModelFor(llm.profile,role),reserve:async request=>{entries.push([role,request.maxOutputTokens]);return ticket}}),controller.signal);
  return {api,entries,controller};
}
test('生成/向量使用独立连接与预留，可靠用量先于结果交付',async()=>{
  const {api,entries}=harness(),fetch=vi.fn().mockResolvedValueOnce(reply({prompt_tokens:4,completion_tokens:2,total_tokens:6})).mockResolvedValueOnce(reply({prompt_tokens:3,total_tokens:3}));vi.stubGlobal('fetch',fetch);
  await api.chat([{role:'user',content:'hi'}]);await api.embed(['source']);
  expect(entries).toEqual([['primary',1024],'issue','send',{input:4,output:2,cacheRead:0,cacheWrite:0,totalTokens:6},['embedding',0],'issue','send',{input:3,output:0,cacheRead:0,cacheWrite:0,totalTokens:3}]);
  expect(fetch.mock.calls.map(c=>c[0])).toEqual(['https://chat.example/v1/chat/completions','https://vector.example/v1/embeddings']);
  expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({input:['source'],encoding_format:'float',model:'vector'});
  expect(fetch.mock.calls[1][1].headers.authorization).toBe('Bearer vector-key');
});
test('用量未知阻断两个角色，不用下一次调用掩盖失败',async()=>{
  const {api,entries}=harness(),fetch=vi.fn().mockResolvedValue(reply({prompt_tokens:4}));vi.stubGlobal('fetch',fetch);
  await expect(api.embed(['source'])).rejects.toThrow('无法确认');await expect(api.chat([])).rejects.toThrow('已停止');
  expect(fetch).toHaveBeenCalledTimes(1);expect(entries.at(-1)).toEqual(['unknown','incomplete_usage']);
});
test('发送前取消释放原预留，未调用供应商',async()=>{
  const h=harness({issue:async()=>h.controller.abort()}),fetch=vi.fn();vi.stubGlobal('fetch',fetch);
  await expect(h.api.embed(['source'])).rejects.toThrow();expect(fetch).not.toHaveBeenCalled();expect(h.entries.at(-1)).toEqual(['not_sent','cancelled_before_send']);
});
test('结算失败不交付正文；超限保存实际用量但不再继续',async()=>{
  const fetch=vi.fn().mockImplementation(async()=>reply({prompt_tokens:9000,total_tokens:9000}));vi.stubGlobal('fetch',fetch);
  const first=harness();await expect(first.api.embed(['source'])).rejects.toThrow('超过原预留');expect(first.entries.at(-1)).toMatchObject({input:9000});
  const second=harness({report:async()=>{throw Error('disk failure')}});await expect(second.api.embed(['source'])).rejects.toThrow('无法确认');expect(second.entries.at(-1)).toEqual(['unknown','incomplete_usage']);
});
test('预算角色或连接快照不一致时拒绝发网',async()=>{
  const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
  const api=new ModelJsonRequests(llm,async()=>({model:requestBudgetModelFor(llm.profile),reserve:vi.fn()}),new AbortController().signal);
  await expect(api.embed(['source'])).rejects.toThrow('预算快照');expect(fetch).not.toHaveBeenCalled();
});
