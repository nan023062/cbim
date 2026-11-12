/**
 * 目录归属：backend/main/registry；岗位、责任与来源协调。
 * 作用定位：将原知识事务的来源屏障与岗位/责任的明确来源采纳接到唯一 DispatchStore。
 * 设计原因：代次只从受控创建或本次明确观察建立；正式知识写之前先保存 pending，成功依据原 journal 结算，不另建来源 registry 或复制知识正文。
 * 锁序：调用方持知识 serial 时只等待本 Store 事务；本文件的事务回调不得反向排队知识方法。
 */
import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {hash,json} from '../../core/foundation/serialization';
import {parseJson} from '../../core/foundation/json';
import {fail} from '../../core/foundation/errors';
import type {DispatchState,DispatchStore} from '../../core/dispatch/dispatch-storage';
import type {ChangeRequest,Snapshot} from '../../core/knowledge/types';
import type {KnowledgeWorkspace} from '../../core/knowledge/ports';
import type {PlannedKnowledgeCommit} from '../../core/knowledge/planned-commit';
import {knowledgeSourceKey,type KnowledgeSourceKey,type KnowledgeSourceObservation,type KnowledgeSourceMutationPlan,type KnowledgeSourceReadState,type CapabilitySourceRef,type KnowledgeSourceCapture,type SourceSelection} from '../../core/workspace/knowledge-source';
import {currentKnowledgeSource,knowledgeSourceRef,knowledgeSourceSelection,knowledgeSourcePending,nextKnowledgeSourceCursor,knowledgeSourceCommand,knowledgeSourceReceipt,createKnowledgeSourceCapture,knowledgeSourceStatus,applyKnowledgeSourceChange} from '../../core/workspace/knowledge-source-rules';
import {sourceJournalHash,sourceTransitionId,type KnowledgeSourceJournal,type KnowledgeSourceAuthority} from '../knowledge/source-journal';

/** 仅 Main 服务使用的知识锁端口；领域 KnowledgeWorkspace 不暴露 Store 或来源签发能力。 */
export interface KnowledgeSourceWorkspace extends KnowledgeWorkspace {readonly sources?:KnowledgeSources;withSourceSnapshot<T>(operation:(snapshot:Snapshot)=>Promise<T>):Promise<T>}

