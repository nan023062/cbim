import {expect,it,vi} from 'vitest';
import {z} from 'zod';
import {checkedJsonToolResult} from '../src/backend/core/tools/results';
import {ToolRegistry} from '../src/backend/core/tools/registry';
import {jsonValueSchema} from '../src/backend/core/knowledge/tool-output-base';

it('领域值只序列化一次，验证并发送原wire而不再次触发toJSON',()=>{
  let count=0;const value={toJSON:()=>{count++;return count===1?{answer:'真实第一次快照'}:{answer:'不得发送的第二次值'}}};
  const result=checkedJsonToolResult('cbim_test',value,z.object({answer:z.string()}).strict());expect(count).toBe(1);expect(result).toEqual({content:[{type:'text',text:'{"answer":"真实第一次快照"}'}]});
});
it('严格拒缺失字段、额外字段及schema改写，不能默认、裁剪或转换补成成功',()=>{
  const cases:Array<[unknown,z.ZodTypeAny]>=[
    [{},z.object({answer:z.string()}).strict()],
    [{answer:'ok',extra:'secret'},z.object({answer:z.string()}).strict()],
    [{answer:'ok',extra:'secret'},z.object({answer:z.string()})],
    [{},z.object({answer:z.string().default('forged')}).strict()],
    [{answer:'ok'},z.object({answer:z.string().transform(value=>value+' changed')}).strict()],
    [{answer:'4'},z.object({answer:z.coerce.number()}).strict()],
    [{answer:'ok'},z.object({answer:z.string(),extra:z.string().optional()}).transform(value=>({...value,extra:undefined}))],
    [{answer:'ok'},z.any().transform(value=>{value.answer='forged';return value})],
  ];for(const [value,schema] of cases)expect(()=>checkedJsonToolResult('cbim_test',value,schema)).toThrow(expect.objectContaining({code:'TOOL_OUTPUT_INVALID'}));
  const order=z.object({b:z.number(),a:z.number()}).strict();expect(checkedJsonToolResult('cbim_test',{a:1,b:2},order).content[0].text).toBe('{"a":1,"b":2}');
});
it('原始JSON诊断保留自有__proto__与constructor字段，不裁剪也不改变原型',()=>{
  const encoded='{"__proto__":{"diagnostic":"kept"},"constructor":"fact","prototype":[1,null]}',value=JSON.parse(encoded);
  const result=checkedJsonToolResult('cbim_test',value,jsonValueSchema);
  expect(result.content[0].text).toBe(encoded);expect(Object.hasOwn(JSON.parse(result.content[0].text),'__proto__')).toBe(true);expect(({} as Record<string,unknown>).diagnostic).toBeUndefined();
});
it('不可序列化值和校验异常不泄露正文/动态键，错误明确不代表回滚',()=>{
  const secret='PRIVATE_VALUE_DO_NOT_SHOW',bad={toJSON(){throw Error(secret)}};
  for(const value of [bad,undefined,BigInt(1),()=>1])try{checkedJsonToolResult('cbim_test',value,z.unknown());throw Error('expected failure')}catch(error:any){expect(error.code).toBe('TOOL_OUTPUT_INVALID');expect(error.message).toContain('操作可能已经发生');expect(error.message).toContain('不自动重试');expect(error.message).not.toContain(secret)}
  try{checkedJsonToolResult('cbim_test',{[secret]:{secret}},z.record(z.string()));throw Error('expected failure')}catch(error:any){expect(error.code).toBe('TOOL_OUTPUT_INVALID');expect(error.message).not.toContain(secret)}
  expect(()=>checkedJsonToolResult('cbim_test',{ok:true},z.any().refine(()=>{throw Error(secret)}))).toThrow(expect.objectContaining({code:'TOOL_OUTPUT_INVALID'}));
});
it('已发生的execute遇输出校验失败也只执行一次，不猜测成功或自动重试',async()=>{
  let committed=0;const execute=vi.fn(()=>{committed++;return {state:'committed',unexpected:'bad output'}}),registry=new ToolRegistry<boolean>();
  registry.register({name:'cbim_commit',version:1,effects:['knowledge-write'],inputSchema:{},outputSchema:z.object({state:z.literal('committed')}).strict(),cancellation:{mode:'preflight_only',description:'不回滚'},recovery:{mode:'same_request',description:'核对原请求'},execute});
  const resolved=registry.resolve('cbim_commit',{});await expect(registry.invokeResolved(resolved.tool,resolved.args,true)).rejects.toMatchObject({code:'TOOL_OUTPUT_INVALID'});expect(committed).toBe(1);expect(execute).toHaveBeenCalledTimes(1);
});
