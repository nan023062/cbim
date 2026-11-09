import {it,expect} from 'vitest';
import {jsonToolResult,validateToolResult} from '../src/backend/core/tools/results';
import {openBridge} from '../src/backend/core/brain/pi/bridge';

it('显式空值可表达，未定义、循环或无法序列化的返回值不能伪装为成功文本',()=>{
  for(const value of [undefined,()=>1,Symbol('invalid'),BigInt(1)])expect(()=>jsonToolResult('cbim_test',value)).toThrowError(expect.objectContaining({code:'TOOL_RESULT_INVALID'}));
  const cycle:any={};cycle.self=cycle;
  expect(()=>jsonToolResult('cbim_test',cycle)).toThrowError(expect.objectContaining({code:'TOOL_RESULT_INVALID'}));
  expect(jsonToolResult('cbim_test',null)).toEqual({content:[{type:'text',text:'null'}]});
  expect(jsonToolResult('cbim_test',{state:'not_found'}).content[0].text).toBe('{"state":"not_found"}');
});

it('内容块按真实传输形态校验，拒绝缺失文本及不完整图片',()=>{
  for(const value of [undefined,null,{},[],{content:null},{content:[null]},{content:[{type:'text'}]},{content:[{type:'text',text:42}]},{content:[{type:'text',text:null}]},{content:[{type:'image',data:'AAA='}]},{content:[{type:'image',data:'',mimeType:'image/png'}]},{content:[{type:'unknown'}]},{content:[],isError:'false'}]){
    expect(()=>validateToolResult('cbim_test',value),JSON.stringify(value)).toThrowError(expect.objectContaining({code:'TOOL_RESULT_INVALID'}));
  }
  const malformed={content:[{type:'text',text:{toJSON:()=>undefined}}]};
  expect(()=>validateToolResult('cbim_test',malformed)).toThrowError(expect.objectContaining({code:'TOOL_RESULT_INVALID'}));
  const result={content:[{type:'text',text:''},{type:'image',data:'AAA=',mimeType:'image/png'}],isError:false,details:{source:'cbim'}};
  expect(validateToolResult('cbim_test',result)).toEqual(result);
  expect(validateToolResult('cbim_test',result)).not.toBe(result);
});

it('序列化失败不把返回值中的私密内容拼进错误',()=>{
  const value={toJSON(){throw Error('secret-content')}};
  try{jsonToolResult('cbim_test',value);throw Error('expected error')}catch(error:any){
    expect(error.code).toBe('TOOL_RESULT_INVALID');expect(error.message).not.toContain('secret-content');
  }
});

it('执行桥阻止畸形结果入库，消费授权且不会重新执行已完成副作用',async()=>{
  let calls=0;
  const bridge=await openBridge({list:async()=>[{name:'cbim_bad',inputSchema:{type:'object'}}],call:async()=>{calls++;return {content:[{type:'text'}]}}},async()=>({allow:true}));
  const post=(route:string)=>fetch(bridge.url+route,{method:'POST',headers:{Authorization:'Bearer '+bridge.token,'Content-Type':'application/json'},body:JSON.stringify({id:'only-once',name:'cbim_bad',input:{}})});
  try{
    expect((await post('/gate')).status).toBe(200);
    const result=await post('/call');expect(result.status).toBe(400);
    expect(await result.json()).toMatchObject({code:'TOOL_RESULT_INVALID'});
    const replay=await post('/call');expect(replay.status).toBe(400);expect(calls).toBe(1);
  }finally{await bridge.close()}
});
