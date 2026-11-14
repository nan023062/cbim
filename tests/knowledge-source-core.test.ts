import {afterEach,expect,it,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {hash} from '../src/core/platform/node/serialization';
import {knowledgeSourceChangeSchema,knowledgeSourceLimits,sourceSelectionSchema,sourceReadStateMatches,type KnowledgeSourceKey,type KnowledgeSourcePrepared,type KnowledgeSourceResolved,type KnowledgeSourceChange,type SourceSelection} from '../src/logic/workspace/rules/knowledge-source';
import {applyKnowledgeSourceChange,currentKnowledgeSource,knowledgeSourceRef,knowledgeSourceSelection,nextKnowledgeSourceCursor,knowledgeSourceCommand,knowledgeSourceReceipt,knowledgeSourceStatus,createKnowledgeSourceCapture} from '../src/logic/workspace/rules/knowledge-source-rules';
import {workspaceMemberDetailSchema,workspaceMemberCommitInputSchema,summarizeWorkspaceMember,type WorkspaceMember,type WorkspaceMemberChange,type WorkspaceMemberChangeInput,type WorkspaceMemberModelSnapshot} from '../src/logic/team/rules/workspace-member';
import {workspaceMemberCapabilityHash,workspaceMemberCommand,workspaceMemberHash,workspaceMemberModelHash,workspaceMemberPreviewBasis,workspaceMemberProposed,workspaceMemberReceipt,workspaceMemberChangedFields} from '../src/logic/team/rules/workspace-member-rules';
import {moduleOwnershipChangeInputSchema,moduleOwnershipReceiptSchema,moduleOwnershipDetailSchema,moduleOwnershipListInputSchema,summarizeModuleOwnershipChange,type ModuleOwnershipChange,type ModuleOwnershipChangeInput} from '../src/logic/workspace/rules/module-ownership';
import {moduleOwnershipBasis,moduleOwnershipCommand,moduleOwnershipHash,moduleOwnershipReceipt} from '../src/logic/workspace/rules/module-ownership-rules';
import {moduleOwnershipImpact} from '../src/logic/tasks/rules/module-ownership-invariants';
import {projectKnowledgeSourceMutation} from '../src/logic/tasks/rules/knowledge-source-invariants';
import type {DispatchState,DispatchMutation} from '../src/logic/dispatch/rules/dispatch-storage';
import {FileDispatchStore} from '../src/logic/dispatch/storage/dispatch-store';

const workspaceId='source-workspace',instanceId=randomUUID(),at='2026-11-08T06:00:00.000Z',later='2026-11-08T06:00:01.000Z';
const agent:KnowledgeSourceKey={kind:'agent',sourceId:'.cbim/team/dev'},moduleKey:KnowledgeSourceKey={kind:'module',sourceId:'.cbim/workspace/game'};
const observation={knowledgeRevision:'knowledge-1',definitionHash:hash('original-definition'),visible:true as const};
const model:WorkspaceMemberModelSnapshot={id:randomUUID(),name:'Local',api:'openai-completions',baseUrl:'http://127.0.0.1:1/v1',auth:'none',model:'local',contextWindow:32000,maxTokens:1000,reasoning:false};
const capability={workspaceId,teamId:'.cbim/team',agentId:agent.sourceId,name:'Developer',source:'workspace' as const,knowledgeRevision:observation.knowledgeRevision,principles:'real principles',effectiveSkills:[]};
const empty=():DispatchState=>({workspaceId,members:[],sessions:[],graphs:[],outbox:[]});
const actor={kind:'local_desktop' as const,interaction:'explicit_submit' as const};
const policy={profileId:model.id,modelId:model.model,configurationHash:workspaceMemberModelHash(model),snapshot:model};
function memberMutation(state:DispatchState,withSource=true,input?:WorkspaceMemberChangeInput,builtin=false):{event:WorkspaceMemberChange;mutation:DispatchMutation}{
  const old=input&&input.kind!=='register'?state.workspaceMembers!.find(value=>value.memberId===input.memberId):undefined;
  const configuration=builtin?{...capability,source:'builtin' as const,agentId:'cbim:executor'}:structuredClone(capability);
  const change:WorkspaceMemberChangeInput=input??{kind:'register',agentId:configuration.agentId,name:'Member',position:'Build',adaptation:{instructions:'',references:[]},runtimePolicy:{profileId:model.id,modelId:model.model},reason:'explicit'};
  const selected=change.kind==='register'||change.kind==='adopt'&&change.target==='capability',changeId=randomUUID();
  const selection=withSource&&selected?(builtin?{kind:'builtin' as const,ref:{kind:'builtin' as const,id:'cbim:executor' as const,contentHash:workspaceMemberCapabilityHash(configuration)}}:knowledgeSourceSelection(state,agent,observation)):undefined;
  const capture=selection?.kind==='workspace'&&!selection.expectedRef?createKnowledgeSourceCapture(state,selection,{changeId:randomUUID(),generationId:randomUUID(),streamId:randomUUID(),recordedAt:at,consumer:{kind:'workspace_member',changeId}}):undefined;
  const ref=selection?.kind==='builtin'?selection.ref:selection?.expectedRef??(capture?knowledgeSourceRef(capture.generation):undefined);
  const next:WorkspaceMember=old?structuredClone(old):{workspaceId,memberId:randomUUID(),revision:1,name:'Member',position:'Build',adaptation:{instructions:'',references:[]},state:'active',adoption:{captureId:randomUUID(),capturedAt:at,knowledgeRevision:observation.knowledgeRevision,capabilityHash:workspaceMemberCapabilityHash(configuration),configuration},runtimePolicy:policy,createdAt:at,updatedAt:at};
  if(old){next.revision++;if(change.kind==='update')Object.assign(next,change.patch);if(change.kind==='state')next.state=change.nextState;}
  if(selected){next.adoption={captureId:randomUUID(),capturedAt:at,knowledgeRevision:observation.knowledgeRevision,capabilityHash:workspaceMemberCapabilityHash(configuration),configuration,...(ref?{sourceRef:ref}:{})};}
  const request={workspaceId,instanceId,commandId:randomUUID(),change,expectedRegistryCursor:state.registryCursor??null,expectedBasis:workspaceMemberPreviewBasis({workspaceId,change,registryCursor:state.registryCursor??null,previousMember:old,proposed:workspaceMemberProposed(next),...(selection?{sourceSelection:selection}:{})})};
  const event:WorkspaceMemberChange={version:1,request,changeId,registryCursor:{kind:'workspace_registry',workspaceId,streamId:state.registryCursor?.streamId??randomUUID(),seq:(state.registryCursor?.seq??0)+1},previousRevision:old?.revision??0,previousMemberHash:old?workspaceMemberHash(old):null,next,actor,committedAt:at,...(selection?{sourceSelection:selection}:{})};
  return {event,mutation:{workspaceMemberChanges:[event],...(capture?{knowledgeSourceChanges:[capture]}:{}),receipt:workspaceMemberReceipt(event)}};
}
function ownerMutation(state:DispatchState,change?:ModuleOwnershipChangeInput,withSource=true){
  const previous=state.moduleOwnerships?.find(value=>value.moduleId===moduleKey.sourceId)??null,owner=state.workspaceMembers![0],changeId=randomUUID();
  const input:ModuleOwnershipChangeInput=change??{moduleId:moduleKey.sourceId,expectedBinding:previous?{bindingId:previous.bindingId,revision:previous.revision,ownerMemberId:previous.ownerMemberId}:null,nextOwner:{memberId:owner.memberId,expectedRevision:owner.revision},reason:'explicit'};
  const selected=input.kind==='adopt_source'||!!input.nextOwner,selection=selected&&withSource?knowledgeSourceSelection(state,moduleKey,observation):undefined;
  const capture=selection?.kind==='workspace'&&!selection.expectedRef?createKnowledgeSourceCapture(state,selection,{changeId:randomUUID(),generationId:randomUUID(),streamId:randomUUID(),recordedAt:at,consumer:{kind:'module_ownership',changeId}}):undefined;
  const ref=selection?.kind==='workspace'?selection.expectedRef??(capture?knowledgeSourceRef(capture.generation):undefined):undefined;
  const observedModule=selected?{knowledgeRevision:observation.knowledgeRevision,definitionHash:observation.definitionHash,observedAt:at}:previous!.observedModule;
  const impact=moduleOwnershipImpact(state,moduleKey.sourceId),basis=moduleOwnershipBasis({workspaceId,change:input,ownershipCursor:state.ownershipCursor??null,previous,...(previous?.ownerMemberId?{previousOwner:summarizeWorkspaceMember(owner)}:{}),...(selected?{nextOwner:summarizeWorkspaceMember(owner),observedModule}:{}),...(selection?{sourceSelection:selection}:{}),impact});
  const event:ModuleOwnershipChange={version:1,request:{workspaceId,instanceId,commandId:randomUUID(),change:input,expectedOwnershipCursor:state.ownershipCursor??null,expectedBasis:basis},actor,changeId,ownershipCursor:{kind:'module_ownership',workspaceId,streamId:state.ownershipCursor?.streamId??randomUUID(),seq:(state.ownershipCursor?.seq??0)+1},previousRevision:previous?.revision??0,previousBindingHash:previous?moduleOwnershipHash(previous):null,sourceSelection:selection,next:{workspaceId,bindingId:previous?.bindingId??randomUUID(),moduleId:moduleKey.sourceId,revision:(previous?.revision??0)+1,ownerMemberId:input.kind==='adopt_source'?previous!.ownerMemberId:input.nextOwner?.memberId??null,observedModule,...(selected?(ref?{sourceRef:ref}:{}):previous?.sourceRef?{sourceRef:previous.sourceRef}:{}),createdAt:previous?.createdAt??at,updatedAt:at,lastChangeId:changeId},impact,committedAt:at};
  if(!selection)delete event.sourceSelection;
  return {event,mutation:{ownershipChanges:[event],...(capture?{knowledgeSourceChanges:[capture]}:{}),receipt:moduleOwnershipReceipt(event)} as DispatchMutation};
}
function prepare(state:DispatchState,key:KnowledgeSourceKey=agent,reason:'created'|'deleted'|'replaced'|'hidden'|'visible_again'|'moved'='created'):KnowledgeSourcePrepared{
  const transitionId=randomUUID(),previous=currentKnowledgeSource(state,key),creates=['created','replaced','visible_again'].includes(reason);
  return {version:1,kind:'prepared',changeId:randomUUID(),workspaceId,sourceCursor:nextKnowledgeSourceCursor(state,randomUUID()),recordedAt:at,transition:{version:1,transitionId,workspaceId,instanceId,requestId:randomUUID(),requestFingerprint:hash('request-'+transitionId),journalBindingHash:hash('journal-'+transitionId),expectedSourceCursor:state.sourceCursor??null,preparedAt:at,state:'pending',changes:[{source:key,previous:previous?knowledgeSourceRef(previous):null,next:creates?{version:1,workspaceId,source:key,generationId:randomUUID(),origin:reason==='replaced'?'controlled_replace':'controlled_create',createdAt:at,createdChangeId:transitionId}:null,reason}]}};
}
function resolve(state:DispatchState,pending:KnowledgeSourcePrepared,outcome:'committed'|'rolled_back'='committed'):KnowledgeSourceResolved{return {version:1,kind:'resolved',changeId:randomUUID(),workspaceId,sourceCursor:nextKnowledgeSourceCursor(state,randomUUID()),recordedAt:later,transitionId:pending.transition.transitionId,requestFingerprint:pending.transition.requestFingerprint,journalBindingHash:pending.transition.journalBindingHash,outcome,journalProofHash:hash('actual-terminal-journal'),...(outcome==='committed'?{committedRevision:'knowledge-2'}:{})}}
const evolve=(state:DispatchState,event:KnowledgeSourceChange):DispatchState=>({...state,...applyKnowledgeSourceChange(state,event)});
const sourceCommit=(store:FileDispatchStore,event:KnowledgeSourcePrepared|KnowledgeSourceResolved)=>store.transact(knowledgeSourceCommand(event),async()=>({knowledgeSourceChanges:[event],receipt:knowledgeSourceReceipt(event)}));
const memberCommit=(store:FileDispatchStore,m:ReturnType<typeof memberMutation>)=>store.transact(workspaceMemberCommand(m.event.request),async()=>m.mutation);
const ownerCommit=(store:FileDispatchStore,m:ReturnType<typeof ownerMutation>)=>store.transact(moduleOwnershipCommand(m.event.request,m.event.actor),async()=>m.mutation);
async function setup(){const directory=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-source-core-')),store=new FileDispatchStore(directory,workspaceId);return {store,directory,file:path.join(directory,'dispatch.jsonl'),cleanup:async()=>{await store.close();if(!path.resolve(directory).startsWith(path.join(os.tmpdir(),'cbim-source-core-')))throw Error('bad temp');await fs.rm(directory,{recursive:true,force:true})}}}
afterEach(()=>vi.restoreAllMocks());

it('公开选择不能跨workspace/逻辑源；客户端提交不能携带来源证明',()=>{
  const m=memberMutation(empty()),capture=m.mutation.knowledgeSourceChanges![0];expect(knowledgeSourceChangeSchema.safeParse(capture).success).toBe(true);
  const ref=m.event.next.adoption.sourceRef!;expect(sourceSelectionSchema.safeParse({kind:'workspace',workspaceId:'other',source:agent,expectedRef:ref,observation}).success).toBe(false);
  expect(workspaceMemberCommitInputSchema.safeParse({...m.event.request,sourceSelection:m.event.sourceSelection}).success).toBe(false);
  expect(sourceReadStateMatches({status:'current',ref},workspaceId,agent,ref)).toBe(true);
  expect(sourceReadStateMatches({status:'current',ref},'other',agent,ref)).toBe(false);
  expect(sourceReadStateMatches({status:'current',ref},workspaceId,moduleKey,ref)).toBe(false);
  expect(sourceReadStateMatches({status:'current',ref},workspaceId,agent)).toBe(false);
  expect(sourceReadStateMatches({status:'needs_adoption',currentRef:ref},workspaceId,agent,ref)).toBe(false);
});

it('prepare不动当前代次，commit才替换；rollback保留原头且代次ID永不复用',()=>{
  let state=empty();const created=prepare(state);state=evolve(state,created);expect(currentKnowledgeSource(state,agent)).toBeUndefined();state=evolve(state,resolve(state,created));
  const old=currentKnowledgeSource(state,agent)!;const replacement=prepare(state,agent,'replaced');state=evolve(state,replacement);expect(currentKnowledgeSource(state,agent)).toEqual(old);state=evolve(state,resolve(state,replacement,'rolled_back'));expect(currentKnowledgeSource(state,agent)).toEqual(old);
  const again=prepare(state,agent,'replaced');again.transition.changes[0].next!.generationId=replacement.transition.changes[0].next!.generationId;expect(()=>evolve(state,again)).toThrow(/复用/);
  const actual=prepare(state,agent,'replaced');state=evolve(state,actual);state=evolve(state,resolve(state,actual));expect(currentKnowledgeSource(state,agent)!.generationId).not.toBe(old.generationId);expect(state.knowledgeSourceGenerations![0].retired?.reason).toBe('replaced');
  expect(knowledgeSourceStatus(state,agent,knowledgeSourceRef(old),observation)).toMatchObject({status:'retired',currentRef:{generationId:actual.transition.changes[0].next!.generationId}});
});

it('普通知识变化可空生命周期计划；删除/重显/跨路径变化均保留准确历史',()=>{
  let state=empty();const p=prepare(state);state=evolve(state,p);state=evolve(state,resolve(state,p));const original=currentKnowledgeSource(state,agent)!;
  const edit=prepare(state);edit.transition.changes=[];state=evolve(state,edit);state=evolve(state,resolve(state,edit));expect(currentKnowledgeSource(state,agent)).toEqual(original);
  const hide=prepare(state,agent,'hidden');state=evolve(state,hide);state=evolve(state,resolve(state,hide));expect(currentKnowledgeSource(state,agent)).toBeUndefined();
  const reveal=prepare(state,agent,'visible_again');state=evolve(state,reveal);state=evolve(state,resolve(state,reveal));expect(currentKnowledgeSource(state,agent)?.generationId).not.toBe(original.generationId);
  const gone=prepare(state,{kind:'module',sourceId:'.cbim/workspace/untracked'},'deleted');expect(knowledgeSourceChangeSchema.safeParse(gone).success).toBe(true);const before=state.knowledgeSourceGenerations;state=evolve(state,gone);state=evolve(state,resolve(state,gone));expect(state.knowledgeSourceGenerations).toEqual(before);
});

it('错误前序/重复代次/错误terminal/混合source事务拒绝且不改变投影',()=>{
  const state=empty(),p=prepare(state),pending=evolve(state,p),done=resolve(pending,p),frozen=structuredClone(pending);
  for(const mutate of [(e:KnowledgeSourceResolved)=>{e.requestFingerprint=hash('bad')},(e:KnowledgeSourceResolved)=>{e.journalBindingHash=hash('bad')},(e:KnowledgeSourceResolved)=>{e.transitionId=randomUUID()},(e:KnowledgeSourceResolved)=>{e.sourceCursor.seq++},(e:KnowledgeSourceResolved)=>{delete e.committedRevision}]){const bad=structuredClone(done);mutate(bad);expect(()=>evolve(pending,bad)).toThrow()}
  expect(pending).toEqual(frozen);expect(()=>evolve(pending,prepare(pending,moduleKey))).toThrow(/待结算/);
  for(const extra of [{members:[]},{workspaceMemberChanges:[]},{knowledgeSourceGenerations:[]},{sourceCursor:null}])expect(()=>projectKnowledgeSourceMutation(pending,{knowledgeSourceChanges:[done],receipt:knowledgeSourceReceipt(done),...extra},knowledgeSourceCommand(done))).toThrow();
  expect(()=>projectKnowledgeSourceMutation(pending,{knowledgeSourceChanges:[done],receipt:{}},knowledgeSourceCommand(done))).toThrow(/命令或回执/);
});

it('真实Store首次capture与唯一登记原子提交，重复和重开不再捕获',async()=>{
  const f=await setup();try{const initial=await f.store.read();expect(initial.sourceCursor).toBeNull();expect(initial.knowledgeSourceChanges).toEqual([]);const m=memberMutation(initial),command=workspaceMemberCommand(m.event.request),callback=vi.fn(async()=>m.mutation);
    await Promise.all([f.store.transact(command,callback),f.store.transact(command,callback)]);expect(callback).toHaveBeenCalledTimes(1);const state=await f.store.read();expect(state.knowledgeSourceChanges).toHaveLength(1);expect(state.workspaceMembers).toHaveLength(1);expect(state.graphs).toEqual([]);expect(state.runs).toEqual([]);const bytes=await fs.readFile(f.file);
    await f.store.close();const reopened=new FileDispatchStore(f.directory,workspaceId);try{expect(await reopened.read()).toEqual(state);expect((await reopened.commandReceipt(command.commandId))?.receipt).toEqual(workspaceMemberReceipt(m.event));expect(await fs.readFile(f.file)).toEqual(bytes)}finally{await reopened.close()}
  }finally{await f.cleanup()}
});

it('capture不能单独落盘或夹带另一消费者/图；伪匹配ref/selection/actor不能靠basis重算通过',async()=>{
  const f=await setup();try{const state=await f.store.read(),m=memberMutation(state),command=workspaceMemberCommand(m.event.request),original=structuredClone(m.mutation);
    const bads:DispatchMutation[]=[{knowledgeSourceChanges:original.knowledgeSourceChanges,receipt:{}},{...original,batch:{} as any},{...original,ownershipChanges:[]},{...original,workspaceMemberChanges:[m.event,m.event]}];
    const refBad=structuredClone(original);refBad.workspaceMemberChanges![0].next.adoption.sourceRef={...m.event.next.adoption.sourceRef!,workspaceId:'elsewhere'} as any;bads.push(refBad);
    const consumerBad=structuredClone(original);(consumerBad.knowledgeSourceChanges![0] as any).consumer.changeId=randomUUID();bads.push(consumerBad);
    const claimBad=structuredClone(original);claimBad.workspaceMemberChanges![0].sourceSelection={kind:'workspace',workspaceId,source:agent,expectedRef:{version:1,workspaceId,source:agent,generationId:randomUUID()},observation};bads.push(claimBad);
    for(const bad of bads)await expect(f.store.transact(command,async()=>bad)).rejects.toBeDefined();expect(await f.store.read()).toEqual(state);await expect(fs.stat(f.file)).rejects.toMatchObject({code:'ENOENT'});
    await memberCommit(f.store,m);expect((await f.store.read()).knowledgeSourceChanges).toHaveLength(1);
  }finally{await f.cleanup()}
});

it('旧原日志不补source；显式相同内容采纳才建立来源，元信息/model操作保留原ref',async()=>{
  const f=await setup();try{const old=memberMutation(await f.store.read(),false);await memberCommit(f.store,old);let state=await f.store.read();const prefix=await fs.readFile(f.file);expect(state.workspaceMembers![0].adoption).not.toHaveProperty('sourceRef');
    const change:WorkspaceMemberChangeInput={kind:'adopt',memberId:old.event.next.memberId,expectedRevision:1,target:'capability',reason:'bind source'};const adopted=memberMutation(state,true,change);expect(adopted.event.next.adoption.capabilityHash).toBe(old.event.next.adoption.capabilityHash);expect(workspaceMemberChangedFields(old.event.next,workspaceMemberProposed(adopted.event.next))).toEqual(['capability']);await memberCommit(f.store,adopted);state=await f.store.read();expect((await fs.readFile(f.file)).subarray(0,prefix.length)).toEqual(prefix);
    const edit=memberMutation(state,false,{kind:'update',memberId:old.event.next.memberId,expectedRevision:2,patch:{name:'renamed'},reason:'rename'});await memberCommit(f.store,edit);expect((await f.store.read()).workspaceMembers![0].adoption).toEqual(adopted.event.next.adoption);
    const silent=memberMutation(await f.store.read(),false,{kind:'state',memberId:old.event.next.memberId,expectedRevision:3,nextState:'suspended',reason:'pause'});delete silent.event.next.adoption.sourceRef;silent.mutation.receipt=workspaceMemberReceipt(silent.event);await expect(memberCommit(f.store,silent)).rejects.toThrow(/不能改写来源/);
  }finally{await f.cleanup()}
});

it('pending先提交阻止新采纳，但原回执/改名仍可读写；terminal按原command幂等',async()=>{
  const f=await setup();try{const m=memberMutation(await f.store.read());await memberCommit(f.store,m);let state=await f.store.read();const next=memberMutation(state),p=prepare(state,agent,'replaced');await sourceCommit(f.store,p);const callback=vi.fn(async()=>next.mutation);await expect(f.store.transact(workspaceMemberCommand(next.event.request),callback)).rejects.toMatchObject({code:'SOURCE_PENDING'});
    expect((await f.store.commandReceipt(workspaceMemberCommand(m.event.request).commandId))?.receipt).toEqual(workspaceMemberReceipt(m.event));state=await f.store.read();await memberCommit(f.store,memberMutation(state,false,{kind:'update',memberId:m.event.next.memberId,expectedRevision:1,patch:{name:'still editable'},reason:'rename'}));
    state=await f.store.read();const done=resolve(state,p);const first=await sourceCommit(f.store,done),bytes=await fs.readFile(f.file);expect(await sourceCommit(f.store,done)).toEqual(first);expect(await fs.readFile(f.file)).toEqual(bytes);expect((await f.store.read()).workspaceMembers![0].adoption.sourceRef).toEqual(m.event.next.adoption.sourceRef);
  }finally{await f.cleanup()}
});

it('来源采纳依据不依赖新UUID，但变化来源选择和原成员版本均失效预览',()=>{
  const a=memberMutation(empty()),b=memberMutation(empty());expect(a.event.request.expectedBasis).toBe(b.event.request.expectedBasis);expect(a.event.next.adoption.sourceRef).not.toEqual(b.event.next.adoption.sourceRef);
  const other=structuredClone(a.event.sourceSelection!) as Extract<SourceSelection,{kind:'workspace'}>;other.observation.definitionHash=hash('changed');expect(workspaceMemberPreviewBasis({workspaceId,change:a.event.request.change,registryCursor:null,proposed:workspaceMemberProposed(a.event.next),sourceSelection:other})).not.toBe(a.event.request.expectedBasis);
});

it('岗位预览排除无关全库revision，但保留完整事件观察和来源身份内容依据',()=>{
  const a=memberMutation(empty()),original=structuredClone(a.event),proposed=workspaceMemberProposed(a.event.next);
  const selection=structuredClone(a.event.sourceSelection!) as Extract<SourceSelection,{kind:'workspace'}>;
  selection.observation.knowledgeRevision='people-json-only';proposed.capability.configuration.knowledgeRevision='people-json-only';
  const input={workspaceId,change:a.event.request.change,registryCursor:null,proposed,sourceSelection:selection};
  expect(workspaceMemberPreviewBasis(input)).toBe(a.event.request.expectedBasis);
  expect(a.event).toEqual(original);expect(selection.observation.knowledgeRevision).toBe('people-json-only');
  for(const patch of [{workspaceId:'other'},{source:{kind:'agent' as const,sourceId:'.cbim/team/other'}},{observation:{...selection.observation,definitionHash:hash('changed definition')}},{observation:{...selection.observation,visible:false}}]){
    expect(workspaceMemberPreviewBasis({...input,sourceSelection:{...selection,...patch} as SourceSelection})).not.toBe(a.event.request.expectedBasis);
  }
  const capabilityChanged=structuredClone(proposed);capabilityChanged.capability.configuration.principles+=' changed';capabilityChanged.capability.capabilityHash=workspaceMemberCapabilityHash(capabilityChanged.capability.configuration);
  expect(workspaceMemberPreviewBasis({...input,proposed:capabilityChanged})).not.toBe(a.event.request.expectedBasis);
  const modelChanged=structuredClone(proposed);modelChanged.runtimePolicy.snapshot.maxTokens++;modelChanged.runtimePolicy.configurationHash=workspaceMemberModelHash(modelChanged.runtimePolicy.snapshot);
  expect(workspaceMemberPreviewBasis({...input,proposed:modelChanged})).not.toBe(a.event.request.expectedBasis);
});

it('同路径同字节来源受控删除重建仍使岗位原预览失效',()=>{
  let state=empty();const created=prepare(state);state=evolve(state,created);state=evolve(state,resolve(state,created));
  const before=memberMutation(state),deleted=prepare(state,agent,'deleted');state=evolve(state,deleted);state=evolve(state,resolve(state,deleted));
  const recreated=prepare(state);state=evolve(state,recreated);state=evolve(state,resolve(state,recreated));const after=memberMutation(state);
  expect(before.event.next.adoption.capabilityHash).toBe(after.event.next.adoption.capabilityHash);
  expect((before.event.sourceSelection as Extract<SourceSelection,{kind:'workspace'}>).observation).toEqual((after.event.sourceSelection as Extract<SourceSelection,{kind:'workspace'}>).observation);
  expect(before.event.next.adoption.sourceRef).not.toEqual(after.event.next.adoption.sourceRef);
  expect(before.event.request.expectedBasis).not.toBe(after.event.request.expectedBasis);
});

it('builtin只采纳内容引用，不创建工作区代次；伪builtin hash拒绝',async()=>{
  const f=await setup();try{const m=memberMutation(await f.store.read(),true,undefined,true);expect(m.mutation.knowledgeSourceChanges).toBeUndefined();await memberCommit(f.store,m);const state=await f.store.read();expect(state.knowledgeSourceGenerations).toEqual([]);expect(state.workspaceMembers![0].adoption.sourceRef).toMatchObject({kind:'builtin',id:'cbim:executor'});
    const bad=memberMutation(state,true,undefined,true);(bad.event.sourceSelection as Extract<SourceSelection,{kind:'builtin'}>).ref.contentHash=hash('fake');bad.event.next.adoption.sourceRef=(bad.event.sourceSelection as Extract<SourceSelection,{kind:'builtin'}>).ref;await expect(memberCommit(f.store,bad)).rejects.toThrow(/内容指纹/);
  }finally{await f.cleanup()}
});

it('同owner只允许明确adopt_source，旧关系可补来源且责任版本/原owner保持',async()=>{
  const f=await setup();try{await memberCommit(f.store,memberMutation(await f.store.read(),false));const original=ownerMutation(await f.store.read(),undefined,false);await ownerCommit(f.store,original);let state=await f.store.read();const binding=state.moduleOwnerships![0],input:ModuleOwnershipChangeInput={kind:'adopt_source',moduleId:moduleKey.sourceId,expectedBinding:{bindingId:binding.bindingId,revision:binding.revision,ownerMemberId:binding.ownerMemberId},reason:'explicit source adoption'};
    expect(moduleOwnershipChangeInputSchema.safeParse(input).success).toBe(true);expect(moduleOwnershipChangeInputSchema.safeParse({...input,nextOwner:{memberId:binding.ownerMemberId,expectedRevision:1}}).success).toBe(false);
    expect(moduleOwnershipChangeInputSchema.safeParse({...input,kind:undefined,nextOwner:{memberId:binding.ownerMemberId,expectedRevision:1}}).success).toBe(false);
    const adopted=ownerMutation(state,input);await ownerCommit(f.store,adopted);state=await f.store.read();expect(state.moduleOwnerships![0]).toMatchObject({bindingId:binding.bindingId,ownerMemberId:binding.ownerMemberId,revision:2});expect(state.ownershipChanges![0]).toEqual(original.event);expect(moduleOwnershipReceiptSchema.parse(adopted.mutation.receipt).action).toBe('adopt_source');
    const duplicate=ownerMutation(state,{...input,expectedBinding:{...input.expectedBinding!,revision:2}});await expect(ownerCommit(f.store,duplicate)).rejects.toMatchObject({code:'OWNERSHIP_NO_CHANGE'});
    const unlink=ownerMutation(state,{moduleId:moduleKey.sourceId,expectedBinding:{bindingId:binding.bindingId,revision:2,ownerMemberId:binding.ownerMemberId},nextOwner:null,reason:'source may be missing'});await ownerCommit(f.store,unlink);expect((await f.store.read()).moduleOwnerships![0].sourceRef).toEqual(adopted.event.next.sourceRef);
  }finally{await f.cleanup()}
});

it('source-only事务不能改变两登记游标/图；容量预留与伪造回放拒绝',async()=>{
  const f=await setup();try{const before=await f.store.read(),p=prepare(before);await sourceCommit(f.store,p);let state=await f.store.read();expect(state.registryCursor).toEqual(before.registryCursor);expect(state.ownershipCursor).toEqual(before.ownershipCursor);expect(state.graphs).toEqual(before.graphs);await sourceCommit(f.store,resolve(state,p));state=await f.store.read();
    const raw=await fs.readFile(f.file,'utf8'),lines=raw.trimEnd().split('\n').map(line=>JSON.parse(line));lines[1].body.mutation.knowledgeSourceChanges[0].journalBindingHash=hash('forged');lines[1].checksum=hash(JSON.stringify(lines[1].body));await f.store.close();await fs.writeFile(f.file,lines.map(line=>JSON.stringify(line)).join('\n')+'\n');const reopened=new FileDispatchStore(f.directory,workspaceId);try{await expect(reopened.read()).rejects.toMatchObject({code:'GRAPH_LOG_CORRUPT'})}finally{await reopened.close()}
    const source=prepare(empty());const almost={...empty(),knowledgeSourceChanges:Array.from({length:knowledgeSourceLimits.events-1},(_,n)=>({...source,changeId:String(n)})),sourceCursor:{...source.sourceCursor,seq:knowledgeSourceLimits.events-1}};const last=prepare(almost);expect(()=>applyKnowledgeSourceChange(almost,last)).toThrow(/保留容量/);
  }finally{await f.cleanup()}
});

it('详情严格核sourceStatus与已采纳ref，不把别对象current或缺省ref显示成一致',async()=>{
  const f=await setup();try{const m=memberMutation(await f.store.read());await memberCommit(f.store,m);const state=await f.store.read(),member=state.workspaceMembers![0],ref=member.adoption.sourceRef!;
    const detail={identity:{workspaceId,instanceId},registryCursor:state.registryCursor,member,currentDiff:{checkedAt:at,capability:{status:'same',adoptedHash:member.adoption.capabilityHash,currentHash:member.adoption.capabilityHash},model:{status:'same',adoptedHash:policy.configurationHash,currentHash:policy.configurationHash}},sourceStatus:{status:'current',ref}};
    expect(workspaceMemberDetailSchema.safeParse(detail).success).toBe(true);expect(workspaceMemberDetailSchema.safeParse({...detail,sourceStatus:{status:'needs_adoption',currentRef:ref}}).success).toBe(false);expect(workspaceMemberDetailSchema.safeParse({...detail,sourceStatus:{status:'current',ref:{...ref,workspaceId:'foreign'}}}).success).toBe(false);
    const own=ownerMutation(state);await ownerCommit(f.store,own);const current=await f.store.read(),binding=current.moduleOwnerships![0];const view={moduleId:binding.moduleId,binding,owner:summarizeWorkspaceMember(member),status:'assigned',source:{status:'same',knowledgeRevision:observation.knowledgeRevision,definitionHash:observation.definitionHash},sourceStatus:{status:'current',ref:binding.sourceRef}};
    const d={identity:{workspaceId,instanceId},readOnly:true,checkedAt:at,basis:{ownershipCursor:current.ownershipCursor,memberRegistryCursor:current.registryCursor,knowledgeRevision:observation.knowledgeRevision},view,history:{total:1,truncated:false,items:[summarizeModuleOwnershipChange(own.event)]}};expect(moduleOwnershipDetailSchema.safeParse(d).success).toBe(true);expect(moduleOwnershipDetailSchema.safeParse({...d,view:{...view,sourceStatus:{status:'current',ref}}}).success).toBe(false);
    expect(moduleOwnershipDetailSchema.parse(d).basis).not.toHaveProperty('sourceCursor');const basis={...d.basis,sourceCursor:current.sourceCursor};expect(moduleOwnershipDetailSchema.safeParse({...d,basis}).success).toBe(true);
    const cross={...basis,sourceCursor:{...current.sourceCursor,workspaceId:'other'}};expect(moduleOwnershipDetailSchema.safeParse({...d,basis:cross}).success).toBe(false);expect(moduleOwnershipListInputSchema.safeParse({workspaceId,instanceId,offset:1,expectedReadBasis:cross}).success).toBe(false);
  }finally{await f.cleanup()}
});

it('同来源并发capture只有一个可提交，另一预览不能借旧basis建立第二代次',async()=>{
  const f=await setup();try{const state=await f.store.read(),first=memberMutation(state),second=memberMutation(state);const values=await Promise.allSettled([memberCommit(f.store,first),memberCommit(f.store,second)]);expect(values.filter(value=>value.status==='fulfilled')).toHaveLength(1);expect(values.filter(value=>value.status==='rejected')).toHaveLength(1);const next=await f.store.read();expect(next.workspaceMembers).toHaveLength(1);expect(next.knowledgeSourceGenerations).toHaveLength(1);expect(next.sourceCursor?.seq).toBe(1);
    const following=memberMutation(next);expect(following.mutation.knowledgeSourceChanges).toBeUndefined();await memberCommit(f.store,following);expect((await f.store.read()).knowledgeSourceGenerations).toHaveLength(1);
  }finally{await f.cleanup()}
});

it('generation数量与UTF8历史容量在prepare前拒绝，并为最坏terminal保留空间',()=>{
  const sample=prepare(empty()),generation=sample.transition.changes[0].next!;
  const full={...empty(),knowledgeSourceGenerations:Array.from({length:knowledgeSourceLimits.generations},(_,index)=>({...generation,generationId:randomUUID(),source:{kind:'module' as const,sourceId:'.cbim/workspace/m'+index}})),knowledgeSourceChanges:[sample],sourceCursor:sample.sourceCursor};
  expect(()=>applyKnowledgeSourceChange(full,prepare(full))).toThrow(/代次数量/);
  const large={...sample,padding:'x'.repeat(knowledgeSourceLimits.eventBytes-200)};
  const history=Array.from({length:32},(_,index)=>({...large,changeId:String(index)}));const state={...empty(),knowledgeSourceChanges:history,sourceCursor:{...sample.sourceCursor,seq:history.length}};
  expect(()=>applyKnowledgeSourceChange(state,prepare(state))).toThrow(/保留容量/);
  const bad=structuredClone(sample);bad.recordedAt='2026-11-08T06:00:00.'+'1'.repeat(100)+'Z';bad.transition.preparedAt=bad.recordedAt;bad.transition.changes[0].next!.createdAt=bad.recordedAt;expect(knowledgeSourceChangeSchema.safeParse(bad).success).toBe(false);
  const biggest=resolve(evolve(empty(),sample),sample);biggest.workspaceId='𐀀'.repeat(256);biggest.sourceCursor.workspaceId=biggest.workspaceId;biggest.transitionId='𐀀'.repeat(512);biggest.committedRevision='𐀀'.repeat(512);expect(knowledgeSourceChangeSchema.safeParse(biggest).success).toBe(true);expect(new TextEncoder().encode(JSON.stringify(biggest)).length).toBeLessThan(knowledgeSourceLimits.terminalReserveBytes);
});

it('已有代次字段不能被普通岗位编辑、暂停或责任解除暗中删除',async()=>{
  const f=await setup();try{await memberCommit(f.store,memberMutation(await f.store.read()));await ownerCommit(f.store,ownerMutation(await f.store.read()));const state=await f.store.read(),binding=state.moduleOwnerships![0],unlink=ownerMutation(state,{moduleId:binding.moduleId,expectedBinding:{bindingId:binding.bindingId,revision:binding.revision,ownerMemberId:binding.ownerMemberId},nextOwner:null,reason:'unlink'});
    delete unlink.event.next.sourceRef;unlink.mutation.receipt=moduleOwnershipReceipt(unlink.event);const bytes=await fs.readFile(f.file);await expect(ownerCommit(f.store,unlink)).rejects.toThrow(/不能改写来源/);expect(await fs.readFile(f.file)).toEqual(bytes);
    const member=state.workspaceMembers![0],retire=memberMutation(state,false,{kind:'state',memberId:member.memberId,expectedRevision:member.revision,nextState:'retired',reason:'retire'});await expect(memberCommit(f.store,retire)).rejects.toMatchObject({code:'MEMBER_OWNERSHIP_ACTIVE'});expect(await f.store.read()).toEqual(state);
  }finally{await f.cleanup()}
});
