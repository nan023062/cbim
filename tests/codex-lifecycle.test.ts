import {expect,test} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {CodexEngine} from '../src/logic/execution/engines/codex/engine';
import {codexFixture} from './codex-fixture';
import {requestBudgetFixture} from './model-request-budget-fixture';

test('真实 Codex 停止等待中的模型请求，排空后不重试或启动工具',async()=>{
  const f=await codexFixture({hold:true});
  try{
    await f.engine.start(f.context);const running=f.engine.run('Wait for the model');await f.received;await f.engine.stop();expect(await running).toEqual({status:'cancelled'});await f.engine.close();expect(f.requests).toHaveLength(1);expect(f.calls).toEqual([]);
  }finally{await f.cleanup()}
},45000);

test.each(['fail','success'] as const)('真实 Codex 工具等待预算结算：%s',async settlement=>{
  const f=await codexFixture({tool:'write'}),budget=await requestBudgetFixture({tokens:1000000},f.llm);let before:number|undefined;
  const engine=new CodexEngine({...f.engineOptions,requestBudget:async()=>({model:budget.port.model,reserve:async input=>{
    const ticket=await budget.port.reserve(input);return {...ticket,report:async usage=>{await new Promise(resolve=>setTimeout(resolve,300));before??=f.calls.length;if(settlement==='fail')throw Error('test settlement unavailable');await ticket.report(usage)}};
  }})});
  try{
    await engine.start(f.context);const result=await engine.run('Write the file once.').catch(error=>{if(settlement==='success')throw error;return {status:'failed'}});
    expect(before).toBe(0);expect(result.status).toBe(settlement==='fail'?'failed':'completed');expect(f.calls).toHaveLength(settlement==='fail'?0:1);
    expect(await fs.access(path.join(f.cwd,'written.txt')).then(()=>true,()=>false)).toBe(settlement==='success');expect(f.requests).toHaveLength(settlement==='fail'?1:2);
    expect(await budget.service.report(budget.query)).toMatchObject(settlement==='fail'?{reported:0,unknown:1}:{reported:2,unknown:0});
  }finally{await engine.close();await f.cleanup();await budget.cleanup()}
},45000);

test('Codex 只读目录不发布写工具，供应商伪造写调用也没有文件副作用',async()=>{
  const f=await codexFixture({tool:'write'}),engine=new CodexEngine({...f.engineOptions,allowNativeExecution:false});
  try{
    await engine.start(f.context);expect(await engine.run('Read only')).toEqual({status:'completed'});
    expect(f.requests[0].body.tools.some((tool:any)=>tool.name==='cbim_native_write'||tool.name==='request_user_input')).toBe(false);expect(f.calls).toEqual([]);expect(await fs.access(path.join(f.cwd,'written.txt')).then(()=>true,()=>false)).toBe(false);
  }finally{await engine.close();await f.cleanup()}
},45000);

test('Codex 不加载工作区自带 MCP、指令或执行工具',async()=>{
  const f=await codexFixture(),marker=path.join(f.cwd,'unexpected-tool-started');
  try{
    await fs.mkdir(path.join(f.cwd,'.codex'));await fs.writeFile(path.join(f.cwd,'AGENTS.md'),'CBIM_MUST_NOT_LOAD_PROJECT_INSTRUCTIONS');
    await fs.writeFile(path.join(f.cwd,'.codex','config.toml'),'[features]\nshell_tool = true\n[mcp_servers.untrusted]\ncommand = '+JSON.stringify(process.execPath)+'\nargs = '+JSON.stringify(['-e',`require("fs").writeFileSync(${JSON.stringify(marker)},"unexpected")`])+'\n');
    await f.engine.start(f.context);expect(await f.engine.run('Use the host configuration')).toEqual({status:'completed'});
    expect(JSON.stringify(f.requests)).not.toContain('CBIM_MUST_NOT_LOAD_PROJECT_INSTRUCTIONS');expect(await fs.access(marker).then(()=>true,()=>false)).toBe(false);
    expect(f.requests[0].body.tools.every((tool:any)=>tool.type==='function'&&tool.name.startsWith('cbim_'))).toBe(true);
  }finally{await f.cleanup()}
},45000);
