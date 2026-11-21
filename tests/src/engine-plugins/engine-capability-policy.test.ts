import {expect,it,vi} from 'vitest';
import {claudeTools} from '../../../src/engine-plugins/claude/tools';
import {codexTools} from '../../../src/engine-plugins/codex/tools';
import type {EngineContext} from '../../../src/logic-new/execution/rules/types';
import type {EngineToolsPort} from '../../../src/logic-new/execution/rules/engine-tools';

it.each([true,false])('Claude/Codex 按可信能力策略收窄实际目录，关闭原生工具=%s',async disabled=>{
  const internal:EngineToolsPort={list:async()=>[{name:'cbim_business',inputSchema:{type:'object'}}],call:async()=>({content:[{type:'text',text:'{}'}]})};
  const beforeTool=vi.fn(async()=>({allow:true})),context:EngineContext={task:{taskId:'task',workspaceId:'workspace',root:'.',mode:'chat',agentId:'cbim:main',goal:'test',moduleIds:[],acceptance:[]},runId:'run',directory:'.',capabilities:[{id:'unrelated-business-name',tools:internal,disableNativeTools:disabled}],beforeTool: beforeTool,emit:async()=>{}};
  const native:EngineToolsPort={list:vi.fn(async()=>[{name:'write',inputSchema:{type:'object'}}]),call:vi.fn(async()=>({content:[{type:'text',text:'saved'}]}))};
  const claude=await claudeTools(context,internal,true,()=>undefined),codex=await codexTools(context,internal,native,true,async()=>{});
  try{
    expect(claude.native.includes('Write')).toBe(!disabled);expect(claude.expected).toContain('mcp__cbim__cbim_business');
    expect(codex.catalog.some(tool=>tool.name==='cbim_native_write')).toBe(!disabled);
    expect(await codex.Call({callId:'real-call',tool:'cbim_native_write',arguments:{path:'file',content:'value'}})).toMatchObject({success:!disabled});
    expect(native.call).toHaveBeenCalledTimes(disabled?0:1);expect(beforeTool).toHaveBeenCalledTimes(disabled?0:1);
    if(disabled){expect(claude.native).toEqual([]);expect(native.list).not.toHaveBeenCalled()}
  }finally{await claude.Close();await codex.Close()}
});

it('read-only catalogs reject a Codex write before invoking the tool', async () => {
  const internal: EngineToolsPort = { list: async () => [], call: vi.fn() };
  const context: EngineContext = { task: { taskId: 'task', workspaceId: 'workspace', root: '.', mode: 'chat', agentId: 'main', goal: 'test', moduleIds: [], acceptance: [] }, runId: 'run', directory: '.', beforeTool: vi.fn(async () => ({ allow: true })), emit: async () => {} };
  const native = { list: async () => ['read', 'write'].map(name => ({ name, inputSchema: {} })), call: vi.fn() };
  const claude = await claudeTools(context, internal, false, () => undefined);
  const codex = await codexTools(context, internal, native, false, async () => {});
  try {
    expect(claude.native).toEqual(['Read', 'Glob', 'Grep']);
    expect(codex.catalog.map(tool => tool.name)).toEqual(['cbim_native_read']);
    expect(await codex.Call({ callId: 'write', tool: 'cbim_native_write', arguments: {} })).toMatchObject({ success: false });
    expect(native.call).not.toHaveBeenCalled();
  } finally { await claude.Close(); await codex.Close(); }
});
