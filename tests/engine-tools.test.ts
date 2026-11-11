import {expect,it,vi} from 'vitest';
import {runtimeEngineTools} from '../src/backend/core/brain/engine-tools';
import {claudeTools} from '../src/backend/core/brain/claude/tools';
import {codexTools} from '../src/backend/core/brain/codex/tools';
import {engineInstructions} from '../src/backend/core/brain/engine-instructions';
import {runCapabilityInstructions} from '../src/backend/core/brain/run-capability-instructions';
import type {EngineContext} from '../src/backend/core/brain/types';

const context=():EngineContext=>({task:{taskId:'task',workspaceId:'workspace',root:'.',mode:'chat',agentId:'cbim:main',goal:'test',moduleIds:[],acceptance:[]},runId:'run',directory:'.',emit:async()=>{},beforeTool:async()=>({allow:true})});
const empty={list:async()=>[],call:vi.fn(async()=>({content:[]}))};

it('注册新能力无需修改引擎字段，并保留真实调用身份、停止信号与独立目录',async()=>{
  const call=vi.fn(async()=>({content:[{type:'text',text:'ok'}]})),c=context();
  c.tools={futureCapability:{list:async()=>[{name:'cbim_future',inputSchema:{type:'object'}}],call}};
  const tools=await runtimeEngineTools(c,empty),signal=new AbortController().signal;
  const first=await tools.list();first[0].name='changed';expect((await tools.list())[0].name).toBe('cbim_future');
  await tools.call('cbim_future',{value:1},signal,'original-call');expect(call).toHaveBeenCalledWith('cbim_future',{value:1},'original-call',signal);
  expect(()=>tools.call('cbim_missing',{},signal,'missing')).toThrow('未注册');expect(call).toHaveBeenCalledTimes(1);
});

it('拒绝不同能力间的重名、知识目录冲突及非法工具名',async()=>{
  const port=(name:string)=>({list:async()=>[{name,inputSchema:{}}],call:async()=>undefined});
  const invalid:NonNullable<EngineContext['tools']>[]=[{a:port('cbim_same'),b:port('cbim_same')},{a:port('native_bypass')}];
  for(const tools of invalid)await expect(runtimeEngineTools({...context(),tools},empty)).rejects.toThrow('无效或重复');
  await expect(runtimeEngineTools({...context(),tools:{a:port('cbim_same')}},port('cbim_same'))).rejects.toThrow('无效或重复');
});

it('原生工具禁用独立于业务目录，Claude 和 Codex 均不回退注册原生读写',async()=>{
  const c={...context(),nativeTools:'disabled' as const},native={list:vi.fn(async()=>[{name:'read',inputSchema:{}}]),call:vi.fn(async()=>({content:[]}))};
  const claude=await claudeTools(c,empty,true,()=>undefined),codex=await codexTools(c,empty,native,true,async()=>{});
  try{expect(claude.native).toEqual([]);expect(codex.registered).toEqual([]);expect(native.list).not.toHaveBeenCalled();expect(await codex.call({callId:'fake',tool:'cbim_native_read',arguments:{}})).toMatchObject({success:false});expect(native.call).not.toHaveBeenCalled()}finally{await claude.close();await codex.close()}
});

it('使用说明随可信业务能力装配，普通引擎上下文不获得不存在的成员能力',()=>{
  const c=context();expect(engineInstructions(c,'prompt',false)).not.toContain('cbim_task_checkpoint');
  c.capabilityInstructions=runCapabilityInstructions({help:true,checkpoint:true,validation:true});
  const text=engineInstructions(c,'prompt',false);expect(text).toContain('cbim_task_help');expect(text).toContain('cbim_task_checkpoint');expect(text).toContain('cbim_validation_run');
});
