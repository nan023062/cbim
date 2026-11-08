import {expect,it} from 'vitest';
import {RequestBudgetUsageStream} from '../src/backend/core/brain/pi/request-budget-usage';
const frame=(value:unknown,event?:string)=>(event?'event: '+event+'\n':'')+'data: '+(typeof value==='string'?value:JSON.stringify(value))+'\n\n';
const completion=(usage:unknown)=>frame({choices:[{index:0,delta:{},finish_reason:'stop'}],usage});
const parse=(api:ConstructorParameters<typeof RequestBudgetUsageStream>[0],text:string)=>{const parser=new RequestBudgetUsageStream(api);const forward=parser.push(Buffer.from(text));return {...parser.finish(),forward}};

it('completions缓存和推理只计一次，终态在结算前被扣留，UTF8跨块完整',()=>{
  const parser=new RequestBudgetUsageStream('openai-completions'),body=Buffer.from(frame({choices:[{index:0,delta:{content:'中文'},finish_reason:null}]})+completion({prompt_tokens:100,completion_tokens:30,total_tokens:130,prompt_tokens_details:{cached_tokens:20,cache_write_tokens:10},completion_tokens_details:{reasoning_tokens:25}})+frame('[DONE]'));
  let output='';for(const byte of body)output+=parser.push(new Uint8Array([byte])).join('');expect(output).toContain('中文');expect(output).not.toContain('[DONE]');expect(parser.finish()).toMatchObject({usage:{input:70,output:30,cacheRead:20,cacheWrite:10,totalTokens:130},terminal:frame('[DONE]')});
});
it('responses及Anthropic按完整协议终态核实usage，缺省缓存为协议零且终态不提前交付',()=>{
  const response=parse('openai-responses',frame({type:'response.completed',response:{status:'completed',usage:{input_tokens:100,output_tokens:20,total_tokens:120,input_tokens_details:{cached_tokens:40},output_tokens_details:{reasoning_tokens:10}}}}));expect(response.usage).toEqual({input:60,output:20,cacheRead:40,cacheWrite:0,totalTokens:120});expect(response.forward).toEqual([]);
  const anthropic=parse('anthropic-messages',frame({type:'message_start',message:{usage:{input_tokens:10,output_tokens:0,cache_read_input_tokens:20,cache_creation_input_tokens:30}}},'message_start')+frame({type:'message_delta',delta:{stop_reason:'end_turn'},usage:{output_tokens:5}},'message_delta')+frame({type:'message_stop'},'message_stop'));
  expect(anthropic.usage).toEqual({input:10,output:5,cacheRead:20,cacheWrite:30,totalTokens:65});expect(anthropic.forward).toHaveLength(2);
});
it.each([
  {prompt_tokens:100},
  {prompt_tokens:100,completion_tokens:-1},
  {prompt_tokens:100,completion_tokens:20,total_tokens:119},
  {prompt_tokens:100,completion_tokens:20,prompt_tokens_details:{cached_tokens:101}},
  {prompt_tokens:100,completion_tokens:20,prompt_tokens_details:{cached_tokens:20},cached_tokens:19},
  {prompt_tokens:100,completion_tokens:20,completion_tokens_details:{reasoning_tokens:21}},
])('冲突或缺失分量不能作为零结算 %#',usage=>expect(()=>parse('openai-completions',completion(usage)+frame('[DONE]'))).toThrow());
it('断流、重复usage、终态后数据及UTF8损坏都保留未知',()=>{
  const complete=completion({prompt_tokens:100,completion_tokens:20});
  for(const body of [complete,complete+complete+frame('[DONE]'),complete+frame('[DONE]')+frame({usage:{}}),frame('[DONE]')])expect(()=>parse('openai-completions',body)).toThrow();
  expect(()=>new RequestBudgetUsageStream('openai-completions').push(new Uint8Array([255]))).toThrow();
  expect(()=>parse('openai-responses',frame({type:'response.incomplete',response:{usage:{input_tokens:0,output_tokens:0}}}))).toThrow();
  expect(()=>parse('anthropic-messages',frame({type:'message_stop'}))).toThrow();
});
