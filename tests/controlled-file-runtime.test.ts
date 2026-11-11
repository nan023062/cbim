import {runtimeTools} from './runtime-tools-fixture';
import {it,expect,vi} from 'vitest';
import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {LoopRuntime} from '../src/backend/core/brain/runtime';
import type {AgentEngine,EngineContext,TaskSpec} from '../src/backend/core/brain/types';
import {RunControlledFile,type ControlledFileRunPort} from '../src/backend/core/brain/run-controlled-file';
import {FileRunStorage} from '../src/backend/main/persistence/tasks/run-storage';
import {controlledFileWriteToolName as tool,type ControlledFileWriteApplied} from '../src/backend/core/tasks/controlled-file-operation';
import {controlledFileOperationId} from '../src/backend/core/tasks/controlled-file-rules';
import {authorizeRunTool} from '../src/backend/core/policy/tool-policy';
import {hash} from '../src/backend/core/foundation/serialization';
import {artifactBinding as binding,deferred} from './artifact-runtime-fixture';
const input={path:'File.txt',expectedBefore:{byteLength:3,sha256:hash('old')},content:'new'};
function applied(id='call',scopeId='scope'):ControlledFileWriteApplied{return {version:1,state:'applied',operationId:controlledFileOperationId(binding,id),revision:3,scopeId,binding,toolCallId:id,inputHash:hash(JSON.stringify(input)),relativePath:input.path,before:input.expectedBefore,after:{byteLength:3,sha256:hash('new')},appliedAt:new Date().toISOString(),coverage:'single_file_default_stream',acceptance:'not_evaluated'}}
async function fixture(work:(c:EngineContext)=>Promise<void>,options:{port?:ControlledFileRunPort;rejectAllowed?:boolean;policy?:()=>Promise<boolean>}={}){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-controlled-runtime-'));let context!:EngineContext;const release=vi.fn(),write=vi.fn(async()=>applied()),drain=vi.fn(async()=>{}),port=options.port??{scopeId:'scope',write,drain};
 const engine:AgentEngine={kind:'test',start:async c=>{context=c},run:async()=>{await work(context);return {status:'completed'}},stop:async()=>{},close:async()=>{}};
 const storage=new FileRunStorage(),create=storage.createJournal.bind(storage);if(options.rejectAllowed)storage.createJournal=(...args)=>{const journal=create(...args),append=journal.append.bind(journal);journal.append=async event=>{if(event.type==='tool.allowed')throw Error('durable append rejected');return append(event)};return journal};
 const runtime=new LoopRuntime({storage,directory,controlledFiles:port,createEngine:()=>engine,acquireLease:async()=>release,toolPolicy:async()=>({allow:options.policy?await options.policy():true,effects:['business-write'],scope:{kind:'workspace',workspaceId:binding.workspaceId}})});
 const task:TaskSpec={workspaceId:binding.workspaceId,taskId:binding.taskId,agentId:binding.agentId,root:directory,goal:'replace',moduleIds:['module'],acceptance:[]};
 return {runtime,write,drain,release,start:()=>runtime.startMember(task,task.goal,{binding,session:{nativeSessionId:'native-one'}}),cleanup:async()=>{await runtime.close();if(path.dirname(directory)!==os.tmpdir()||!path.basename(directory).startsWith('cbim-controlled-runtime-'))throw Error('cleanup');await fs.rm(directory,{recursive:true,force:true})}};
}
it('Runtime 自身可靠 allowed 签发一次许可，工具调用后只接受原 scope/operation 的唯一 wire',async()=>{
 const f=await fixture(async c=>{expect((await c.beforeTool({name:tool,id:'call',input})).allow).toBe(true);const result=await runtimeTools(c).controlledFileTools!.call(tool,input,'call');expect(JSON.parse(result.content[0].text).operation.operationId).toBe(controlledFileOperationId(binding,'call'));await expect(runtimeTools(c).controlledFileTools!.call(tool,input,'call')).rejects.toMatchObject({code:'CONTROLLED_FILE_AUTHORIZATION'});await c.emit({type:'tool.finished',data:{id:'call',name:tool,result}})});
 try{const s=await(await f.start()).done;expect(s.status).toBe('completed');const allowed=s.events.find(e=>e.type==='tool.allowed')!;expect(f.write).toHaveBeenCalledTimes(1);expect(f.write.mock.calls[0]).toBeDefined();expect(allowed.seq).toBeGreaterThan(1);expect(f.drain).toHaveBeenCalled();expect(f.release).toHaveBeenCalledTimes(1)}finally{await f.cleanup()}
});
it('引擎伪造 allowed 或可靠追加失败不能取得一次写许可',async()=>{
 const forged=await fixture(async c=>{await expect(c.emit({type:'tool.allowed',data:{id:'call',name:tool,input,allow:true,effects:['business-write'],scope:{kind:'workspace',workspaceId:binding.workspaceId}}})).rejects.toMatchObject({code:'CONTROLLED_FILE_AUTHORIZATION'});await expect(runtimeTools(c).controlledFileTools!.call(tool,input,'call')).rejects.toMatchObject({code:'CONTROLLED_FILE_AUTHORIZATION'})});
 try{await(await forged.start()).done;expect(forged.write).not.toHaveBeenCalled()}finally{await forged.cleanup()}
 const failed=await fixture(async c=>{await expect(c.beforeTool({name:tool,id:'call',input})).rejects.toThrow('append');await expect(runtimeTools(c).controlledFileTools!.call(tool,input,'call')).rejects.toMatchObject({code:'CONTROLLED_FILE_AUTHORIZATION'})},{rejectAllowed:true});
 try{await(await failed.start()).done;expect(failed.write).not.toHaveBeenCalled()}finally{await failed.cleanup()}
});
it.each(['scope','operation'] as const)('端口已执行后坏 %s 回包不重做，伪早到结束不释放 IO 短锁',async kind=>{
 const entered=deferred(),release=deferred(),port:ControlledFileRunPort={scopeId:'scope',write:vi.fn(async()=>{entered.resolve();await release.promise;return {...applied(),...(kind==='scope'?{scopeId:'foreign'}:{operationId:hash('foreign')})}}),drain:async()=>{}};
 const f=await fixture(async c=>{expect((await c.beforeTool({name:tool,id:'call',input})).allow).toBe(true);const pending=runtimeTools(c).controlledFileTools!.call(tool,input,'call');await entered.promise;await c.emit({type:'tool.finished',data:{id:'call',name:tool,isError:true}});expect((await c.beforeTool({name:'read',id:'racing',input:{path:'File.txt'}})).allow).toBe(false);release.resolve();await expect(pending).rejects.toMatchObject({code:'TOOL_OUTPUT_INVALID'});expect((await c.beforeTool({name:'read',id:'later',input:{path:'File.txt'}})).allow).toBe(true);await c.emit({type:'tool.finished',data:{id:'later',name:'read'}})},{port});
 try{await(await f.start()).done;expect(port.write).toHaveBeenCalledTimes(1)}finally{release.resolve();await f.cleanup()}
});
it('审批前预占，停止后不消费原许可；运行终态与租约释放等真实 drain',async()=>{
 const entered=deferred(),approve=deferred(),draining=deferred(),finish=deferred();const port:ControlledFileRunPort={scopeId:'scope',write:vi.fn(async()=>applied()),drain:vi.fn(async()=>{draining.resolve();await finish.promise})};
 const f=await fixture(async c=>{const pending=c.beforeTool({name:tool,id:'call',input});await entered.promise;expect((await c.beforeTool({name:'read',id:'racing',input:{path:'File.txt'}})).allow).toBe(false);await expect(pending).resolves.toMatchObject({allow:false});await expect(runtimeTools(c).controlledFileTools!.call(tool,input,'call')).rejects.toMatchObject({code:'CONTROLLED_FILE_AUTHORIZATION'})},{port,policy:async()=>{entered.resolve();await approve.promise;return true}});
 try{const start=await f.start();await entered.promise;await f.runtime.stop(binding.taskId);approve.resolve();await draining.promise;expect(f.release).not.toHaveBeenCalled();finish.resolve();expect((await start.done).status).toBe('cancelled');expect(port.write).not.toHaveBeenCalled()}finally{approve.resolve();finish.resolve();await f.cleanup()}
});
it('read 拒写、ask 必须批准、execute 仍要求精确内部作用域，主运行不注册',async()=>{
 const descriptor={native:false,effects:['business-write'] as const,scope:{kind:'workspace' as const,workspaceId:binding.workspaceId}},call={id:'call',name:tool,input};const guard=vi.fn(async()=>({allow:true})),approve=vi.fn(async()=>({allow:false}));
 expect((await authorizeRunTool(call,descriptor,{workspaceId:binding.workspaceId,permission:'read',guard})).allow).toBe(false);expect((await authorizeRunTool(call,descriptor,{workspaceId:binding.workspaceId,permission:'ask',guard,approve})).allow).toBe(false);expect(approve).toHaveBeenCalledTimes(1);expect((await authorizeRunTool(call,{...descriptor,effects:['read']},{workspaceId:binding.workspaceId,permission:'execute',guard})).allow).toBe(false);expect(guard).not.toHaveBeenCalled();
 const f=await fixture(async c=>{expect(runtimeTools(c).controlledFileTools).toBeUndefined();expect((await c.beforeTool(call)).allow).toBe(false)});try{await(await f.runtime.start({workspaceId:binding.workspaceId,taskId:'chat',root:os.tmpdir(),agentId:'cbim:main',mode:'chat',goal:'hello',moduleIds:[],acceptance:[]})).done;expect(f.write).not.toHaveBeenCalled()}finally{await f.cleanup()}
});
it('独立工具原参数顺序与内容均固定，端口改输入不能自比骗过输出校验',async()=>{
 const write=vi.fn(async(value:typeof input)=>{value.path='other';return {...applied(),relativePath:'other'}}),tools=new RunControlledFile(binding,{scopeId:'scope',write,drain:async()=>{}},()=>{});expect(tools.guard(tool,'call',input,[])).toBeUndefined();tools.authorize('call',7);await expect(tools.call(tool,input,'call')).rejects.toMatchObject({code:'TOOL_OUTPUT_INVALID'});expect(write).toHaveBeenCalledTimes(1);
});
it('真实drain未确认时保留运行租约，再次关闭只排空原操作而不重写',async()=>{
 let blocked=true;const write=vi.fn(async()=>applied()),port:ControlledFileRunPort={scopeId:'scope',write,drain:async()=>{if(blocked)throw Object.assign(Error('child not exited'),{code:'CONTROLLED_FILE_DRAIN_PENDING'})}};
 const f=await fixture(async c=>{expect((await c.beforeTool({name:tool,id:'call',input})).allow).toBe(true);const result=await runtimeTools(c).controlledFileTools!.call(tool,input,'call');await c.emit({type:'tool.finished',data:{id:'call',name:tool,result}})},{port});
 try{const start=await f.start();await expect(start.done).rejects.toMatchObject({code:'CONTROLLED_FILE_DRAIN_PENDING'});expect(f.release).not.toHaveBeenCalled();await expect(f.runtime.close()).rejects.toMatchObject({code:'CONTROLLED_FILE_DRAIN_PENDING'});blocked=false;await f.runtime.close();expect(f.release).toHaveBeenCalledTimes(1);expect(write).toHaveBeenCalledTimes(1)}finally{blocked=false;await f.cleanup()}
});
it('同步前置拒绝仍须消费后收尾，真实finished后解短锁；排空异常统一保留占用',async()=>{
 const write=vi.fn(()=>{throw Error('preflight sync rejection')}),tools=new RunControlledFile(binding,{scopeId:'scope',write,drain:async()=>{throw Error('unclassified platform failure')}},()=>{});tools.guard(tool,'call',input,[]);tools.authorize('call',7);await expect(tools.call(tool,input,'call')).rejects.toThrow('preflight sync');expect(tools.guard('read','before',{},[])).toBeDefined();tools.observed('tool.finished','call');expect(tools.guard('read','after',{},[])).toBeUndefined();await expect(tools.call(tool,input,'call')).rejects.toMatchObject({code:'CONTROLLED_FILE_AUTHORIZATION'});await expect(tools.drain()).rejects.toMatchObject({code:'CONTROLLED_FILE_DRAIN_PENDING'});expect(write).toHaveBeenCalledTimes(1);
});

