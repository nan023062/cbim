import {expect,it,vi} from 'vitest';
import {runtimeEngineTools} from '../src/backend/core/execution/engine-tools';
import {claudeTools} from '../src/backend/engines/claude/tools';
import {codexTools} from '../src/backend/engines/codex/tools';
import {engineInstructions} from '../src/backend/core/execution/engine-instructions';
import {memberToolCapabilities} from '../src/backend/core/execution/capabilities/member-tool-capabilities';
import type {EngineContext} from '../src/backend/core/execution/types';

const context=():EngineContext=>({task:{taskId:'task',workspaceId:'workspace',root:'.',mode:'chat',agentId:'cbim:main',goal:'test',moduleIds:[],acceptance:[]},runId:'run',directory:'.',emit:async()=>{},beforeTool:async()=>({allow:true})});
const empty={list:async()=>[],call:vi.fn(async()=>({content:[]}))};

it('注册新能力无需修改引擎字段，并保留真实调用身份、停止信号与独立目录',async()=>{
  const call=vi.fn(async()=>({content:[{type:'text',text:'ok'}]})),c=context();
  c.capabilities=[{id:'futureCapability',tools:{list:async()=>[{name:'cbim_future',inputSchema:{type:'object'}}],call}}];
  const tools=await runtimeEngineTools(c,empty),signal=new AbortController().signal;
  const first=await tools.list();first[0].name='changed';expect((await tools.list())[0].name).toBe('cbim_future');
  await tools.call('cbim_future',{value:1},signal,'original-call');expect(call).toHaveBeenCalledWith('cbim_future',{value:1},signal,'original-call');
  expect(()=>tools.call('cbim_missing',{},signal,'missing')).toThrow('未注册');expect(call).toHaveBeenCalledTimes(1);
});

it('拒绝不同能力间的重名、知识目录冲突及非法工具名',async()=>{
  const port=(name:string)=>({list:async()=>[{name,inputSchema:{}}],call:async()=>undefined});
  const invalid:NonNullable<EngineContext['capabilities']>[]=[[{id:'a',tools:port('cbim_same')},{id:'b',tools:port('cbim_same')}],[{id:'a',tools:port('native_bypass')}]];
  for(const capabilities of invalid)await expect(runtimeEngineTools({...context(),capabilities},empty)).rejects.toThrow('无效或重复');
  await expect(runtimeEngineTools({...context(),capabilities:[{id:'a',tools:port('cbim_same')}]},port('cbim_same'))).rejects.toThrow('无效或重复');
});

it('原生工具禁用独立于业务目录，Claude 和 Codex 均不回退注册原生读写',async()=>{
  const c={...context(),capabilities:[{id:'disabled',tools:empty,disableNativeTools:true}]},native={list:vi.fn(async()=>[{name:'read',inputSchema:{}}]),call:vi.fn(async()=>({content:[]}))};
  const claude=await claudeTools(c,empty,true,()=>undefined),codex=await codexTools(c,empty,native,true,async()=>{});
  try{expect(claude.native).toEqual([]);expect(codex.registered).toEqual([]);expect(native.list).not.toHaveBeenCalled();expect(await codex.call({callId:'fake',tool:'cbim_native_read',arguments:{}})).toMatchObject({success:false});expect(native.call).not.toHaveBeenCalled()}finally{await claude.close();await codex.close()}
});

it('使用说明随可信业务能力装配，普通引擎上下文不获得不存在的成员能力',()=>{
  const c=context();expect(engineInstructions(c,'prompt',false)).not.toContain('cbim_task_checkpoint');
  const port={list:async()=>[],call:async()=>({content:[{type:'text' as const,text:'{}'}]})};
  c.capabilities=memberToolCapabilities({memberHelpTools:port,memberCheckpointTools:port,validationTools:port});
  const text=engineInstructions(c,'prompt',false);expect(text).toContain('cbim_task_help');expect(text).toContain('cbim_task_checkpoint');expect(text).toContain('cbim_validation_run');
});