/** 只读取同次校验的有效注册表与原定义字节；模块可见性不等于 tree.nodes 中存在。 */
export function sourceObservations(snapshot:Snapshot){
  if(!snapshot.validation)fail('SOURCE_INVALID','来源观察缺少知识校验');
  const result=new Map<string,{source:KnowledgeSourceKey;observation:KnowledgeSourceObservation}>();
  const add=(kind:'agent'|'module',sourceId:string)=>{const file=snapshot.files.find(f=>f.path===sourceId+(kind==='agent'?'/agent.json':'/module.json'));if(!file||file.hash!==hash(file.text))fail('SOURCE_INVALID','来源定义字节不完整');const source={kind,sourceId};result.set(knowledgeSourceKey(source),{source,observation:{knowledgeRevision:snapshot.revision,definitionHash:file.hash,visible:true}})};
  const team=parseJson(snapshot.validation.indexes['.cbim/team/registry.json']),modules=parseJson(snapshot.validation.indexes['.cbim/workspace/registry.json']);
  if(!Array.isArray(team.groups)||!Array.isArray(modules.modules))fail('SOURCE_INVALID','来源注册表无效');
  for(const group of team.groups){if(!Array.isArray(group.agents))fail('SOURCE_INVALID','角色注册表无效');for(const agent of group.agents)add('agent',agent.id)}
  for(const module of modules.modules)add('module',module.id);
  return result;
}
/** 所有来源 heads 都从共享日志读取；本协调器不拥有第二份可变登记文件。 */
export class KnowledgeSources implements KnowledgeSourceAuthority {
  constructor(readonly workspaceId:string,private readonly store:DispatchStore){}
  async build(request:ChangeRequest,current:Snapshot,projected:Snapshot,before:Record<string,string|null>,after:Record<string,string|null>,plan?:PlannedKnowledgeCommit):Promise<KnowledgeSourceJournal>{
    const state=await this.store.read();this.assertAvailable(state);
    const previous=sourceObservations(current),next=sourceObservations(projected),transitionId=sourceTransitionId(request.workspaceId,request.requestId),time=new Date().toISOString(),changes:KnowledgeSourceMutationPlan[]=[];
    const resetRoots=plan?('mode' in plan?plan.mode==='replace'?[plan.targetRoot]:[]:plan.operations.filter(op=>op.action==='delete'&&(op.kind==='agent'||op.kind==='module')).map(op=>op.id)):[];
    const keys=new Map([...previous,...next]);for(const item of state.knowledgeSourceGenerations??[])if(!item.retired)keys.set(knowledgeSourceKey(item.source),{source:item.source,observation:{knowledgeRevision:current.revision,definitionHash:hash(''),visible:true}});
    for(const [key,{source}] of [...keys].sort(([a],[b])=>a.localeCompare(b))){
      const existing=currentKnowledgeSource(state,source),old=previous.get(key),value=next.get(key),reset=resetRoots.some(root=>source.sourceId===root||source.sourceId.startsWith(root+'/'));
      const definition=source.sourceId+(source.kind==='agent'?'/agent.json':'/module.json'),hadDefinition=current.files.some(file=>file.path===definition);
      if(!value){if(existing&&(old||hadDefinition)){const hidden=source.kind==='module'&&projected.files.some(f=>f.path===definition);changes.push({source,previous:knowledgeSourceRef(existing),next:null,reason:hidden?'hidden':'deleted'})}continue}
      // 无效定义会被真实校验器从派生索引省略。普通修复不证明对象曾被删除，不能借 !old 伪造新代次。
      const uncertainBefore=!old&&hadDefinition&&!current.validation?.structural;
      if((!old&&!uncertainBefore)||reset){
        const replaced=!!existing||reset;
        changes.push({source,previous:existing?knowledgeSourceRef(existing):null,next:{version:1,workspaceId:this.workspaceId,source,generationId:randomUUID(),origin:replaced?'controlled_replace':'controlled_create',createdAt:time,createdChangeId:transitionId},reason:replaced?'replaced':'created'});
      }
    }
    const result:KnowledgeSourceJournal={version:1,request:structuredClone(request),...(plan?{plan:structuredClone(plan)}:{}),beforeHash:hash(json(before)),afterHash:hash(json(after)),transition:{version:1,transitionId,workspaceId:this.workspaceId,instanceId:request.instanceId,requestId:request.requestId,requestFingerprint:hash(json(request)),journalBindingHash:'0'.repeat(64),expectedSourceCursor:state.sourceCursor??null,changes,state:'pending',preparedAt:time}};
    result.transition.journalBindingHash=sourceJournalHash(result);
    // 在写 prepared journal 前预检事件/代次及 terminal 预留；真正 prepare 仍在 Store 内复验 CAS。
    applyKnowledgeSourceChange(state,{version:1,kind:'prepared',changeId:randomUUID(),workspaceId:this.workspaceId,sourceCursor:nextKnowledgeSourceCursor(state,randomUUID()),recordedAt:time,transition:result.transition});
    return result;
  }
  /** 原 prepared 已可靠保存才进入此入口；保存失败或未知不能开始知识文件写入。 */
  async prepare(source:KnowledgeSourceJournal){
    const state=await this.store.read(),event={version:1 as const,kind:'prepared' as const,changeId:randomUUID(),workspaceId:this.workspaceId,sourceCursor:nextKnowledgeSourceCursor(state,randomUUID()),recordedAt:source.transition.preparedAt,transition:source.transition};
    await this.store.transact(knowledgeSourceCommand(event),async current=>{if(!isDeepStrictEqual(current.sourceCursor??null,source.transition.expectedSourceCursor))fail('SOURCE_STALE','来源登记已变化，未写入知识');return {knowledgeSourceChanges:[event],receipt:knowledgeSourceReceipt(event)}});
  }
  /** 只按原 journal 事实结算；不得在调用方的知识 rollback catch 内执行。 */
  async settle(source:KnowledgeSourceJournal,outcome:'committed'|'rolled_back',proofHash:string,revision?:string){
    const state=await this.store.read(),transition=state.knowledgeSourceTransitions?.find(x=>x.transitionId===source.transition.transitionId);if(!transition){if(outcome==='rolled_back')return;fail('SOURCE_JOURNAL_INVALID','知识成功缺少原来源屏障')}
    if(transition.state!=='pending'){if(transition.state!==outcome||transition.resolved?.journalProofHash!==proofHash)fail('SOURCE_JOURNAL_INVALID','来源结算与原日志不同');return}
    await this.verify(source,true);
    const event={version:1 as const,kind:'resolved' as const,changeId:randomUUID(),workspaceId:this.workspaceId,sourceCursor:nextKnowledgeSourceCursor(state,randomUUID()),recordedAt:new Date().toISOString(),transitionId:transition.transitionId,requestFingerprint:transition.requestFingerprint,journalBindingHash:transition.journalBindingHash,outcome,journalProofHash:proofHash,...(revision?{committedRevision:revision}:{})};
    await this.store.transact(knowledgeSourceCommand(event),async()=>({knowledgeSourceChanges:[event],receipt:knowledgeSourceReceipt(event)}));
  }
  async verify(source:KnowledgeSourceJournal,required:boolean){const state=await this.store.read(),saved=state.knowledgeSourceTransitions?.find(x=>x.transitionId===source.transition.transitionId);if(!saved){if(required)fail('SOURCE_JOURNAL_INVALID','来源事务缺少持久屏障');return}const {resolved:_,...original}=saved;if(!isDeepStrictEqual({...original,state:'pending'},source.transition))fail('SOURCE_JOURNAL_INVALID','来源屏障与原知识事务不一致')}
  async pending(){return (await this.store.read()).knowledgeSourceTransitions?.filter(x=>x.state==='pending')??[]}
  async transitions(){return (await this.store.read()).knowledgeSourceTransitions??[]}
  assertAvailable(state:DispatchState){if(knowledgeSourcePending(state))fail('SOURCE_PENDING','来源事务尚未核实，暂不能采纳或建立新责任')}
  selection(state:DispatchState,snapshot:Snapshot,source:KnowledgeSourceKey):SourceSelection{this.assertAvailable(state);if(!snapshot.validation?.structural)fail('SOURCE_INVALID','来源知识结构尚未通过校验');const observation=sourceObservations(snapshot).get(knowledgeSourceKey(source));if(!observation)fail('SOURCE_MISSING','当前来源缺失或不可见');return knowledgeSourceSelection(state,source,observation.observation)}
  /** 首次观察仅在明确采纳事务中分配代次；预览不生成 UUID。 */
  capture(state:DispatchState,selection:SourceSelection,consumer:{kind:'workspace_member'|'module_ownership';changeId:string},at:string):{ref:CapabilitySourceRef;event?:KnowledgeSourceCapture}{
    this.assertAvailable(state);if(selection.kind==='builtin')return {ref:selection.ref};const current=currentKnowledgeSource(state,selection.source);if(current){if(!isDeepStrictEqual(selection.expectedRef,knowledgeSourceRef(current)))fail('SOURCE_STALE','来源代次已变化');return {ref:knowledgeSourceRef(current)}}
    if(selection.expectedRef)fail('SOURCE_STALE','原来源代次已退役');const event=createKnowledgeSourceCapture(state,selection,{changeId:randomUUID(),generationId:randomUUID(),streamId:randomUUID(),recordedAt:at,consumer});
    return {ref:knowledgeSourceRef(event.generation),event};
  }
  status(state:DispatchState,snapshot:Snapshot,source:KnowledgeSourceKey,saved?:CapabilitySourceRef):KnowledgeSourceReadState{
    const pending=knowledgeSourcePending(state);if(pending)return {status:'pending',transitionId:pending.transitionId};
    if(!snapshot.validation?.structural)return {status:'invalid',issue:'当前知识结构无法证明来源'};
    const observation=sourceObservations(snapshot).get(knowledgeSourceKey(source)),current=currentKnowledgeSource(state,source),ref=current?knowledgeSourceRef(current):undefined;
    if(saved&&!('kind' in saved)){const original=state.knowledgeSourceGenerations?.find(x=>x.generationId===saved.generationId);if(original?.retired)return {status:'retired',ref:saved,...(ref?{currentRef:ref}:{})}}
    if(!observation)return {status:'missing',issue:'来源定义缺失或不在当前有效注册表'};
    return knowledgeSourceStatus(state,source,saved&&!('kind' in saved)?saved:undefined,observation.observation);
  }
}