it.each(['unknown','bad-wire','proof-unavailable'] as const)('受控写 %s 后新ID不能绕过本轮屏障，读取/求助保留但不正常交接',async mode=>{
 const failure=Object.assign(Error('write outcome unknown'),{code:'CONTROLLED_PARTIAL_WRITE'});
 const write=vi.fn(async()=>{if(mode==='bad-wire')return {...applied(),toolCallId:'foreign'};throw failure});
 const port:ControlledFileRunPort={scopeId:'scope',write,drain:async()=>{},confirmNotApplied:async()=>{if(mode==='proof-unavailable')throw Error('store unavailable');return false}};
 const f=await fixture(async c=>{
   await runtimeTools(c).taskTools!.call('cbim_task_plan',{expectedVersion:0,goal:'replace',acceptance:['真实核实原文件'],reason:'verify',steps:[{id:'verify',title:'核实原写',owner:'owner'}]});
   expect((await c.beforeTool({name:tool,id:'call',input})).allow).toBe(true);
   await expect(runtimeTools(c).controlledFileTools!.call(tool,input,'call')).rejects.toBeDefined();
   await c.emit({type:'tool.finished',data:{id:'call',name:tool,isError:true,result:'original failure'}});
   const progress=JSON.parse((await runtimeTools(c).taskTools!.call('cbim_task_inspect',{})).content[0].text),version=progress.plan.version;
   for(const [name,args] of [[tool,input],['write',{path:input.path,content:'unsafe'}],['edit',{path:input.path,edits:[{oldText:'new',newText:'unsafe'}]}],['bash',{command:'echo unsafe > File.txt'}],['cbim_delivery_prepare',{expectedVersion:version,summary:'unsafe',limitations:[]}],['cbim_task_checkpoint',{}]] as const){
     const decision=await c.beforeTool({name,id:'bypass-'+name,input:args});expect(decision.allow).toBe(false);expect(decision.reason).toContain('CONTROLLED_FILE_REVIEW_REQUIRED');
   }
   await expect(runtimeTools(c).taskTools!.call('cbim_delivery_prepare',{expectedVersion:version,summary:'unsafe direct',limitations:[]})).rejects.toMatchObject({code:'CONTROLLED_FILE_REVIEW_REQUIRED'});
   expect((await c.beforeTool({name:'read',id:'inspect-file',input:{path:input.path}})).allow).toBe(true);await c.emit({type:'tool.finished',data:{id:'inspect-file',name:'read',result:'current bytes'}});
   expect((await c.beforeTool({name:'cbim_task_inspect',id:'inspect-plan',input:{}})).allow).toBe(true);await c.emit({type:'tool.finished',data:{id:'inspect-plan',name:'cbim_task_inspect'}});
   const help={kind:'capability',reason:'原写未核实',question:'请独立核实原文件',attemptedToolCallIds:['call']};
   expect((await c.beforeTool({name:'cbim_task_help',id:'help',input:help})).allow).toBe(true);const result=await runtimeTools(c).memberHelpTools!.call('cbim_task_help',help,'help');await c.emit({type:'tool.finished',data:{id:'help',name:'cbim_task_help',result}});
 },{port});
 try{const summary=await(await f.start()).done;expect(summary.status).toBe('interrupted');expect(summary.toolReceipts!.find(r=>r.toolCallId==='call')?.outcome).toBe('failed');expect(summary.events.at(-1)?.data.unverifiedControlledCalls).toEqual(['call']);expect(summary.events.some(e=>e.type==='task.help_requested')).toBe(true);expect(write).toHaveBeenCalledTimes(1)}finally{await f.cleanup()}
});

