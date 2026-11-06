import {it,expect} from 'vitest';
import {z} from 'zod';
import {ToolRegistry} from '../src/backend/core/tools/registry';

it('工具发现和参数解析不会执行或自行签发权限，拒绝重复与非 cbim 名称',async()=>{
  const registry=new ToolRegistry<boolean>();let executions=0;
  const definition={name:'cbim_example',inputSchema:{message:z.string()},execute:async(args:any,write:boolean)=>{executions++;return {message:args.message,write}}};
  registry.register(definition);
  expect(()=>registry.register(definition)).toThrow('工具名称重复');
  expect(()=>registry.register({...definition,name:'example'})).toThrow('cbim_');
  expect(registry.list()[0].inputSchema).toMatchObject({type:'object',required:['message']});
  expect(()=>registry.resolve('cbim_missing',{})).toThrow('未知知识工具');
  expect(()=>registry.resolve('cbim_example',{message:3})).toThrow();
  const {tool,args}=registry.resolve('cbim_example',{message:'hello',approved:true});
  expect(executions).toBe(0);expect(args).toEqual({message:'hello'});
  expect(await tool.execute(args,false)).toEqual({message:'hello',write:false});
});
