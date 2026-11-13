import {it,expect,vi} from 'vitest';
import {z} from 'zod';
import {ToolRegistry} from '../src/logic/tools/rules/registry';

it('工具发现和参数解析不会执行或自行签发权限，拒绝重复与非 cbim 名称',async()=>{
  const registry=new ToolRegistry<boolean>();let executions=0;
  const definition={name:'cbim_example',version:1,effects:['read'] as const,inputSchema:{message:z.string()},outputSchema:z.object({message:z.string(),write:z.boolean()}).strict(),cancellation:{mode:'preflight_only' as const,description:'只检查开始前取消'},recovery:{mode:'read_again' as const,description:'重新读不保证旧版本'},execute:async(args:any,write:boolean)=>{executions++;return {message:args.message,write}}};
  registry.register(definition);
  expect(()=>registry.register(definition)).toThrow('工具名称重复');
  expect(()=>registry.register({...definition,name:'example'})).toThrow('cbim_');
  for(const name of ['cbim_','cbim_bad-name','cbim_bad.name','cbim_bad name'])expect(()=>registry.register({...definition,name})).toThrow(expect.objectContaining({code:'TOOL_NAME'}));
  expect(registry.list()[0].inputSchema).toMatchObject({type:'object',required:['message']});
  expect(()=>registry.resolve('cbim_missing',{})).toThrow('未知知识工具');
  expect(()=>registry.resolve('cbim_example',{message:3})).toThrow();
  const {tool,args}=registry.resolve('cbim_example',{message:'hello',approved:true});
  expect(executions).toBe(0);expect(args).toEqual({message:'hello'});
  expect(await registry.invokeResolved(tool,args,false)).toEqual({content:[{type:'text',text:'{"message":"hello","write":false}'}]});
  expect(executions).toBe(1);expect(registry.catalog()).toMatchObject({family:'knowledge',tools:[{name:'cbim_example',version:1,effects:['read']}]});expect(registry.describe('cbim_example').tool).toMatchObject({outputSchema:{type:'object',additionalProperties:false},cancellation:definition.cancellation,recovery:definition.recovery});expect(executions).toBe(1);
});

it('没有真实输出与能力元数据不能注册，发现不会调用execute，外来工具对象不能借注册名执行',async()=>{
  const registry=new ToolRegistry<boolean>(),execute=vi.fn(()=>({ok:true})),definition={name:'cbim_actual',version:1,effects:['read'] as const,inputSchema:{},outputSchema:z.object({ok:z.boolean()}).strict(),cancellation:{mode:'preflight_only' as const,description:'执行前可取消'},recovery:{mode:'read_again' as const,description:'显式重新读取'},execute};
  for(const field of ['outputSchema','version','effects','cancellation','recovery']){const invalid:any={...definition};delete invalid[field];expect(()=>registry.register(invalid)).toThrow(expect.objectContaining({code:'TOOL_CONTRACT'}))}
  registry.register(definition);registry.list();registry.catalog();registry.describe('cbim_actual');expect(execute).not.toHaveBeenCalled();
  await expect(registry.invokeResolved(definition,{},false)).rejects.toMatchObject({code:'TOOL_CONTRACT'});expect(execute).not.toHaveBeenCalled();
});

it('缺失身份返回可读纠错提示且不执行，其他参数错误不泄露输入正文',()=>{
  const registry=new ToolRegistry<boolean>(),execute=vi.fn();
  registry.register({name:'cbim_skill_example',version:1,effects:['read'],inputSchema:{workspaceId:z.string(),instanceId:z.string(),count:z.number()},outputSchema:z.object({}),cancellation:{mode:'preflight_only',description:'开始前取消'},recovery:{mode:'read_again',description:'重新读取'},execute});
  expect(()=>registry.resolve('cbim_skill_example',{})).toThrow(expect.objectContaining({code:'TOOL_INPUT_INVALID',message:expect.stringContaining('cbim_workspace_identity')}));
  expect(()=>registry.resolve('cbim_skill_example',{workspaceId:'w',instanceId:'i',count:'private-body'})).toThrow(expect.objectContaining({message:expect.stringContaining('count：类型或格式')}));
  try{registry.resolve('cbim_skill_example',{workspaceId:'w',instanceId:'i',count:'private-body'})}catch(error){expect(String(error)).not.toContain('private-body');expect(String(error)).toContain('本次尚未执行')}
  expect(execute).not.toHaveBeenCalled();
});

it('实际Schema解析保留可选和默认语义，不将缺省项误报必填，也不把null当省略',()=>{
  const registry=new ToolRegistry<boolean>();registry.register({name:'cbim_defaults',version:1,effects:['read'],inputSchema:{required:z.string(),query:z.string().optional(),count:z.number().default(5)},outputSchema:z.object({}),cancellation:{mode:'preflight_only',description:'开始前取消'},recovery:{mode:'read_again',description:'重新读取'},execute:()=>({})});
  expect(registry.resolve('cbim_defaults',{required:'ok'}).args).toEqual({required:'ok',count:5});
  expect(registry.resolve('cbim_defaults',{required:'ok',count:0,query:''}).args).toEqual({required:'ok',count:0,query:''});
  try{registry.resolve('cbim_defaults',{})}catch(error){expect(String(error)).toContain('required：缺少必填字段');expect(String(error)).not.toContain('query：');expect(String(error)).not.toContain('count：')}
  expect(()=>registry.resolve('cbim_defaults',{required:'ok',count:null})).toThrow('count：类型或格式');
});