it('可信未写证明只解除原调用屏障，新调用仍需独立授权，原失败回执保留',async()=>{
 let first=true;const confirm=vi.fn(async(_authorization:{toolCallId:string;inputHash:string;allowedSeq:number})=>true),write=vi.fn(async()=>{if(first){first=false;throw Error('write not issued')}return applied('next')});
 const f=await fixture(async c=>{
   expect((await c.beforeTool({name:tool,id:'call',input})).allow).toBe(true);await expect(runtimeTools(c).controlledFileTools!.call(tool,input,'call')).rejects.toThrow('write not issued');await c.emit({type:'tool.finished',data:{id:'call',name:tool,isError:true}});
   await expect(runtimeTools(c).controlledFileTools!.call(tool,input,'next')).rejects.toMatchObject({code:'CONTROLLED_FILE_AUTHORIZATION'});
   expect((await c.beforeTool({name:tool,id:'next',input})).allow).toBe(true);const result=await runtimeTools(c).controlledFileTools!.call(tool,input,'next');await c.emit({type:'tool.finished',data:{id:'next',name:tool,result}});
 },{port:{scopeId:'scope',write,confirmNotApplied:confirm,drain:async()=>{}}});
 try{const summary=await(await f.start()).done;expect(summary.status).toBe('completed');expect(summary.toolReceipts!.map(r=>r.outcome)).toEqual(['failed','succeeded']);expect(confirm).toHaveBeenCalledTimes(1);expect(confirm.mock.calls[0]?.[0]).toMatchObject({toolCallId:'call',inputHash:hash(JSON.stringify(input))});expect(write).toHaveBeenCalledTimes(2)}finally{await f.cleanup()}
});
