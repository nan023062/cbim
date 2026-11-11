import {expect,it,vi} from 'vitest';
import {claudeTools} from '../src/backend/core/brain/claude/tools';
import {codexTools} from '../src/backend/core/brain/codex/tools';
import type {EngineContext} from '../src/backend/core/brain/types';
import type {EngineToolsPort} from '../src/backend/core/brain/engine-tools';

it.each([true,false])('Claude/Codex 按可信能力策略收窄实际目录，关闭原生工具=%s',async disabled=>{
  const internal:EngineToolsPort={list:async()=>[{name:'cbim_business',inputSchema:{type:'object'}}],call:async()=>({content:[{type:'text',text:'{}'}]})};
  const beforeTool=vi.fn(async()=>({allow:true})),context:EngineContext={task:{taskId:'task',workspaceId:'workspace',root:'.',mode:'chat',agentId:'cbim:main',goal:'test',moduleIds:[],acceptance:[]},runId:'run',directory:'.',capabilities:[{id:'unrelated-business-name',tools:internal,disableNativeTools:disabled}],beforeTool,emit:async()=>{}};
  const native:EngineToolsPort={list:vi.fn(async()=>[{name:'write',inputSchema:{type:'object'}}]),call:vi.fn(async()=>({content:[{type:'text',text:'saved'}]}))};
  const claude=await claudeTools(context,internal,true,()=>undefined),codex=await codexTools(context,internal,native,true,async()=>{});
  try{
    expect(claude.native.includes('Write')).toBe(!disabled);expect(claude.expected).toContain('mcp__cbim__cbim_business');
    expect(codex.catalog.some(tool=>tool.name==='cbim_native_write')).toBe(!disabled);
    expect(await codex.call({callId:'real-call',tool:'cbim_native_write',arguments:{path:'file',content:'value'}})).toMatchObject({success:!disabled});
    expect(native.call).toHaveBeenCalledTimes(disabled?0:1);expect(beforeTool).toHaveBeenCalledTimes(disabled?0:1);
    if(disabled){expect(claude.native).toEqual([]);expect(native.list).not.toHaveBeenCalled()}
  }finally{await claude.close();await codex.close()}
});
