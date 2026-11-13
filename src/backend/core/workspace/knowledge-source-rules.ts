/**
 * 作用定位：来源代次日志的纯投影、游标、依据和幂等命令规则，供知识协调器与 DispatchStore 共同使用。
 * 算法边界：复用后端 orderJsonValue，保留字符序、原 undefined 规则及历史序列化字节；业务身份与指纹内容仍在本模块。
 * 设计原因：只有原日志决定当前代次；prepare 不改变头，原 journal 证明的 committed 才退休/创建，rollback 不伪造新来源。
 * 职责边界：不读取文件或知识队列，不能自行证明 journal；调用者须在知识串行区提供真实事实。
 */
import {orderJsonValue} from '../../../core/utility';
import {hash} from '../foundation/serialization';
import {fail} from '../foundation/errors';
import {knowledgeSourceChangeSchema,knowledgeSourceLimits,knowledgeSourceKey,sameKnowledgeSourceKey,type KnowledgeSourceKey,type KnowledgeSourceRef,type KnowledgeSourceGeneration,type KnowledgeSourceChange,type KnowledgeSourceTransition,type KnowledgeSourceCursor,type KnowledgeSourceObservation,type SourceSelection,type KnowledgeSourceReceipt,type KnowledgeSourceCapture,type KnowledgeSourceReadState,type CapabilitySourceRef} from './knowledge-source';

export interface KnowledgeSourceRegistry {
  workspaceId:string;knowledgeSourceGenerations?:readonly KnowledgeSourceGeneration[];knowledgeSourceTransitions?:readonly KnowledgeSourceTransition[];
  knowledgeSourceChanges?:readonly KnowledgeSourceChange[];sourceCursor?:KnowledgeSourceCursor|null;
}
/** 固定 JSON 对象键序、保持数组次序；不对客户端内容作默认补值或转换。 */
export function knowledgeSourceCanonical(value:unknown):string {
  const order=(value:unknown):unknown=>orderJsonValue(value,{compareKeys:(a,b)=>a<b?-1:a>b?1:0,omitUndefinedProperties:true});
  return JSON.stringify(order(value));
}
const equal=(a:unknown,b:unknown)=>knowledgeSourceCanonical(a)===knowledgeSourceCanonical(b);
const bytes=(value:unknown)=>new TextEncoder().encode(JSON.stringify(value)).length;
function check(value:unknown,message:string,code='SOURCE_AUDIT'):asserts value{if(!value)fail(code,message)}
/** 只返回身份，不把当前退休状态或捕获时钟复制进消费者固定引用。 */
export function knowledgeSourceRef(value:KnowledgeSourceGeneration):KnowledgeSourceRef{return {version:1,workspaceId:value.workspaceId,source:structuredClone(value.source),generationId:value.generationId}}
/** 当前头由全部历史中过滤非退役代次得出；完整投影保证每个逻辑来源最多一个。 */
export function currentKnowledgeSource(state:KnowledgeSourceRegistry,key:KnowledgeSourceKey){return state.knowledgeSourceGenerations?.find(value=>sameKnowledgeSourceKey(value.source,key)&&!value.retired)}
/** 任一未结算知识事务形成工作区级短屏障，不将 unknown 推断为失败。 */
export function knowledgeSourcePending(state:KnowledgeSourceRegistry){return state.knowledgeSourceTransitions?.find(value=>value.state==='pending')}
/** streamId 仅在首次事件使用；已有流不可被调用方替换。 */
export function nextKnowledgeSourceCursor(state:KnowledgeSourceRegistry,streamId:string):KnowledgeSourceCursor{return {kind:'knowledge_sources',workspaceId:state.workspaceId,streamId:state.sourceCursor?.streamId??streamId,seq:(state.sourceCursor?.seq??0)+1}}
/** 只固定已观察来源与当前头，不分配 UUID、不写日志，供明确预览依据使用。 */
export function knowledgeSourceSelection(state:KnowledgeSourceRegistry,key:KnowledgeSourceKey,observation:KnowledgeSourceObservation):SourceSelection{
  check(!knowledgeSourcePending(state),'知识来源仍待原日志结算','SOURCE_PENDING');const current=currentKnowledgeSource(state,key);
  return {kind:'workspace',workspaceId:state.workspaceId,source:structuredClone(key),expectedRef:current?knowledgeSourceRef(current):null,observation:structuredClone(observation)};
}
/** 只派生读取状态；来源不可见/损坏应由真实读取方先返回 missing/invalid，不能靠此函数猜不存在。 */
export function knowledgeSourceStatus(state:KnowledgeSourceRegistry,key:KnowledgeSourceKey,adopted:KnowledgeSourceRef|undefined,observation:KnowledgeSourceObservation):KnowledgeSourceReadState{
  const pending=knowledgeSourcePending(state);if(pending)return {status:'pending',transitionId:pending.transitionId};
  const current=currentKnowledgeSource(state,key);
  if(adopted){const old=state.knowledgeSourceGenerations?.find(item=>equal(knowledgeSourceRef(item),adopted));if(!old)return {status:'unverifiable',issue:'已采纳代次缺少来源日志'};if(old.retired)return {status:'retired',ref:adopted,...(current?{currentRef:knowledgeSourceRef(current)}:{})};if(current&&equal(knowledgeSourceRef(current),adopted))return {status:'current',ref:adopted};return {status:'unverifiable',issue:'已采纳代次与来源头不一致'};}
  return current?{status:'needs_adoption',currentRef:knowledgeSourceRef(current)}:{status:'untracked',source:key,observation};
}
/** 新捕获与消费者同一提交；预览只使用 selection，UUID/时间不得进入预览依据。 */
export function createKnowledgeSourceCapture(state:KnowledgeSourceRegistry,selection:Extract<SourceSelection,{kind:'workspace'}>,facts:{changeId:string;generationId:string;streamId:string;recordedAt:string;consumer:KnowledgeSourceCapture['consumer']}):KnowledgeSourceCapture{
  check(selection.workspaceId===state.workspaceId&&!selection.expectedRef&&!currentKnowledgeSource(state,selection.source),'来源已被捕获，请重新预览','SOURCE_STALE');
  const event:KnowledgeSourceCapture={version:1,kind:'capture',changeId:facts.changeId,workspaceId:state.workspaceId,sourceCursor:nextKnowledgeSourceCursor(state,facts.streamId),recordedAt:facts.recordedAt,generation:{version:1,workspaceId:state.workspaceId,source:structuredClone(selection.source),generationId:facts.generationId,origin:'observed_existing',createdAt:facts.recordedAt,createdChangeId:facts.changeId},observation:structuredClone(selection.observation),consumer:structuredClone(facts.consumer)};
  check(knowledgeSourceChangeSchema.safeParse(event).success,'来源捕获结构无效');return event;
}
/** capture 使用消费者命令；独立 prepare/resolve 使用原 transition 命名空间。 */
export function knowledgeSourceCommand(event:Exclude<KnowledgeSourceChange,KnowledgeSourceCapture>){
  const transitionId=event.kind==='prepared'?event.transition.transitionId:event.transitionId;
  const proof=event.kind==='prepared'?event.transition:{transitionId:event.transitionId,requestFingerprint:event.requestFingerprint,journalBindingHash:event.journalBindingHash,outcome:event.outcome,journalProofHash:event.journalProofHash,...(event.committedRevision?{committedRevision:event.committedRevision}:{})};
  return {commandId:`knowledge-source-${event.kind}-${transitionId}`,fingerprint:hash(knowledgeSourceCanonical({domain:'knowledge-source-v1',workspaceId:event.workspaceId,proof}))};
}
/** 紧凑回执仅映射本次原事件，不读取今天的来源头或知识。 */
export function knowledgeSourceReceipt(event:Exclude<KnowledgeSourceChange,KnowledgeSourceCapture>):KnowledgeSourceReceipt{
  const proof=event.kind==='prepared'?event.transition:event;
  return {workspaceId:event.workspaceId,transitionId:proof.transitionId,state:event.kind==='prepared'?'pending':event.outcome,sourceCursor:structuredClone(event.sourceCursor),requestFingerprint:proof.requestFingerprint,journalBindingHash:proof.journalBindingHash};
}

