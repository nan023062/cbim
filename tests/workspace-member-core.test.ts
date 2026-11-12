import {afterEach,expect,it,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {workspaceMemberSchema,workspaceMemberModelSnapshotSchema,workspaceMemberChangeInputSchema,workspaceMemberCommitInputSchema,workspaceMemberReceiptSchema,workspaceMemberListInputSchema,workspaceMemberListSchema,workspaceMemberCurrentDiffSchema,workspaceMemberCapabilitySchema,workspaceMemberChangeSchema,workspaceMemberLimits,type WorkspaceMember,type WorkspaceMemberChange,type WorkspaceMemberChangeInput,type WorkspaceMemberProposed,type WorkspaceMemberModelSnapshot} from '../src/backend/core/team/workspace-member';
import {workspaceMemberModelHash,workspaceMemberCapabilityHash,workspaceMemberHash,workspaceMemberCommand,workspaceMemberPreviewBasis,workspaceMemberProposed,workspaceMemberReceipt,workspaceMemberChangedFields,applyWorkspaceMemberChange} from '../src/backend/core/team/workspace-member-rules';
import {projectWorkspaceMemberMutation} from '../src/backend/core/tasks/workspace-member-invariants';
import {FileDispatchStore} from '../src/backend/main/dispatch-storage/dispatch-store';
import {hash} from '../src/backend/core/foundation/serialization';
import type {DispatchState,DispatchMutation} from '../src/backend/core/dispatch/dispatch-storage';

const workspaceId='_workspace',instanceId=randomUUID(),time='2026-11-07T12:00:00.000Z';
const model:WorkspaceMemberModelSnapshot={id:randomUUID(),name:'本地模型',api:'openai-completions',baseUrl:'http://127.0.0.1:12345/v1',auth:'none',model:'configured',contextWindow:32000,maxTokens:2000,reasoning:false};
const configuration={workspaceId,teamId:'.cbim/team',agentId:'.cbim/team/dev',name:'能力',knowledgeRevision:'knowledge-1',source:'workspace' as const,principles:'保留真实原则\n',effectiveSkills:[{skillId:'.cbim/team/shared/check',ownerId:'.cbim/team',inherited:true,content:'真实继承 Skill'}]};
const policy=()=>({profileId:model.id,modelId:model.model,snapshot:structuredClone(model),configurationHash:workspaceMemberModelHash(model)});
const register=():WorkspaceMemberChangeInput=>({kind:'register',agentId:configuration.agentId,name:'项目开发岗位',position:'负责项目实现',adaptation:{instructions:'项目约定',references:['.cbim/workspace/example']},runtimePolicy:{profileId:model.id,modelId:model.model},reason:'用户明确登记岗位'});
const empty=():DispatchState=>({workspaceId,members:[],sessions:[],graphs:[],outbox:[]});
function makeEvent(state:DispatchState,change:WorkspaceMemberChangeInput=register(),overrides?:Partial<WorkspaceMemberProposed>):WorkspaceMemberChange{
  const old=change.kind==='register'?undefined:state.workspaceMembers!.find(item=>item.memberId===change.memberId)!;
  let proposed:WorkspaceMemberProposed=old?workspaceMemberProposed(old):{name:'',position:'',adaptation:{instructions:'',references:[]},state:'active',capability:{configuration:structuredClone(configuration),capabilityHash:workspaceMemberCapabilityHash(configuration)},runtimePolicy:policy()};
  if(change.kind==='register')proposed={...proposed,name:change.name,position:change.position,adaptation:change.adaptation};
  if(change.kind==='update'){const {runtimePolicy:_,...fields}=change.patch;proposed={...proposed,...fields}}
  if(change.kind==='state')proposed.state=change.nextState;
  if(overrides)proposed={...proposed,...overrides};
  const input={workspaceId,instanceId,change,commandId:randomUUID(),expectedRegistryCursor:state.registryCursor??null,expectedBasis:workspaceMemberPreviewBasis({workspaceId,change,registryCursor:state.registryCursor??null,previousMember:old,proposed})};
  const next:WorkspaceMember={workspaceId,memberId:old?.memberId??randomUUID(),revision:(old?.revision??0)+1,name:proposed.name,position:proposed.position,adaptation:structuredClone(proposed.adaptation),state:proposed.state,adoption:old?structuredClone(old.adoption):{captureId:randomUUID(),capturedAt:time,knowledgeRevision:proposed.capability.configuration.knowledgeRevision,capabilityHash:proposed.capability.capabilityHash,configuration:structuredClone(proposed.capability.configuration)},runtimePolicy:structuredClone(proposed.runtimePolicy),createdAt:old?.createdAt??time,updatedAt:time};
  if(change.kind==='adopt'&&change.target==='capability')next.adoption={captureId:randomUUID(),capturedAt:time,knowledgeRevision:proposed.capability.configuration.knowledgeRevision,configuration:structuredClone(proposed.capability.configuration),capabilityHash:proposed.capability.capabilityHash};
  return {version:1,request:input,changeId:randomUUID(),registryCursor:{kind:'workspace_registry',workspaceId,streamId:state.registryCursor?.streamId??randomUUID(),seq:(state.registryCursor?.seq??0)+1},previousRevision:old?.revision??0,previousMemberHash:old?workspaceMemberHash(old):null,next,actor:{kind:'local_desktop',interaction:'explicit_submit'},committedAt:time};
}
const mutation=(event:WorkspaceMemberChange):DispatchMutation=>({workspaceMemberChanges:[event],receipt:workspaceMemberReceipt(event)});
const advance=(state:DispatchState,event:WorkspaceMemberChange):DispatchState=>({...state,...projectWorkspaceMemberMutation(state,mutation(event),workspaceMemberCommand(event.request))});
const update=(member:WorkspaceMember,name:string):WorkspaceMemberChangeInput=>({kind:'update',memberId:member.memberId,expectedRevision:member.revision,patch:{name},reason:'改名'});
async function setup(){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-workspace-member-core-'));const store=new FileDispatchStore(dir,workspaceId);return {dir,store,file:path.join(dir,'dispatch.jsonl'),cleanup:async()=>{await store.close();if(!path.resolve(dir).startsWith(path.join(os.tmpdir(),'cbim-workspace-member-core-')))throw Error('unexpected temp path');await fs.rm(dir,{recursive:true,force:true})}}}
const commit=(store:FileDispatchStore,event:WorkspaceMemberChange)=>store.transact(workspaceMemberCommand(event.request),async()=>mutation(event));
afterEach(()=>vi.restoreAllMocks());

it('strict 公共协议保留实际模型缺省，拒绝凭据、主角色、伪来源与越界参数',()=>{
  const event=makeEvent(empty());expect(workspaceMemberSchema.parse(event.next)).toEqual(event.next);
  expect(workspaceMemberModelSnapshotSchema.parse(model)).not.toHaveProperty('vision');
  for(const key of ['apiKey','encryptedKey','hasKey','defaultModel','enabled'])expect(workspaceMemberModelSnapshotSchema.safeParse({...model,[key]:'secret'}).success).toBe(false);
  for(const value of [{...model,maxTokens:33000},{...model,outputLimit:1000},{...model,workingContextWindow:33000},{...model,baseUrl:'https://secret@example.test'},{...model,baseUrl:'https://example.test?token=secret'}])expect(workspaceMemberModelSnapshotSchema.safeParse(value).success).toBe(false);
  for(const value of [{...configuration,agentId:'cbim:main'},{...configuration,source:'builtin',agentId:'invented'},{...configuration,effectiveSkills:[configuration.effectiveSkills[0],configuration.effectiveSkills[0]]},{...configuration,generation:randomUUID()}])expect(workspaceMemberCapabilitySchema.safeParse(value).success).toBe(false);
  for(const extra of [{actor:event.actor},{next:event.next},{sourceGeneration:randomUUID()}])expect(workspaceMemberCommitInputSchema.safeParse({...event.request,...extra}).success).toBe(false);
  expect(workspaceMemberChangeInputSchema.safeParse({kind:'update',memberId:event.next.memberId,expectedRevision:1,patch:{},reason:'无编辑'}).success).toBe(false);
});

it('两个岗位共用能力仍有不同稳定身份；元信息编辑保留原采纳和模型，顺序不变',()=>{
  const first=makeEvent(empty()),one=advance(empty(),first),second=makeEvent(one),two=advance(one,second),old=structuredClone(two);
  expect(two.workspaceMembers!.map(item=>item.memberId)).toEqual([first.next.memberId,second.next.memberId]);
  const edit=makeEvent(two,update(first.next,'改名后岗位')),next=advance(two,edit);
  expect(next.workspaceMembers![0]).toMatchObject({memberId:first.next.memberId,name:'改名后岗位',revision:2});
  expect(next.workspaceMembers![0].adoption).toEqual(first.next.adoption);expect(next.workspaceMembers![0].runtimePolicy).toEqual(first.next.runtimePolicy);
  expect(next.workspaceMemberChanges!.slice(0,2)).toEqual(old.workspaceMemberChanges);expect(two).toEqual(old);expect(next.registryCursor!.seq).toBe(3);
});

it('规范依据不受对象键序、整库无关revision和时钟影响，冻结明确配置及改动内容',()=>{
  const first=makeEvent(empty()),proposed=workspaceMemberProposed(first.next),input={workspaceId,change:first.request.change,registryCursor:null,proposed};
  expect(workspaceMemberPreviewBasis(input)).toBe(first.request.expectedBasis);
  const copy=structuredClone(input);copy.proposed.capability.configuration.knowledgeRevision='unrelated-knowledge-change';
  expect(workspaceMemberCapabilityHash(copy.proposed.capability.configuration)).toBe(first.next.adoption.capabilityHash);expect(workspaceMemberPreviewBasis(copy)).toBe(first.request.expectedBasis);
  expect(workspaceMemberModelHash({...model,name:'供应商改名'})).not.toBe(workspaceMemberModelHash(model));
  copy.proposed.name='不同岗位';expect(workspaceMemberPreviewBasis(copy)).not.toBe(first.request.expectedBasis);
  expect(workspaceMemberModelHash(Object.fromEntries(Object.entries(model).reverse()) as WorkspaceMemberModelSnapshot)).toBe(workspaceMemberModelHash(model));
});

it('能力采纳只更新原来源；模型采纳只更新原配置，编辑不能暗刷同ID模型',()=>{
  const original=makeEvent(empty()),state=advance(empty(),original),capability={...configuration,knowledgeRevision:'knowledge-2',principles:'新原则'};
  const adopted=makeEvent(state,{kind:'adopt',memberId:original.next.memberId,expectedRevision:1,target:'capability',reason:'明确采纳原则'}, {capability:{configuration:capability,capabilityHash:workspaceMemberCapabilityHash(capability)}});
  const next=advance(state,adopted);expect(next.workspaceMembers![0].runtimePolicy).toEqual(original.next.runtimePolicy);expect(next.workspaceMembers![0].adoption.captureId).not.toBe(original.next.adoption.captureId);
  const snapshot={...model,maxTokens:3000},runtimePolicy={...policy(),snapshot,configurationHash:workspaceMemberModelHash(snapshot)};
  const modelAdopt=makeEvent(next,{kind:'adopt',memberId:original.next.memberId,expectedRevision:2,target:'model',reason:'明确采纳模型'}, {runtimePolicy});expect(advance(next,modelAdopt).workspaceMembers![0].adoption).toEqual(adopted.next.adoption);
  const silent=makeEvent(state,{kind:'update',memberId:original.next.memberId,expectedRevision:1,patch:{runtimePolicy:{profileId:model.id,modelId:model.model}},reason:'试图刷新同模型'}, {runtimePolicy});expect(()=>advance(state,silent)).toThrow(/显式采纳/);
  const foreign=structuredClone(adopted);foreign.next.adoption.configuration.agentId='.cbim/team/other';foreign.next.adoption.capabilityHash=workspaceMemberCapabilityHash(foreign.next.adoption.configuration);expect(()=>advance(state,foreign)).toThrow(/另一能力/);
});

it('暂停和恢复是登记态；退休不可复活或编辑，空改动不制造版本',()=>{
  let state=advance(empty(),makeEvent(empty()));const member=()=>state.workspaceMembers![0];
  const set=(nextState:'active'|'suspended'|'retired')=>makeEvent(state,{kind:'state',memberId:member().memberId,expectedRevision:member().revision,nextState,reason:'状态调整'});
  expect(()=>advance(state,set('active'))).toThrow(/语义变化/);
  state=advance(state,set('suspended'));state=advance(state,set('active'));state=advance(state,set('retired'));
  const frozen=structuredClone(state);expect(()=>advance(state,set('active'))).toThrow(/退休/);expect(()=>advance(state,makeEvent(state,update(member(),'复活名称')))).toThrow(/退休/);expect(state).toEqual(frozen);
});

it('完整登记事务拒绝直接head、夹带图或空执行集合、错误command/receipt/actor',()=>{
  const state=empty(),event=makeEvent(state),command=workspaceMemberCommand(event.request),valid=mutation(event);
  for(const altered of [{...valid,workspaceMembers:[event.next]},{...valid,registryCursor:event.registryCursor},{...valid,members:[]},{...valid,scopes:[]},{...valid,runs:[]},{...valid,batch:{}},{receipt:valid.receipt},{...valid,workspaceMemberChanges:[]},{...valid,workspaceMemberChanges:[event,event]}])expect(()=>projectWorkspaceMemberMutation(state,altered as DispatchMutation,command)).toThrow();
  expect(()=>projectWorkspaceMemberMutation(state,valid,{...command,fingerprint:'bad'})).toThrow(/指纹/);
  expect(()=>projectWorkspaceMemberMutation(state,{...valid,receipt:{...workspaceMemberReceipt(event),memberId:randomUUID()}},command)).toThrow(/回执/);
  const fake=structuredClone(event);(fake.actor as any).interaction='model_claim';expect(()=>advance(state,fake)).toThrow(/审计结构/);
  const wrong=structuredClone(event);wrong.next.workspaceId='other';expect(()=>advance(state,wrong)).toThrow();
});

it('同cursor或旧revision不跨版本提交，错误前序hash/采纳ID/时间/basis不被重算checksum掩盖',()=>{
  const first=makeEvent(empty()),state=advance(empty(),first),legit=makeEvent(state,update(first.next,'新名'));
  for(const edit of [(e:WorkspaceMemberChange)=>{e.previousMemberHash='0'.repeat(64)},(e:WorkspaceMemberChange)=>{e.next.revision=1},(e:WorkspaceMemberChange)=>{e.request.expectedRegistryCursor=null},(e:WorkspaceMemberChange)=>{e.registryCursor.streamId=randomUUID()},(e:WorkspaceMemberChange)=>{e.next.createdAt='2026-11-06T00:00:00.000Z'},(e:WorkspaceMemberChange)=>{e.request.expectedBasis='0'.repeat(64)},(e:WorkspaceMemberChange)=>{e.next.adoption.configuration.principles='暗改'}]){const bad=structuredClone(legit);edit(bad);expect(()=>advance(state,bad)).toThrow()}
  const another=makeEvent(state);another.next.adoption.captureId=first.next.adoption.captureId;expect(()=>advance(state,another)).toThrow(/采集身份/);
  const after=advance(state,legit);expect(()=>advance(after,makeEvent(state,update(first.next,'并发旧编辑')))).toThrow(/游标/);
});

it('分页和当前差异协议不能把空登记伪装成成员，也不把缺失配置叫same',()=>{
  expect(workspaceMemberListInputSchema.safeParse({workspaceId,instanceId,offset:1}).success).toBe(false);
  const e=makeEvent(empty());expect(workspaceMemberListInputSchema.parse({workspaceId,instanceId,offset:1,expectedRegistryCursor:e.registryCursor}).offset).toBe(1);
  expect(workspaceMemberListSchema.safeParse({identity:{workspaceId,instanceId},registryCursor:null,offset:0,total:1,items:[]}).success).toBe(false);
  expect(workspaceMemberListSchema.safeParse({identity:{workspaceId,instanceId},registryCursor:e.registryCursor,offset:1,total:2,items:[],nextOffset:1}).success).toBe(false);
  expect(workspaceMemberReceiptSchema.safeParse({...workspaceMemberReceipt(e),action:'update',previousRevision:1,memberRevision:2}).success).toBe(false);
  const diff={checkedAt:time,capability:{status:'same',adoptedHash:e.next.adoption.capabilityHash,currentHash:e.next.adoption.capabilityHash},model:{status:'missing',adoptedHash:e.next.runtimePolicy.configurationHash,issue:'已删除'}};
  expect(workspaceMemberCurrentDiffSchema.safeParse(diff).success).toBe(true);expect(workspaceMemberCurrentDiffSchema.safeParse({...diff,model:{...diff.model,status:'same'}}).success).toBe(false);
});

it('字节与数量容量明确拒绝，不裁剪原则、不静默删除旧审计',()=>{
  const oversized={...configuration,principles:'字'.repeat(workspaceMemberLimits.capabilityBytes/3)};expect(workspaceMemberCapabilitySchema.safeParse(oversized).success).toBe(false);
  let state=empty();for(let i=0;i<workspaceMemberLimits.members;i++)state=advance(state,makeEvent(state));
  const before=structuredClone(state);expect(()=>advance(state,makeEvent(state))).toThrow(/数量超过上限/);expect(state).toEqual(before);
  const e=state.workspaceMemberChanges![0],huge=structuredClone(e);huge.next.adoption.configuration.principles='x'.repeat(workspaceMemberLimits.eventBytes);expect(workspaceMemberChangeSchema.safeParse(huge).success).toBe(false);
  const history=Array.from({length:40},(_,index)=>({...e,changeId:randomUUID(),request:{...e.request,commandId:randomUUID()},next:{...e.next,memberId:randomUUID(),adoption:{...e.next.adoption,configuration:{...configuration,principles:'x'.repeat(900000)}}}}));
  const full={...empty(),workspaceMembers:history.map(item=>item.next),workspaceMemberChanges:history,registryCursor:{...e.registryCursor,seq:40}};expect(()=>advance(full,makeEvent(full))).toThrow(/累计超过容量/);expect(full.workspaceMemberChanges.length).toBe(40);
});

it('旧Store只读空兼容，查询不创建文件；登记写一次并重开返回原immutable回执',async()=>{
  const f=await setup();try{
    expect(await f.store.commandReceipt('unknown')).toBeUndefined();const initial=await f.store.read();expect(initial.workspaceMembers).toEqual([]);expect(initial.registryCursor).toBeNull();await expect(fs.stat(f.file)).rejects.toMatchObject({code:'ENOENT'});
    const e=makeEvent(initial),command=workspaceMemberCommand(e.request),prepare=vi.fn(async()=>mutation(e));const receipts=await Promise.all([f.store.transact(command,prepare),f.store.transact(command,prepare)]);expect(prepare).toHaveBeenCalledTimes(1);expect(receipts[0]).toEqual(receipts[1]);expect(workspaceMemberReceiptSchema.safeParse(receipts[0]).success).toBe(true);
    const bytes=await fs.readFile(f.file);const read=vi.spyOn(fs,'readFile');expect((await f.store.commandReceipt(command.commandId))?.receipt).toEqual(receipts[0]);expect(read).not.toHaveBeenCalled();read.mockRestore();
    await f.store.close();const reopened=new FileDispatchStore(f.dir,workspaceId);try{expect((await reopened.commandReceipt(command.commandId))?.receipt).toEqual(receipts[0]);expect(await reopened.transact(command,async()=>{throw Error('不允许重放')})).toEqual(receipts[0]);expect(await fs.readFile(f.file)).toEqual(bytes);const result=await reopened.commandReceipt(command.commandId);(result!.receipt as any).memberRevision=999;expect((await reopened.commandReceipt(command.commandId))?.receipt).toEqual(receipts[0])}finally{await reopened.close()}
  }finally{await f.cleanup()}
});

it('Store串行CAS只有一个编辑成功，错误命令不追加记录，原回执不会变成最新成员',async()=>{
  const f=await setup();try{
    const first=makeEvent(await f.store.read()),original=await commit(f.store,first),state=await f.store.read(),a=makeEvent(state,update(first.next,'版本A')),b=makeEvent(state,update(first.next,'版本B'));
    const outcomes=await Promise.allSettled([commit(f.store,a),commit(f.store,b)]);expect(outcomes.filter(item=>item.status==='fulfilled')).toHaveLength(1);expect((await f.store.read()).workspaceMemberChanges).toHaveLength(2);
    expect((await f.store.commandReceipt(workspaceMemberCommand(first.request).commandId))?.receipt).toEqual(original);
    const bytes=await fs.readFile(f.file);await expect(f.store.transact({...workspaceMemberCommand(first.request),fingerprint:'other'},async()=>mutation(first))).rejects.toMatchObject({code:'COMMAND_ID_CONFLICT'});expect(await fs.readFile(f.file)).toEqual(bytes);
  }finally{await f.cleanup()}
});

it('登记与旧执行账本双向隔离，普通旧事务也不能覆写或漏掉登记投影',async()=>{
  const f=await setup();try{
    // 真实旧 v1 命令没有登记字段；保留其旧 bytes 与回执，不伪造岗位。
    await f.store.transact({commandId:'legacy-readonly',fingerprint:'legacy'},async()=>({receipt:{legacy:true}}));const old=await fs.readFile(f.file),state=await f.store.read();const e=makeEvent(state);await commit(f.store,e);const registered=await f.store.read();
    for(const key of ['members','sessions','graphs','outbox','runs','scopes'] as const)expect(registered[key]).toEqual(state[key]);expect((await fs.readFile(f.file)).subarray(0,old.length)).toEqual(old);
    const forbidden={...mutation(makeEvent(registered)),members:[]};const frozen=await fs.readFile(f.file);await expect(f.store.transact(workspaceMemberCommand(forbidden.workspaceMemberChanges![0].request),async()=>forbidden)).rejects.toMatchObject({code:'MEMBER_AUDIT'});expect(await fs.readFile(f.file)).toEqual(frozen);
    await f.store.transact({commandId:'legacy-next',fingerprint:'next'},async()=>({receipt:{legacy:2}}));const next=await f.store.read();expect(next.registryCursor).toEqual(registered.registryCursor);expect(next.workspaceMembers).toEqual(registered.workspaceMembers);expect(next.workspaceMemberChanges).toEqual(registered.workspaceMemberChanges);
  }finally{await f.cleanup()}
});

it('重算日志checksum仍不能伪造审计、head或紧凑回执',async()=>{
  const f=await setup();try{
    await commit(f.store,makeEvent(await f.store.read()));await f.store.close();const original=await fs.readFile(f.file,'utf8');
    for(const alter of [(body:any)=>{body.mutation.workspaceMemberChanges[0].next.revision=4},(body:any)=>{body.mutation.workspaceMemberChanges[0].next.runtimePolicy.snapshot.apiKey='secret'},(body:any)=>{body.mutation.receipt.memberHash='0'.repeat(64)},(body:any)=>{body.mutation.workspaceMembers=[body.mutation.workspaceMemberChanges[0].next]},(body:any)=>{delete body.mutation.workspaceMemberChanges}]){
      const record=JSON.parse(original);alter(record.body);record.checksum=hash(JSON.stringify(record.body));await fs.writeFile(f.file,JSON.stringify(record)+'\n');const reader=new FileDispatchStore(f.dir,workspaceId);try{await expect(reader.read()).rejects.toMatchObject({code:'GRAPH_LOG_CORRUPT'})}finally{await reader.close()}
    }
    await fs.writeFile(f.file,original);
  }finally{await f.cleanup()}
});

it('fsync未知关闭原实例，重开从完整原日志核实，不再调用prepare登记第二岗位',async()=>{
  const f=await setup();try{
    const e=makeEvent(await f.store.read()),open=fs.open.bind(fs);vi.spyOn(fs,'open').mockImplementation(async(...args:any[])=>{const handle=await (open as any)(...args);return args[1]==='a'?new Proxy(handle,{get(target,key){if(key==='sync')return async()=>{throw Error('fsync未确认')};const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value}}):handle});
    await expect(commit(f.store,e)).rejects.toMatchObject({code:'GRAPH_STORAGE_FAILED'});vi.restoreAllMocks();await expect(f.store.commandReceipt(workspaceMemberCommand(e.request).commandId)).rejects.toMatchObject({code:'GRAPH_STORAGE_FAILED'});await f.store.close();
    const reader=new FileDispatchStore(f.dir,workspaceId);try{expect((await reader.commandReceipt(workspaceMemberCommand(e.request).commandId))?.receipt).toEqual(workspaceMemberReceipt(e));expect((await reader.read()).workspaceMembers).toHaveLength(1)}finally{await reader.close()}
  }finally{await f.cleanup()}
});
