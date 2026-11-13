import {afterEach,expect,it,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {fixture} from './helpers';
import {request} from './data/knowledge';
import {seedModuleOwnership,moduleOwnershipJournal} from './module-ownership-fixture';
import {ModuleOwnershipTools} from '../src/backend/scheduler-engine/tools/module-ownership-tools';
import {mainModuleOwnershipTools} from '../src/backend/main/registry/main-module-ownership-tools';
import {moduleOwnershipMainCommandId} from '../src/logic/workspace/rules/module-ownership-rules';
import {authorizeRunTool} from '../src/logic/tools/rules/policy/tool-policy';
import {toolReceipt} from '../src/logic/tools/rules/receipts';
import {jsonToolResult} from '../src/logic/tools/rules/results';
import {moduleOwnershipToolEffects,isModuleOwnershipControlReceipt} from '../src/logic/workspace/rules/module-ownership-tool-policy';
import type {ModuleOwnershipToolsPort} from '../src/logic/workspace/rules/module-ownership-tools';
import type {TaskSpec} from '../src/logic/tasks/rules/types';

const cleanups:Array<()=>Promise<void>>=[];afterEach(async()=>{vi.restoreAllMocks();for(const cleanup of cleanups.splice(0).reverse())await cleanup()});
const signal=()=>new AbortController().signal;
const decoded=(result:Awaited<ReturnType<ModuleOwnershipTools['call']>>)=>JSON.parse(result.content[0].text);
async function setup(){
  const f=await fixture();cleanups.push(f.cleanup);const seed=await seedModuleOwnership(f.app,f.temp,'http://127.0.0.1:9/v1');
  const workspace=f.app.workspace(seed.entry.id),service=f.app.workspaceOwnerships(seed.entry.id),dispatch=f.app.memberDispatch(seed.entry.id),runId=randomUUID(),scopeId=randomUUID();
  const task:TaskSpec={mode:'chat',agentId:'cbim:main',taskId:randomUUID(),workspaceId:seed.entry.id,root:workspace.entry.path,goal:'Register module ownership',moduleIds:[],acceptance:[]};
  const main=await dispatch.conversationBinding(task),identity={workspaceId:seed.entry.id,rootSessionId:task.taskId};await dispatch.openScope(identity,scopeId,{message:task.goal},runId);
  const binding={...identity,instanceId:workspace.instanceId,scopeId,runId,agentInstanceId:main.agentInstanceId,agentSessionId:main.agentSessionId};
  const context={binding,assertCurrent:(value:AbortSignal)=>value.throwIfAborted(),track:<T>(operation:()=>Promise<T>)=>operation()};
  const port=mainModuleOwnershipTools(workspace,service,f.app.workspaceMembers(seed.entry.id),task,runId,main,context,dispatch.owners),tools=new ModuleOwnershipTools(port,binding);
  const change={moduleId:seed.moduleId,expectedBinding:null,nextOwner:{memberId:seed.first.receipt.memberId,expectedRevision:1},reason:'Explicit main registration'};
  const preview=(await port.preview({change},signal())) as {preview:{basis:string;ownershipCursor:null}};
  const input={change,expectedOwnershipCursor:preview.preview.ownershipCursor,expectedBasis:preview.preview.basis};
  const commandId=(call:string)=>moduleOwnershipMainCommandId(seed.entry.id,{kind:'main_agent',rootSessionId:task.taskId,scopeId,runId,agentInstanceId:main.agentInstanceId,agentSessionId:main.agentSessionId,toolName:'cbim_module_owner_change_commit',toolCallId:call});
  return {...f,...seed,workspace,service,dispatch,task,identity,binding,port,tools,input,commandId};
}

it('main tool explicitly adopts a new module source without changing its owner and keeps source-aware pages distinct',async()=>{
  const f=await setup(),assigned=decoded(await f.tools.call('cbim_module_owner_change_commit',f.input,signal(),'assign-source'));
  const first=await f.service.get({workspaceId:f.identity.workspaceId,instanceId:f.workspace.instanceId,moduleId:f.moduleId});
  const before=await f.workspace.snapshot();await f.workspace.commit(request(before,[{path:'.cbim/.cbimignore',text:f.moduleId+'/\n'}]));
  await f.workspace.commit(request(await f.workspace.snapshot(),[{path:'.cbim/.cbimignore',text:null}]));
  const current=await f.service.get({workspaceId:f.identity.workspaceId,instanceId:f.workspace.instanceId,moduleId:f.moduleId});
  expect(current.basis.knowledgeRevision).toBe(first.basis.knowledgeRevision);expect(current.basis.sourceCursor).not.toEqual(first.basis.sourceCursor);expect(current.view.sourceStatus?.status).toBe('retired');
  await expect(f.service.list({workspaceId:f.identity.workspaceId,instanceId:f.workspace.instanceId,expectedReadBasis:first.basis})).rejects.toMatchObject({code:'OWNERSHIP_REGISTRY_STALE'});
  const change={kind:'adopt_source' as const,moduleId:f.moduleId,expectedBinding:{bindingId:assigned.receipt.bindingId,revision:assigned.receipt.revision,ownerMemberId:assigned.receipt.ownerMemberId},reason:'Explicitly adopt the new source generation'};
  const preview=decoded(await f.tools.call('cbim_module_owner_change_preview',{change},signal())).preview;
  const result=decoded(await f.tools.call('cbim_module_owner_change_commit',{change,expectedOwnershipCursor:preview.ownershipCursor,expectedBasis:preview.basis},signal(),'adopt-source'));
  expect(result.receipt.action).toBe('adopt_source');expect(result.receipt.ownerMemberId).toBe(assigned.receipt.ownerMemberId);expect(result.receipt.bindingId).toBe(assigned.receipt.bindingId);
  expect((await f.service.get({workspaceId:f.identity.workspaceId,instanceId:f.workspace.instanceId,moduleId:f.moduleId})).view.sourceStatus?.status).toBe('current');
});

it('main tools discover real member summaries and module ownership without returning capability bodies',async()=>{
  const f=await setup(),members=decoded(await f.tools.call('cbim_module_owner_inspect',{members:true,limit:1},signal())),page=members.memberPage;
  expect(page.items[0].memberId).toBe(f.first.receipt.memberId);expect(JSON.stringify(page)).not.toContain('effectiveSkills');expect(page.items[0]).not.toHaveProperty('adoption');
  const next=decoded(await f.tools.call('cbim_module_owner_inspect',{members:true,offset:1,limit:1,expectedRegistryCursor:page.registryCursor},signal()));expect(next.memberPage.items[0].memberId).toBe(f.second.receipt.memberId);
  const modules=decoded(await f.tools.call('cbim_module_owner_inspect',{moduleIds:[f.moduleId]},signal()));expect(modules.page.items[0].binding).toBeNull();
  // 未绑定时同时报告责任缺口和待核实的模型，工具层仍不得返回能力正文或凭据。
  expect(modules.execution.groups).toEqual([{moduleIds:[f.moduleId],execution:'main',agentId:'cbim:main',issues:[]}]);
  for(const privateField of ['effectiveSkills','apiKey','baseUrl','principles'])expect(JSON.stringify(modules)).not.toContain(privateField);
  const metadata=f.tools.list();expect(metadata).toHaveLength(4);for(const tool of metadata){expect(tool.version).toBe(1);expect(tool.outputSchema).toBeDefined();expect(tool.cancellation.mode).toBe('preflight_only')}
});

it('raw identity fields are rejected before a domain call, and a wrong current instance cannot pass output validation',async()=>{
  const f=await setup(),inspect=vi.fn(f.port.inspect),tools=new ModuleOwnershipTools({...f.port,inspect},f.binding);
  await expect(tools.call('cbim_module_owner_inspect',{members:true,workspaceId:f.identity.workspaceId},signal())).rejects.toMatchObject({code:'OWNERSHIP_INPUT'});expect(inspect).not.toHaveBeenCalled();
  const preview:ModuleOwnershipToolsPort['preview']=async(input,s)=>{const value=await f.port.preview(input,s) as {preview:{identity:{instanceId:string}}};value.preview.identity.instanceId=randomUUID();return value};
  await expect(new ModuleOwnershipTools({...f.port,preview},f.binding).call('cbim_module_owner_change_preview',{change:f.input.change},signal())).rejects.toMatchObject({code:'TOOL_OUTPUT_INVALID'});
});

it('output encoding happens once and does not reexecute a real query',async()=>{
  const f=await setup();let encoded=0,calls=0;
  const inspect:ModuleOwnershipToolsPort['inspect']=async(input,s)=>{calls++;const value=await f.port.inspect(input,s);return {toJSON(){encoded++;return value}}};
  const result=decoded(await new ModuleOwnershipTools({...f.port,inspect},f.binding).call('cbim_module_owner_inspect',{members:true},signal()));
  expect(result.memberPage.total).toBe(2);expect(calls).toBe(1);expect(encoded).toBe(1);
});

it('a true persisted commit with aliased input and damaged output fails once and can only be recovered through its original receipt',async()=>{
  const f=await setup(),call='persisted-damaged',original=f.port.commit,calls=vi.fn(async(input:Parameters<typeof original>[0],id:string,s:AbortSignal)=>{
    const value=await original(input,id,s) as {receipt:{ownerMemberId:string}};
    input.change.nextOwner!.memberId=f.second.receipt.memberId;value.receipt.ownerMemberId=f.second.receipt.memberId;return value;
  });
  const tools=new ModuleOwnershipTools({...f.port,commit:calls},f.binding);
  await expect(tools.call('cbim_module_owner_change_commit',f.input,signal(),call)).rejects.toMatchObject({code:'TOOL_OUTPUT_INVALID',message:expect.stringContaining(f.commandId(call))});
  expect(calls).toHaveBeenCalledTimes(1);expect(f.input.change.nextOwner.memberId).toBe(f.first.receipt.memberId);
  const recovered=decoded(await f.tools.call('cbim_module_owner_receipt',{commandId:f.commandId(call)},signal()));expect(recovered.receipt.ownerMemberId).toBe(f.first.receipt.memberId);
  const journal=await moduleOwnershipJournal(f.user,f.identity.workspaceId);expect(journal.records.filter(record=>record.body.command.commandId.startsWith('module-ownership-'))).toHaveLength(1);
});

it('a stop after a genuine persisted commit preserves its original receipt rather than pretending rejection',async()=>{
  const f=await setup(),controller=new AbortController(),call='stop-after-save';
  const commit:ModuleOwnershipToolsPort['commit']=async(input,id,s)=>{const value=await f.port.commit(input,id,s);controller.abort();return value};
  await expect(new ModuleOwnershipTools({...f.port,commit},f.binding).call('cbim_module_owner_change_commit',f.input,controller.signal,call)).rejects.toMatchObject({code:'OWNERSHIP_UNKNOWN',message:expect.stringContaining(f.commandId(call))});
  expect(decoded(await f.tools.call('cbim_module_owner_receipt',{commandId:f.commandId(call)},signal())).status).toBe('recorded');
});

it('receipt lookup allows original scope history but rejects another root and never infers success from current relation',async()=>{
  const f=await setup(),call='known';await f.tools.call('cbim_module_owner_change_commit',f.input,signal(),call);
  const sameRoot=new ModuleOwnershipTools(f.port,{...f.binding,instanceId:'new-query-instance',scopeId:'new-query-scope',runId:'new-query-run'});
  expect(decoded(await sameRoot.call('cbim_module_owner_receipt',{commandId:f.commandId(call)},signal())).status).toBe('recorded');
  expect(decoded(await f.tools.call('cbim_module_owner_receipt',{commandId:randomUUID()},signal())).status).toBe('unknown');
  const another=new ModuleOwnershipTools(f.port,{...f.binding,rootSessionId:'another-root'});
  await expect(another.call('cbim_module_owner_receipt',{commandId:f.commandId(call)},signal())).rejects.toMatchObject({code:'TOOL_OUTPUT_INVALID'});
});

it('knowledge authorization is exact: read denies, ask uses real approval, execute permits only fixed registered effects',async()=>{
  const workspaceId='workspace',call={id:'call',name:'cbim_module_owner_change_commit',input:{}},tool={native:false,effects:['knowledge-write'] as const,scope:{kind:'knowledge' as const,workspaceId}},approve=vi.fn(async()=>({allow:true})),guard=vi.fn(async()=>({allow:true}));
  expect((await authorizeRunTool(call,tool,{workspaceId,permission:'read',approve,guard})).allow).toBe(false);expect(approve).not.toHaveBeenCalled();
  expect((await authorizeRunTool(call,tool,{workspaceId,permission:'ask',approve,guard})).allow).toBe(true);expect(approve).toHaveBeenCalledTimes(1);
  for(const bad of [{...tool,effects:['read'] as const},{...tool,native:true},{...tool,scope:{kind:'knowledge' as const,workspaceId:'other'}}])expect((await authorizeRunTool(call,bad,{workspaceId,permission:'execute',approve,guard})).allow).toBe(false);
  expect((await authorizeRunTool({...call,name:'cbim_module_owner_fake'},tool,{workspaceId,permission:'execute',guard})).allow).toBe(false);
  for(const [name,effect] of Object.entries(moduleOwnershipToolEffects))expect((await authorizeRunTool({...call,name},{...tool,effects:[effect]},{workspaceId,permission:'execute',guard})).allow).toBe(true);
});

it('control-plane exception never clears business work for ordinary or malformed knowledge writes',()=>{
  const receipt=toolReceipt({workspaceId:'workspace',taskId:'root',runId:'run'},{id:'call',name:'cbim_module_owner_change_commit',input:{}},{allow:true,effects:['knowledge-write'],scope:{kind:'knowledge',workspaceId:'workspace'}},'succeeded',jsonToolResult('cbim_module_owner_change_commit',{recorded:true}));
  expect(isModuleOwnershipControlReceipt(receipt,'workspace')).toBe(true);
  for(const bad of [{...receipt,toolName:'cbim_knowledge_commit'},{...receipt,toolName:'cbim_module_owner_fake'},{...receipt,effects:['knowledge-write','read'] as const},{...receipt,scope:{kind:'knowledge' as const,workspaceId:'other'}}])expect(isModuleOwnershipControlReceipt(bad,'workspace')).toBe(false);
});
