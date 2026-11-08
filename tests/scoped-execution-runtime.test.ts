import {it,expect,vi} from 'vitest';
import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import {LoopRuntime} from '../src/backend/core/brain/runtime';
import {RunScopedExecution,type ScopedExecutionPort} from '../src/backend/core/brain/run-scoped-execution';
import type {EngineContext,AgentEngine} from '../src/backend/core/brain/types';
import {FileRunStorage} from '../src/backend/main/persistence/tasks/run-storage';
import {authorizeRunTool} from '../src/backend/core/policy/tool-policy';
import {hash} from '../src/backend/core/foundation/serialization';
import {artifactBinding as binding,deferred} from './artifact-runtime-fixture';
import type {ExecutionScope} from '../src/backend/core/workspace/execution-scope';
const scope:ExecutionScope={version:1,profile:'windows-lpac-node-v1',read:[{path:'src',kind:'directory'}],write:[{path:'src/result.txt',kind:'file'}],node:{timeoutMs:1000,memoryMiB:512,processLimit:2}};
const readResult={file:{path:'src/main.cjs',byteLength:5,sha256:hash('bytes')},encoding:'utf8',content:'bytes',acceptance:'not_evaluated'};
const nodeInput={entry:'src/main.cjs',files:['src/main.cjs'],args:[],outputs:[]};
const nodeResult={executionId:'af2067d0-044c-4461-9d2c-e5362749f201',isolation:'windows-lpac-registry-read-v1',status:'exited',exitCode:0,stdio:'',runtime:{sha256:hash('runtime'),assets:[]},inputs:[readResult.file],outputs:[],allProcessesExited:true,cleanup:'complete',acceptance:'not_evaluated'};
async function fixture(work:(c:EngineContext)=>Promise<void>,options:{permission?:'read'|'ask'|'execute';approve?:()=>Promise<{allow:boolean}>;blocked?:()=>boolean;controlled?:boolean}={}){
 const directory=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'cbim-scoped-runtime-')));let context!:EngineContext;const release=vi.fn(),read=vi.fn(async()=>readResult),node=vi.fn(async()=>nodeResult),port:ScopedExecutionPort={scope,read,node,drain:async()=>{if(options.blocked?.())throw Error('not drained')}};
 const engine:AgentEngine={kind:'scope-test',start:async c=>{context=c},run:async()=>{await work(context);return {status:'completed'}},close:async()=>{},stop:async()=>{}};
 const runtime=new LoopRuntime({storage:new FileRunStorage(),directory,scopedExecution:port,workflowContracts:[{moduleId:'module',workflowId:'workflow',workflowVersion:'1',contract:{version:1,executionScope:scope}}],controlledFiles:options.controlled?{scopeId:'scope',write:async()=>{throw Error('unknown write')},drain:async()=>{}}:undefined,describeTool:call=>({native:false,contractVersion:1,effects:[call.name==='cbim_scoped_node'?'command':call.name==='cbim_file_write_controlled'?'business-write':'read'],...(call.name==='cbim_file_write_controlled'?{scope:{kind:'workspace',workspaceId:binding.workspaceId}}:{})}),createEngine:()=>engine,acquireLease:async()=>release,toolPolicy:(call,descriptor)=>authorizeRunTool(call,descriptor!,{workspaceId:binding.workspaceId,permission:options.permission??'execute',guard:async()=>({allow:true}),approve:options.approve})});
 return {runtime,release,read,node,start:()=>runtime.startMember({taskId:binding.taskId,workspaceId:binding.workspaceId,agentId:binding.agentId,root:directory,goal:'scope',moduleIds:['module'],acceptance:[]},'scope',{binding,session:{nativeSessionId:'native-one'}}),close:async()=>{await runtime.close();if(path.dirname(directory)!==await fs.realpath(os.tmpdir())||!path.basename(directory).startsWith('cbim-scoped-runtime-'))throw Error('cleanup');await fs.rm(directory,{recursive:true,force:true})}};
}
it('正式Runtime拒绝伪造原生调用、越界读取/写入和allowed；原参数一次消费',async()=>{
 const f=await fixture(async c=>{
  for(const name of ['read','write','edit','bash','find','ls','grep'])expect((await c.beforeTool({id:name,name,input:{path:'src/main.cjs',command:'echo unsafe'}})).allow).toBe(false);
  expect((await c.beforeTool({id:'outside',name:'cbim_scoped_read',input:{path:'private.txt'}})).allow).toBe(false);
  expect((await c.beforeTool({id:'outside-write',name:'cbim_file_write_controlled',input:{path:'src/no.txt',content:'x',expectedBefore:{byteLength:0,sha256:hash('')}}})).allow).toBe(false);
  await expect(c.emit({type:'tool.allowed',data:{id:'fake',name:'cbim_scoped_node',input:nodeInput}})).rejects.toBeDefined();
  await expect(c.scopedExecutionTools!.call('cbim_scoped_node',nodeInput,'fake')).rejects.toMatchObject({code:'EXECUTION_SCOPE_AUTHORIZATION'});
  expect((await c.beforeTool({id:'valid',name:'cbim_scoped_read',input:{path:'src/main.cjs'}})).allow).toBe(true);const result=await c.scopedExecutionTools!.call('cbim_scoped_read',{path:'src/main.cjs'},'valid');
  await expect(c.scopedExecutionTools!.call('cbim_scoped_read',{path:'src/main.cjs'},'valid')).rejects.toMatchObject({code:'EXECUTION_SCOPE_AUTHORIZATION'});await c.emit({type:'tool.finished',data:{id:'valid',name:'cbim_scoped_read',result}});
 });try{expect((await(await f.start()).done).status).toBe('completed');expect(f.read).toHaveBeenCalledTimes(1);expect(f.node).not.toHaveBeenCalled()}finally{await f.close()}
});
it.each(['read','ask'] as const)('%s 不允许未批准命令，审批前拒绝越界',async permission=>{
 const approve=vi.fn(async()=>({allow:false}));const f=await fixture(async c=>{expect((await c.beforeTool({id:'outside',name:'cbim_scoped_node',input:{...nodeInput,files:['private.txt']}})).allow).toBe(false);expect(approve).not.toHaveBeenCalled();expect((await c.beforeTool({id:'node',name:'cbim_scoped_node',input:nodeInput})).allow).toBe(false)},{permission,approve});try{await(await f.start()).done;expect(f.node).not.toHaveBeenCalled();expect(approve).toHaveBeenCalledTimes(permission==='ask'?1:0)}finally{await f.close()}
});
it('审批期间停止拒绝迟到批准；物理drain失败保留原占用，再次close不重放',async()=>{
 const entered=deferred(),approve=deferred();let blocked=true;const f=await fixture(async c=>{expect((await c.beforeTool({id:'node',name:'cbim_scoped_node',input:nodeInput})).allow).toBe(false)},{permission:'ask',approve:async()=>{entered.resolve();await approve.promise;return {allow:true}},blocked:()=>blocked});
 try{const start=await f.start();await entered.promise;await f.runtime.stop(binding.taskId);approve.resolve();await expect(start.done).rejects.toThrow('not drained');expect(f.release).not.toHaveBeenCalled();expect(f.node).not.toHaveBeenCalled();blocked=false;await f.runtime.close();expect(f.release).toHaveBeenCalledTimes(1)}finally{blocked=false;approve.resolve();await f.close()}
});
it('未知受控写后阻止换ID的隔离命令，范围内只读核实仍保留',async()=>{
 const f=await fixture(async c=>{const input={path:'src/result.txt',content:'x',expectedBefore:{byteLength:0,sha256:hash('')}};expect((await c.beforeTool({id:'write',name:'cbim_file_write_controlled',input})).allow).toBe(true);await expect(c.controlledFileTools!.call('cbim_file_write_controlled',input,'write')).rejects.toThrow('unknown');await c.emit({type:'tool.finished',data:{id:'write',name:'cbim_file_write_controlled',isError:true,result:'unknown'}});expect((await c.beforeTool({id:'node',name:'cbim_scoped_node',input:nodeInput})).allow).toBe(false);expect((await c.beforeTool({id:'read',name:'cbim_scoped_read',input:{path:'src/main.cjs'}})).allow).toBe(true);const result=await c.scopedExecutionTools!.call('cbim_scoped_read',{path:'src/main.cjs'},'read');await c.emit({type:'tool.finished',data:{id:'read',name:'cbim_scoped_read',result}})},{controlled:true});try{expect((await(await f.start()).done).status).toBe('interrupted');expect(f.node).not.toHaveBeenCalled();expect(f.read).toHaveBeenCalledTimes(1)}finally{await f.close()}
});
it('非零退出返回原事实并标记工具失败；坏字节回包不重复执行',async()=>{
 const node=vi.fn(async()=>({...nodeResult,exitCode:7})),port:ScopedExecutionPort={scope,read:async()=>({...readResult,content:'wrong'}),node,drain:async()=>{}};
 const tools=new RunScopedExecution(scope,port,()=>{});tools.guard('cbim_scoped_node','node',nodeInput,[]);tools.authorize('node',2);expect(await tools.call('cbim_scoped_node',nodeInput,'node')).toMatchObject({isError:true});tools.observed('tool.finished','node');tools.guard('cbim_scoped_read','read',{path:'src/main.cjs'},[]);tools.authorize('read',7);await expect(tools.call('cbim_scoped_read',{path:'src/main.cjs'},'read')).rejects.toMatchObject({code:'TOOL_OUTPUT_INVALID'});expect(node).toHaveBeenCalledTimes(1);
});
