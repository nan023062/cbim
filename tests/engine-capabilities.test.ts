import {expect,it,vi} from 'vitest';
import {runtimeEngineTools,nativeToolsDisabled,type EngineCapability,type EngineToolsPort} from '../src/logic/execution/rules/engine-tools';
import {memberToolCapabilities} from '../src/logic/execution/rules/capabilities/member-tool-capabilities';
import {RunScopedExecution} from '../src/logic/execution/rules/capabilities/run-scoped-execution';
import type {ExecutionScope} from '../src/logic/workspace/rules/execution-scope';

const empty:EngineToolsPort={list:async()=>[],call:async()=>{throw Error('not registered')}};
it('新能力不扩展上下文字段即可注册，目录冻结，调用身份和停止信号原样传递',async()=>{
  const schema={name:'cbim_new_business',inputSchema:{type:'object'}},call=vi.fn(async()=>({ok:true}));
  const capability:EngineCapability={id:'new-business',tools:{list:async()=>[schema],call},instructions:['只核实实际结果']};
  const tools=await runtimeEngineTools({capabilities:[capability]},empty);
  schema.name='cbim_changed';const catalog=await tools.list();catalog[0].inputSchema.type='string';
  expect(await tools.list()).toEqual([{name:'cbim_new_business',inputSchema:{type:'object'}}]);
  const controller=new AbortController(),args={item:'actual'};controller.abort();
  expect(await tools.call('cbim_new_business',args,controller.signal,'original-id')).toEqual({ok:true});
  expect(call).toHaveBeenCalledExactlyOnceWith('cbim_new_business',args,controller.signal,'original-id');
  expect(()=>tools.call('cbim_missing',{},controller.signal)).toThrow('未注册');
});
it.each(['bad','cbim_duplicate'])('无效或与知识工具重名的 %s 拒绝整个目录，不执行能力',async name=>{
  const call=vi.fn(),tool={name,inputSchema:{}},knowledge={...empty,list:async()=>[{name:'cbim_duplicate',inputSchema:{}}]};
  await expect(runtimeEngineTools({capabilities:[{id:'conflict',tools:{list:async()=>[tool],call}}]},knowledge)).rejects.toThrow('无效或重复');
  expect(call).not.toHaveBeenCalled();
});
it('范围能力独立声明关闭原生工具；业务适配保留参数顺序及取消，不授予未注入能力',async()=>{
  const call=vi.fn(async()=>({content:[{type:'text' as const,text:'{}'}]})),scope:ExecutionScope={version:1,profile:'windows-lpac-node-v1',read:[],write:[]};
  const execution=new RunScopedExecution(scope,{scope,read:async()=>{},node:async()=>{},drain:async()=>{}},()=>{}),list=()=>execution.list();
  const capabilities=memberToolCapabilities({scopedExecutionTools:{list,call}}),signal=new AbortController().signal;
  expect(capabilities).toHaveLength(1);expect(nativeToolsDisabled({capabilities})).toBe(true);expect(nativeToolsDisabled({})).toBe(false);
  const tools=await runtimeEngineTools({capabilities},empty);await tools.call('cbim_scoped_read',{path:'f'},signal,'call-id');
  expect(call).toHaveBeenCalledExactlyOnceWith('cbim_scoped_read',{path:'f'},'call-id',signal);
  expect(capabilities[0].instructions?.join('')).toContain('冻结范围');
});
