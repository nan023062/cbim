import {afterEach,expect,it,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {FileDispatchStore} from '../src/logic/dispatch/storage/dispatch-store';
import {hash} from '../src/core/platform/node/serialization';
import {summarizeWorkspaceMember,type WorkspaceMember,type WorkspaceMemberChange,type WorkspaceMemberChangeInput,type WorkspaceMemberModelSnapshot} from '../src/logic/team/rules/workspace-member';
import {workspaceMemberCapabilityHash,workspaceMemberCommand,workspaceMemberHash,workspaceMemberModelHash,workspaceMemberPreviewBasis,workspaceMemberProposed,workspaceMemberReceipt} from '../src/logic/team/rules/workspace-member-rules';
import {moduleOwnershipChangeInputSchema,moduleOwnershipChangeSchema,moduleOwnershipCommitInputSchema,moduleOwnershipDetailSchema,moduleOwnershipLimits,moduleOwnershipPageSchema,moduleOwnershipPreviewSchema,moduleOwnershipReceiptSchema,moduleOwnershipViewSchema,summarizeModuleOwnershipChange,type ModuleOwnershipActor,type ModuleOwnershipChange,type ModuleOwnershipMainActor} from '../src/logic/workspace/rules/module-ownership';
import {moduleOwnershipBasis,moduleOwnershipCanonical,moduleOwnershipCommand,moduleOwnershipHash,moduleOwnershipMainCommandId,moduleOwnershipReceipt} from '../src/logic/workspace/rules/module-ownership-rules';
import {moduleOwnershipImpact,projectModuleOwnershipMutation,checkModuleOwnershipActor} from '../src/logic/tasks/rules/module-ownership-invariants';
import {projectWorkspaceMemberMutation} from '../src/logic/tasks/rules/workspace-member-invariants';
import {applyGraphBatch} from '../src/logic/tasks/rules/graph-reducer';
import type {DispatchState,DispatchMutation} from '../src/logic/dispatch/rules/dispatch-storage';
import type {TaskNode,GraphEventBatch,AgentRef} from '../src/logic/tasks/rules/graph-types';

const workspaceId='ownership-workspace',instanceId=randomUUID(),at='2026-11-08T01:00:00.000Z',moduleId='.cbim/workspace/game';
const desktop:ModuleOwnershipActor={kind:'local_desktop',interaction:'explicit_submit'};
const model:WorkspaceMemberModelSnapshot={id:randomUUID(),name:'明确模型',api:'openai-completions',baseUrl:'http://127.0.0.1:1/v1',auth:'none',model:'local',contextWindow:32000,maxTokens:2048,reasoning:false};
const capability={workspaceId,teamId:'.cbim/team',agentId:'.cbim/team/dev',name:'开发能力',knowledgeRevision:'knowledge-1',source:'workspace' as const,principles:'保留真实原则',effectiveSkills:[]};
const empty=():DispatchState=>({workspaceId,members:[],sessions:[],graphs:[],outbox:[]});
function memberEvent(state:DispatchState,change?:WorkspaceMemberChangeInput):WorkspaceMemberChange{
  const requestChange=change??{kind:'register',agentId:capability.agentId,name:'岗位',position:'项目实现',adaptation:{instructions:'',references:[]},runtimePolicy:{profileId:model.id,modelId:model.model},reason:'明确登记'} as WorkspaceMemberChangeInput;
  const old=requestChange.kind==='register'?undefined:state.workspaceMembers!.find(item=>item.memberId===requestChange.memberId)!;
  let proposed=old?workspaceMemberProposed(old):{name:'岗位',position:'项目实现',adaptation:{instructions:'',references:[]},state:'active' as const,capability:{configuration:capability,capabilityHash:workspaceMemberCapabilityHash(capability)},runtimePolicy:{profileId:model.id,modelId:model.model,configurationHash:workspaceMemberModelHash(model),snapshot:model}};
  if(requestChange.kind==='state')proposed={...proposed,state:requestChange.nextState};
  if(requestChange.kind==='update')proposed={...proposed,...requestChange.patch,runtimePolicy:proposed.runtimePolicy};
  const request={workspaceId,instanceId,commandId:randomUUID(),change:requestChange,expectedRegistryCursor:state.registryCursor??null,expectedBasis:workspaceMemberPreviewBasis({workspaceId,change:requestChange,registryCursor:state.registryCursor??null,previousMember:old,proposed})};
  const next:WorkspaceMember={workspaceId,memberId:old?.memberId??randomUUID(),revision:(old?.revision??0)+1,name:proposed.name,position:proposed.position,adaptation:proposed.adaptation,state:proposed.state,adoption:old?.adoption??{captureId:randomUUID(),capturedAt:at,knowledgeRevision:capability.knowledgeRevision,capabilityHash:proposed.capability.capabilityHash,configuration:capability},runtimePolicy:proposed.runtimePolicy,createdAt:old?.createdAt??at,updatedAt:at};
  return {version:1,request,changeId:randomUUID(),registryCursor:{kind:'workspace_registry',workspaceId,streamId:state.registryCursor?.streamId??randomUUID(),seq:(state.registryCursor?.seq??0)+1},previousRevision:old?.revision??0,previousMemberHash:old?workspaceMemberHash(old):null,next,actor:desktop as {kind:'local_desktop';interaction:'explicit_submit'},committedAt:at};
}
const memberMutation=(e:WorkspaceMemberChange):DispatchMutation=>({workspaceMemberChanges:[e],receipt:workspaceMemberReceipt(e)});
const memberAdvance=(state:DispatchState,e:WorkspaceMemberChange):DispatchState=>({...state,...projectWorkspaceMemberMutation(state,memberMutation(e),workspaceMemberCommand(e.request))});
function seeded(){let state=empty();for(let i=0;i<2;i++)state=memberAdvance(state,memberEvent(state));return state}
function ownershipEvent(state:DispatchState,nextMemberId:string|null=state.workspaceMembers![0].memberId,actor:ModuleOwnershipActor=desktop,target=moduleId):ModuleOwnershipChange{
  const previous=state.moduleOwnerships?.find(item=>item.moduleId===target)??null,oldOwner=state.workspaceMembers?.find(item=>item.memberId===previous?.ownerMemberId),owner=state.workspaceMembers?.find(item=>item.memberId===nextMemberId);
  const change={moduleId:target,expectedBinding:previous?{bindingId:previous.bindingId,revision:previous.revision,ownerMemberId:previous.ownerMemberId}:null,nextOwner:owner?{memberId:owner.memberId,expectedRevision:owner.revision}:null,reason:'明确调整当前负责人'};
  const observedModule={knowledgeRevision:'knowledge-current',definitionHash:hash('真实定义'),observedAt:at},impact=moduleOwnershipImpact(state,target),cursor=state.ownershipCursor??null;
  const basis=moduleOwnershipBasis({workspaceId,change,ownershipCursor:cursor,previous,...(oldOwner?{previousOwner:summarizeWorkspaceMember(oldOwner)}:{}),...(owner?{nextOwner:summarizeWorkspaceMember(owner),observedModule}:{}),impact});
  const request={workspaceId,instanceId,commandId:actor.kind==='main_agent'?moduleOwnershipMainCommandId(workspaceId,actor):randomUUID(),change,expectedOwnershipCursor:cursor,expectedBasis:basis},changeId=randomUUID();
  return {version:1,request,actor,changeId,ownershipCursor:{kind:'module_ownership',workspaceId,streamId:cursor?.streamId??randomUUID(),seq:(cursor?.seq??0)+1},previousRevision:previous?.revision??0,previousBindingHash:previous?moduleOwnershipHash(previous):null,next:{workspaceId,bindingId:previous?.bindingId??randomUUID(),moduleId:target,revision:(previous?.revision??0)+1,ownerMemberId:nextMemberId,observedModule:owner?observedModule:previous!.observedModule,createdAt:previous?.createdAt??at,updatedAt:at,lastChangeId:changeId},impact,committedAt:at};
}
const mutation=(event:ModuleOwnershipChange):DispatchMutation=>({ownershipChanges:[event],receipt:moduleOwnershipReceipt(event)});
const advance=(state:DispatchState,event:ModuleOwnershipChange):DispatchState=>({...state,...projectModuleOwnershipMutation(state,mutation(event),moduleOwnershipCommand(event.request,event.actor))});
const commit=(store:FileDispatchStore,event:ModuleOwnershipChange)=>store.transact(moduleOwnershipCommand(event.request,event.actor),async()=>mutation(event));
const main:AgentRef={agentId:'cbim:main',agentInstanceId:'main-instance',agentSessionId:'main-task-channel',name:'主调度'};
const actor:ModuleOwnershipMainActor={kind:'main_agent',rootSessionId:'root',scopeId:'scope',agentInstanceId:main.agentInstanceId,agentSessionId:'main-conversation',runId:'main-run',toolCallId:'ownership-call',toolName:'cbim_module_owner_change_commit'};
function mainMutation():DispatchMutation{
  const identity={workspaceId,rootSessionId:actor.rootSessionId};
  const batch:GraphEventBatch={version:1,identity,streamId:'graph-stream',seq:1,eventId:'event-main',commandId:'setup-main',cause:'graph.created',committedAt:at,changes:[{type:'root.upserted',root:{kind:'session-root',nodeId:'session:root',identity,agent:main,revision:1,createdAt:at}},{type:'agent.upserted',agent:{agentInstanceId:main.agentInstanceId,agentId:main.agentId,name:main.name,revision:1,state:'idle',waitingTaskIds:[]}}]};
  return {members:[{workspaceId,teamId:'.cbim/team',agentId:main.agentId,agentInstanceId:main.agentInstanceId,mainRootSessionId:'root',leaseEpoch:0,configurationRevision:'knowledge-1',agentSessionIds:[main.agentSessionId,actor.agentSessionId],activity:'idle',waitingTaskIds:[],communicatingMessageIds:[]}],sessions:[{workspaceId,teamId:'.cbim/team',agentId:main.agentId,agentInstanceId:main.agentInstanceId,agentSessionId:main.agentSessionId,rootSessionId:'root',purpose:'task'},{workspaceId,teamId:'.cbim/team',agentId:main.agentId,agentInstanceId:main.agentInstanceId,agentSessionId:actor.agentSessionId,rootSessionId:'root',purpose:'conversation'}],batch,scopes:[{scopeId:'scope',workspaceId,rootSessionId:'root',status:'active',createdAt:at,runTracking:{version:1,mainRunIds:[actor.runId]}}],receipt:{root:'root'}};
}
function mainState(state=seeded()):DispatchState{const m=mainMutation();return {...state,members:m.members!,sessions:m.sessions!,graphs:[applyGraphBatch(undefined,m.batch!)],scopes:m.scopes}}
function task(id:string):TaskNode{return {kind:'task',nodeId:'task:'+id,taskId:id,identity:{workspaceId,rootSessionId:'root'},requester:main,assignee:{agentId:capability.agentId,agentInstanceId:'old-executor',agentSessionId:'old-channel',name:'旧协议执行者'},modules:[{moduleId,name:'game',knowledgeRevision:'k',maintenanceBindingId:'m',maintainerPersonIds:['person'],workflow:{kind:'general',id:'general',version:'1',reason:'通用'}}],goal:'旧任务',acceptance:[{id:'a',text:'实际验收'}],revision:1,planRevision:1,status:'queued',awaitedChildren:[],runIds:[],createdAt:at,updatedAt:at}}
async function setup(){const directory=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-ownership-core-')),store=new FileDispatchStore(directory,workspaceId);return {store,directory,file:path.join(directory,'dispatch.jsonl'),cleanup:async()=>{await store.close();if(!path.resolve(directory).startsWith(path.join(os.tmpdir(),'cbim-ownership-core-')))throw Error('unsafe temp');await fs.rm(directory,{recursive:true,force:true})}}}
async function registerTwo(store:FileDispatchStore){for(let i=0;i<2;i++){const event=memberEvent(await store.read());await store.transact(workspaceMemberCommand(event.request),async()=>memberMutation(event))}}
afterEach(()=>vi.restoreAllMocks());

it('请求不能自报actor/来源，空变更与伪造来源连续性严格拒绝',()=>{
  const e=ownershipEvent(seeded());expect(moduleOwnershipCommitInputSchema.safeParse(e.request).success).toBe(true);
  for(const extra of [{actor:desktop},{observedModule:e.next.observedModule},{generationId:randomUUID()},{permission:'execute'}])expect(moduleOwnershipCommitInputSchema.safeParse({...e.request,...extra}).success).toBe(false);
  expect(moduleOwnershipChangeInputSchema.safeParse({...e.request.change,nextOwner:null}).success).toBe(false);
  const view={moduleId,binding:null,status:'unassigned',source:{status:'observed',knowledgeRevision:'k',definitionHash:hash('source')}};
  expect(moduleOwnershipViewSchema.safeParse(view).success).toBe(true);expect(moduleOwnershipViewSchema.safeParse({...view,source:{...view.source,status:'same'}}).success).toBe(false);
});

it('A到B到解除再A保留binding并连续升版，岗位和旧审计原样不动',()=>{
  let state=seeded();const before=structuredClone(state),a=state.workspaceMembers![0].memberId,b=state.workspaceMembers![1].memberId;let binding='';
  for(const next of [a,b,null,a]){const event=ownershipEvent(state,next),old=structuredClone(state);state=advance(state,event);binding ||=event.next.bindingId;expect(event.next.bindingId).toBe(binding);expect(state.ownershipChanges!.slice(0,-1)).toEqual(old.ownershipChanges??[]);expect(state.ownershipCursor!.seq).toBe(event.next.revision)}
  expect(state.workspaceMembers).toEqual(before.workspaceMembers);expect(state.registryCursor).toEqual(before.registryCursor);expect(state.graphs).toEqual(before.graphs);expect(state.moduleOwnerships).toHaveLength(1);expect(state.moduleOwnerships![0]).toMatchObject({ownerMemberId:a,revision:4});
});

it('暂停保留责任，有引用不可退休；解除不要求当前能力或模块来源存在',()=>{
  let state=seeded();const a=state.workspaceMembers![0].memberId;state=advance(state,ownershipEvent(state,a));const binding=structuredClone(state.moduleOwnerships![0]);
  const suspended=memberEvent(state,{kind:'state',memberId:a,expectedRevision:1,nextState:'suspended',reason:'暂缓'});state=memberAdvance(state,suspended);expect(state.moduleOwnerships![0]).toEqual(binding);
  const retire=()=>memberEvent(state,{kind:'state',memberId:a,expectedRevision:2,nextState:'retired',reason:'结束岗位'});expect(()=>memberAdvance(state,retire())).toThrow(/先明确解除/);
  state=advance(state,ownershipEvent(state,null));expect(state.moduleOwnerships![0].observedModule).toEqual(binding.observedModule);state=memberAdvance(state,retire());expect(state.workspaceMembers![0].state).toBe('retired');
  expect(()=>advance(state,ownershipEvent(state,a))).toThrow(/只有启用岗位/);
});

it('预览依据忽略新观察时钟但覆盖定义、成员与相关任务变化',()=>{
  let state=mainState();const e=ownershipEvent(state),owner=state.workspaceMembers![0];
  const facts={workspaceId,change:e.request.change,ownershipCursor:null,previous:null,nextOwner:summarizeWorkspaceMember(owner),observedModule:e.next.observedModule,impact:e.impact};
  expect(moduleOwnershipBasis({...facts,observedModule:{...e.next.observedModule,observedAt:'2026-11-08T01:00:01.000Z'}})).toBe(e.request.expectedBasis);
  expect(moduleOwnershipBasis({...facts,observedModule:{...e.next.observedModule,definitionHash:hash('changed')}})).not.toBe(e.request.expectedBasis);
  state.graphs[0].tasks.push(task('legacy'));expect(()=>advance(state,e)).toThrow(/任务影响/);
  const next=ownershipEvent(state);state=memberAdvance(state,memberEvent(state,{kind:'update',memberId:owner.memberId,expectedRevision:1,patch:{name:'改名'},reason:'明确改名'}));expect(()=>advance(state,next)).toThrow(/岗位版本/);
});

it('责任事务拒绝直接头、混合空集合、错命令和伪回执，领域坏审计不能靠重算basis洗白',()=>{
  const state=seeded(),event=ownershipEvent(state),command=moduleOwnershipCommand(event.request,event.actor),valid=mutation(event);
  for(const bad of [{...valid,moduleOwnerships:[event.next]},{...valid,ownershipCursor:event.ownershipCursor},{...valid,workspaceMemberChanges:[]},{...valid,batch:{}},{...valid,runs:[]},{...valid,members:[]},{...valid,scopes:[]},{...valid,ownershipChanges:[]},{receipt:valid.receipt}])expect(()=>projectModuleOwnershipMutation(state,bad as DispatchMutation,command)).toThrow();
  expect(()=>projectModuleOwnershipMutation(state,valid,{...command,fingerprint:'forged'})).toThrow(/命令/);
  expect(()=>projectModuleOwnershipMutation(state,{...valid,receipt:{...moduleOwnershipReceipt(event),ownerMemberId:randomUUID()}},command)).toThrow(/回执/);
  const modifications=[(e:ModuleOwnershipChange)=>{e.actor={kind:'main_agent'} as ModuleOwnershipActor},(e:ModuleOwnershipChange)=>{e.next.revision=4},(e:ModuleOwnershipChange)=>{e.next.lastChangeId=randomUUID()},(e:ModuleOwnershipChange)=>{e.previousBindingHash=hash('fake')},(e:ModuleOwnershipChange)=>{e.next.observedModule.observedAt='2026-12-01T00:00:00.000Z'},(e:ModuleOwnershipChange)=>{e.request.change.nextOwner!.expectedRevision=99}];
  for(const modify of modifications){const bad=structuredClone(event);modify(bad);expect(()=>advance(state,bad)).toThrow()}
});

it('真实主来源固定运行命令，当前scope、最新run和conversation通道均不可冒用',()=>{
  const state=mainState(),event=ownershipEvent(state,undefined,actor);expect(()=>advance(state,event)).not.toThrow();
  expect(moduleOwnershipMainCommandId(workspaceId,{...actor})).toBe(event.request.commandId);
  for(const change of [{scopeId:'other'},{runId:'old-run'},{agentSessionId:main.agentSessionId},{agentInstanceId:'other'},{rootSessionId:'other'}])expect(()=>checkModuleOwnershipActor(state,{...actor,...change})).toThrow();
  const closed=structuredClone(state);closed.scopes![0].status='closed';expect(()=>checkModuleOwnershipActor(closed,actor)).toThrow();
  const newer=structuredClone(state);newer.scopes![0].runTracking!.mainRunIds.push('new-run');expect(()=>checkModuleOwnershipActor(newer,actor)).toThrow();
  const bad=structuredClone(event);bad.request.commandId=randomUUID();expect(()=>advance(state,bad)).toThrow(/命令/);
});

it('影响按真实模块关联旧任务而非岗位角色，领取变化和恢复预约必须改变digest',()=>{
  const state=mainState(),a=task('a'),b=task('b');state.graphs[0].tasks.push(a,b);b.status='failed';
  const before=moduleOwnershipImpact(state,moduleId);expect(before).toMatchObject({total:2,counts:{unclaimed:1,terminal:1,inFlight:0,checkpointed:0,other:0}});
  state.workspaceMembers![0].name='不改变任务关联';expect(moduleOwnershipImpact(state,moduleId)).toEqual(before);
  a.activeRunId='started';expect(moduleOwnershipImpact(state,moduleId)).toMatchObject({counts:{unclaimed:0,inFlight:1}});expect(moduleOwnershipImpact(state,moduleId).digest).not.toBe(before.digest);
  a.activeRunId=undefined;a.status='checkpointed';a.runIds=['old'];expect(moduleOwnershipImpact(state,moduleId).counts.checkpointed).toBe(1);
  expect(moduleOwnershipImpact(state,'.cbim/workspace/other').total).toBe(0);
});

it('查询分页、历史、负责人和回执无法拼接不同工作区或伪造完整历史',()=>{
  const state=seeded(),event=ownershipEvent(state),next=advance(state,event),owner=state.workspaceMembers![0];
  const view={moduleId,binding:event.next,owner:summarizeWorkspaceMember(owner),status:'assigned',source:{status:'same',knowledgeRevision:'k',definitionHash:event.next.observedModule.definitionHash}};
  const base={identity:{workspaceId,instanceId},readOnly:true,checkedAt:at,basis:{ownershipCursor:event.ownershipCursor,memberRegistryCursor:state.registryCursor,knowledgeRevision:'k'}};
  const detail={...base,view,history:{total:1,truncated:false,items:next.ownershipChanges!.map(summarizeModuleOwnershipChange)}};
  expect(moduleOwnershipDetailSchema.safeParse(detail).success).toBe(true);
  for(const history of [{...detail.history,total:2},{...detail.history,truncated:true},{...detail.history,items:[]}])expect(moduleOwnershipDetailSchema.safeParse({...detail,history}).success).toBe(false);
  expect(moduleOwnershipPageSchema.safeParse({...base,offset:1,total:2,items:[],nextOffset:1}).success).toBe(false);
  expect(moduleOwnershipReceiptSchema.safeParse({...moduleOwnershipReceipt(event),action:'replace'}).success).toBe(false);
  const preview={...base,change:event.request.change,ownershipCursor:null,basis:event.request.expectedBasis,previous:null,nextOwner:summarizeWorkspaceMember(owner),observedModule:event.next.observedModule,impact:event.impact,issues:[]};
  expect(moduleOwnershipPreviewSchema.safeParse(preview).success).toBe(true);expect(moduleOwnershipPreviewSchema.safeParse({...preview,nextOwner:{...summarizeWorkspaceMember(owner),state:'retired'}}).success).toBe(false);
});

it('真实Store旧空兼容、单条追加、原回执优先与重开均不创建执行或重写字节',async()=>{
  const f=await setup();try{
    const initial=await f.store.read();expect(initial.moduleOwnerships).toEqual([]);expect(initial.ownershipCursor).toBeNull();await expect(fs.stat(f.file)).rejects.toMatchObject({code:'ENOENT'});
    await registerTwo(f.store);const before=await f.store.read(),event=ownershipEvent(before),command=moduleOwnershipCommand(event.request,event.actor),prepare=vi.fn(async()=>mutation(event));
    const replies=await Promise.all([f.store.transact(command,prepare),f.store.transact(command,prepare)]);expect(prepare).toHaveBeenCalledTimes(1);expect(replies[0]).toEqual(replies[1]);
    const next=await f.store.read();for(const key of ['graphs','members','sessions','runs','scopes','outbox','workspaceMembers','registryCursor'] as const)expect(next[key]).toEqual(before[key]);
    const bytes=await fs.readFile(f.file);await f.store.close();const reader=new FileDispatchStore(f.directory,workspaceId);try{expect((await reader.commandReceipt(command.commandId))?.receipt).toEqual(replies[0]);expect(await reader.transact(command,async()=>{throw Error('不能重放')})).toEqual(replies[0]);expect(await fs.readFile(f.file)).toEqual(bytes);expect((await reader.read()).moduleOwnerships).toEqual(next.moduleOwnerships)}finally{await reader.close()}
  }finally{await f.cleanup()}
});

it('Store指派与退休同队列两向竞争：先成功者阻止另一方，解除后允许退休',async()=>{
  for(const retireFirst of [false,true]){const f=await setup();try{
    await registerTwo(f.store);const state=await f.store.read(),a=state.workspaceMembers![0],assign=ownershipEvent(state),retire=memberEvent(state,{kind:'state',memberId:a.memberId,expectedRevision:a.revision,nextState:'retired',reason:'明确退休'});
    const retirement=()=>f.store.transact(workspaceMemberCommand(retire.request),async()=>memberMutation(retire));
    const operations=retireFirst?[retirement(),commit(f.store,assign)]:[commit(f.store,assign),retirement()];const result=await Promise.allSettled(operations);expect(result[0].status).toBe('fulfilled');expect(result[1].status).toBe('rejected');
    if(!retireFirst){expect((result[1] as PromiseRejectedResult).reason).toMatchObject({code:'MEMBER_OWNERSHIP_ACTIVE'});await commit(f.store,ownershipEvent(await f.store.read(),null));const current=await f.store.read(),again=memberEvent(current,{kind:'state',memberId:a.memberId,expectedRevision:a.revision,nextState:'retired',reason:'解除后退休'});await f.store.transact(workspaceMemberCommand(again.request),async()=>memberMutation(again));}
  }finally{await f.cleanup()}}
});

it('并发更换只一方通过CAS，异参复用命令不新增审计',async()=>{
  const f=await setup();try{
    await registerTwo(f.store);await commit(f.store,ownershipEvent(await f.store.read()));const state=await f.store.read(),replace=ownershipEvent(state,state.workspaceMembers![1].memberId),release=ownershipEvent(state,null);
    const outcomes=await Promise.allSettled([commit(f.store,replace),commit(f.store,release)]);expect(outcomes.map(item=>item.status)).toEqual(['fulfilled','rejected']);expect((await f.store.read()).ownershipChanges).toHaveLength(2);
    const bytes=await fs.readFile(f.file),changed=structuredClone(replace);changed.request.change.reason='另一个原请求';await expect(commit(f.store,changed)).rejects.toMatchObject({code:'COMMAND_ID_CONFLICT'});expect(await fs.readFile(f.file)).toEqual(bytes);
  }finally{await f.cleanup()}
});

it('主actor在真实历史prefix中合法，后来周期关闭重开不反向否定原登记',async()=>{
  const f=await setup();try{
    await registerTwo(f.store);await f.store.transact({commandId:'setup-main',fingerprint:'main'},async()=>mainMutation());const event=ownershipEvent(await f.store.read(),undefined,actor);await commit(f.store,event);
    const scope=(await f.store.read()).scopes![0];await f.store.transact({commandId:'close-main',fingerprint:'close'},async()=>({scopes:[{...scope,status:'closed',outcome:'cancelled',closedAt:at}],receipt:{closed:true}}));const bytes=await fs.readFile(f.file);
    await f.store.close();const reader=new FileDispatchStore(f.directory,workspaceId);try{expect((await reader.read()).scopes![0].status).toBe('closed');expect((await reader.commandReceipt(moduleOwnershipCommand(event.request,event.actor).commandId))?.receipt).toEqual(moduleOwnershipReceipt(event));expect(await fs.readFile(f.file)).toEqual(bytes)}finally{await reader.close()}
  }finally{await f.cleanup()}
});

it('重算日志外层校验和也不能伪造责任头、actor、回执、岗位或混合mutation',async()=>{
  const f=await setup();try{
    await registerTwo(f.store);await commit(f.store,ownershipEvent(await f.store.read()));await f.store.close();const bytes=await fs.readFile(f.file,'utf8'),lines=bytes.trimEnd().split('\n');
    for(const alter of [(b:any)=>{b.mutation.moduleOwnerships=[b.mutation.ownershipChanges[0].next]},(b:any)=>{b.mutation.ownershipChanges[0].next.revision=6},(b:any)=>{b.mutation.ownershipChanges[0].actor={...actor}},(b:any)=>{b.mutation.receipt.bindingHash=hash('fake')},(b:any)=>{b.mutation.members=[]},(b:any)=>{delete b.mutation.ownershipChanges}]){
      const copy=[...lines],last=JSON.parse(copy.pop()!);alter(last.body);last.checksum=hash(JSON.stringify(last.body));copy.push(JSON.stringify(last));await fs.writeFile(f.file,copy.join('\n')+'\n');const reader=new FileDispatchStore(f.directory,workspaceId);try{await expect(reader.read()).rejects.toMatchObject({code:'GRAPH_LOG_CORRUPT'})}finally{await reader.close()}
    }
  }finally{await f.cleanup()}
});

it('写入确认未知时封闭本实例，重开只核完整原事件而不执行回调',async()=>{
  const f=await setup();try{
    await registerTwo(f.store);const event=ownershipEvent(await f.store.read()),original=fs.open.bind(fs);vi.spyOn(fs,'open').mockImplementation((async(...args:any[])=>{const handle=await (original as any)(...args);if(args[0]===f.file&&args[1]==='a')vi.spyOn(handle,'sync').mockRejectedValue(Error('sync lost'));return handle}) as any);
    await expect(commit(f.store,event)).rejects.toMatchObject({code:'GRAPH_STORAGE_FAILED'});vi.restoreAllMocks();await expect(f.store.commandReceipt(moduleOwnershipCommand(event.request,event.actor).commandId)).rejects.toMatchObject({code:'GRAPH_STORAGE_FAILED'});await f.store.close();
    const reader=new FileDispatchStore(f.directory,workspaceId);try{expect((await reader.commandReceipt(moduleOwnershipCommand(event.request,event.actor).commandId))?.receipt).toEqual(moduleOwnershipReceipt(event));expect((await reader.read()).ownershipChanges).toHaveLength(1)}finally{await reader.close()}
  }finally{await f.cleanup()}
});

it('有界协议拒绝超长理由和累计容量，不删除旧责任或事件',()=>{
  const state=seeded(),event=ownershipEvent(state);expect(moduleOwnershipChangeSchema.safeParse({...event,request:{...event.request,change:{...event.request.change,reason:'x'.repeat(2001)}}}).success).toBe(false);
  // 用已发布前态的容量边界输入测拒绝；真实历史合法性另由逐条Store重放测试覆盖。
  const bulky=structuredClone(event);bulky.request.change.reason='界'.repeat(2000);const bytes=new TextEncoder().encode(JSON.stringify(bulky)).length,total=Math.floor(moduleOwnershipLimits.historyBytes/bytes),history=Array.from({length:total},()=>structuredClone(bulky));
  const head={...state,moduleOwnerships:[event.next],ownershipChanges:history,ownershipCursor:{...event.ownershipCursor,seq:total}},next=ownershipEvent(head,state.workspaceMembers![1].memberId);next.request.change.reason=bulky.request.change.reason;
  const owner=state.workspaceMembers![1];next.request.expectedBasis=moduleOwnershipBasis({workspaceId,change:next.request.change,ownershipCursor:head.ownershipCursor,previous:event.next,previousOwner:summarizeWorkspaceMember(state.workspaceMembers![0]),nextOwner:summarizeWorkspaceMember(owner),observedModule:next.next.observedModule,impact:next.impact});
  expect(()=>advance(head,next)).toThrow(/累计超过容量/);expect(head.ownershipChanges).toHaveLength(total);
});