/** 严格追加一个来源事件；所有历史保留，pending 容量预留使 terminal 不会因本域正常写满而永久卡住。 */
export function applyKnowledgeSourceChange(state:KnowledgeSourceRegistry,raw:KnowledgeSourceChange){
  check(knowledgeSourceChangeSchema.safeParse(raw).success,'来源事件结构无效');const event=raw,history=state.knowledgeSourceChanges??[],generations=state.knowledgeSourceGenerations??[],transitions=state.knowledgeSourceTransitions??[],cursor=state.sourceCursor??null;
  check(event.workspaceId===state.workspaceId,'来源事件工作区不一致');
  check(history.length===(cursor?.seq??0)&&(cursor?event.sourceCursor.streamId===cursor.streamId&&event.sourceCursor.seq===cursor.seq+1:event.sourceCursor.seq===1&&!generations.length&&!transitions.length),'来源流或审计前缀不一致');
  check(!history.some(item=>item.changeId===event.changeId),'来源事件身份重复');
  check(new Set(generations.map(item=>item.generationId)).size===generations.length&&new Set(generations.filter(item=>!item.retired).map(item=>knowledgeSourceKey(item.source))).size===generations.filter(item=>!item.retired).length,'来源投影包含重复代次或当前头');
  let nextGenerations=[...generations],nextTransitions=[...transitions];const pending=knowledgeSourcePending(state);
  if(event.kind==='capture'){
    check(!pending,'知识来源仍待结算','SOURCE_PENDING');
    check(!currentKnowledgeSource(state,event.generation.source)&&!generations.some(item=>item.generationId===event.generation.generationId)&&!transitions.some(item=>item.changes.some(change=>change.next?.generationId===event.generation.generationId)),'来源已经捕获或代次复用','SOURCE_STALE');
    nextGenerations.push(event.generation);
  }else if(event.kind==='prepared'){
    check(!pending,'知识来源仍待结算','SOURCE_PENDING');const value=event.transition;
    check(!transitions.some(item=>item.transitionId===value.transitionId||item.requestId===value.requestId),'来源请求或过渡身份重复');
    check(equal(value.expectedSourceCursor,cursor),'来源游标已变化','SOURCE_STALE');
    const planned=new Set<string>();
    for(const item of value.changes){
      const current=currentKnowledgeSource(state,item.source);check(equal(current?knowledgeSourceRef(current):null,item.previous),'来源原代次已变化','SOURCE_STALE');
      if(item.next){check(!generations.some(old=>old.generationId===item.next!.generationId)&&!transitions.some(old=>old.changes.some(change=>change.next?.generationId===item.next!.generationId))&&!planned.has(item.next.generationId),'新代次不可复用');planned.add(item.next.generationId);check(item.next.origin===(item.reason==='replaced'?'controlled_replace':'controlled_create'),'受控来源起因与计划不一致');}
    }
    check(generations.length+planned.size<=knowledgeSourceLimits.generations,'来源代次数量超过上限','SOURCE_LIMIT');
    // 16 KiB 覆盖 terminal 所有严格字符串的最坏 UTF-8 大小（包括两处 workspace、transitionId 与知识 revision）。
    check(history.length+2<=knowledgeSourceLimits.events&&history.reduce((sum,item)=>sum+bytes(item),0)+bytes(event)+knowledgeSourceLimits.terminalReserveBytes<=knowledgeSourceLimits.historyBytes,'来源结算缺少保留容量','SOURCE_LIMIT');
    nextTransitions.push(value);
  }else{
    check(pending&&pending.transitionId===event.transitionId&&pending.requestFingerprint===event.requestFingerprint&&pending.journalBindingHash===event.journalBindingHash,'来源结算缺少匹配的原 pending');
    check(Date.parse(event.recordedAt)>=Date.parse(pending.preparedAt),'结算早于准备');
    if(event.outcome==='committed')for(const item of pending.changes){
      if(item.previous){const old=nextGenerations.find(value=>value.generationId===item.previous!.generationId);check(old&&!old.retired&&equal(knowledgeSourceRef(old),item.previous),'原代次不再是有效头');const reason=item.reason==='replaced'?'replaced':item.reason==='hidden'?'hidden':item.reason==='moved'?'moved':'deleted';nextGenerations=nextGenerations.map(value=>value.generationId===old.generationId?{...value,retired:{changeId:event.changeId,at:event.recordedAt,reason}}:value);}
      if(item.next)nextGenerations.push(item.next);
    }
    nextTransitions=transitions.map(value=>value.transitionId===event.transitionId?{...value,state:event.outcome,resolved:{at:event.recordedAt,journalProofHash:event.journalProofHash,...(event.committedRevision?{committedRevision:event.committedRevision}:{})}}:value);
  }
  check(nextGenerations.length<=knowledgeSourceLimits.generations&&history.length<knowledgeSourceLimits.events&&history.reduce((sum,item)=>sum+bytes(item),0)+bytes(event)<=knowledgeSourceLimits.historyBytes,'来源历史达到容量上限','SOURCE_LIMIT');
  return {knowledgeSourceGenerations:nextGenerations,knowledgeSourceTransitions:nextTransitions,knowledgeSourceChanges:[...history,event],sourceCursor:event.sourceCursor};
}

/** 消费者采用的 workspace 引用必须是同事务当前头；builtin 由能力内容指纹另核。 */
export function validateKnowledgeSourceSelection(state:KnowledgeSourceRegistry,selection:SourceSelection,ref:CapabilitySourceRef){
  check(!knowledgeSourcePending(state),'知识来源仍待原日志结算','SOURCE_PENDING');
  if(selection.kind==='builtin'){check(equal(selection.ref,ref),'内置来源与选择不一致');return;}
  check(selection.workspaceId===state.workspaceId&&!('kind' in ref)&&ref.workspaceId===state.workspaceId&&sameKnowledgeSourceKey(selection.source,ref.source),'来源选择与消费者不一致');
  const current=currentKnowledgeSource(state,selection.source);check(current&&equal(knowledgeSourceRef(current),ref),'采纳来源不是当前有效代次','SOURCE_STALE');
  if(selection.expectedRef)check(equal(selection.expectedRef,ref),'预览来源代次已经变化','SOURCE_STALE');
}
