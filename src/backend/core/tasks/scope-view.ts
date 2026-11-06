/**
 * 作用定位：定义主会话调度周期的公开摘要、选中详情和独立增量投影，供存储与界面共享。
 * 设计原因：目标计划与审阅不能推进用于证据校验的任务图游标；列表只传摘要，完整输入仅在选中周期变化时传输。
 * 职责边界：只投影已提交事实，不创建周期或推断验收；新周期只公开 origin/只读标识，不泄露原生上下文隔离清单。complete 审阅仍是申请，旧记录不补造 goal。
 */
import {z} from 'zod';
import {fail} from '../foundation/errors';
import {graphIdentityInput} from './dispatch-commands';
import type {DispatchScope} from './dispatch-scope';
import type {GraphIdentity,GraphDelta} from './graph-types';
import {assertGraphIdentity} from './graph-rules';
import {sameGoalValue,goalInputRevision,goalNeedsReplan} from './scope-goal';

const id=z.string().min(1).max(512);
const seq=z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const graphCursor=graphIdentityInput.extend({streamId:id,seq}).strict();
const scopeCursor=graphCursor.extend({kind:z.literal('scopes')}).strict();
const detailStamp=z.object({scopeId:id,streamId:id,seq:seq.min(1)}).strict();
const outcome=z.enum(['completed','failed','cancelled','interrupted']);
const waitSummary=z.object({waitId:id,reason:z.string().max(240),goalRevision:seq.min(1),createdAt:z.string()}).strict();
const summary=z.object({scopeId:id,status:z.enum(['active','waiting','closed']),createdAt:z.string(),closedAt:z.string().optional(),outcome:outcome.optional(),hasGoal:z.boolean(),goalRevision:seq.min(1).optional(),inputRevision:seq.min(1).optional(),needsReplan:z.boolean().optional(),inputPreview:z.string().max(240).optional(),objective:z.string().max(240).optional(),hasPlan:z.boolean(),reviewDecision:z.enum(['complete','replan','blocked','awaiting_user']).optional(),blockedReason:z.string().max(240).optional(),wait:waitSummary.optional(),readOnly:z.literal(true).optional(),origin:z.enum(['inspection','business_replan']).optional(),stamp:detailStamp}).strict();

/** 只读请求的身份及选择均显式传入；游标和 stamp 是缓存证明，不授予跨会话读取权。 */
export const dispatchSessionReadInput=z.object({identity:graphIdentityInput,graphCursor:graphCursor.optional(),scopeCursor:scopeCursor.optional(),selectedScopeId:id.optional(),detailStamp:detailStamp.optional(),limit:seq.min(1).max(500).optional()}).strict();
export type DispatchSessionReadInput=z.infer<typeof dispatchSessionReadInput>;
export type ScopeCursor=z.infer<typeof scopeCursor>;
/** seq 是本周期最后一次变更的 scope 流序号；block/close 即使 goal.revision 不变也会更换 stamp。 */
export type ScopeDetailStamp=z.infer<typeof detailStamp>;
export type ScopeSummary=z.infer<typeof summary>;
export interface ScopeSnapshot {identity:GraphIdentity;cursor:ScopeCursor;scopes:ScopeSummary[]}
/** 同一持久化事务中此主会话的全部周期变化构成一个批次；其他会话不会推进此序号。 */
export interface ScopeEventBatch {identity:GraphIdentity;streamId:string;seq:number;scopes:ScopeSummary[]}
export type ScopeResetReason='initial'|'stream_changed'|'cursor_ahead'|'history_compacted';
export type ScopeDelta=
  |{mode:'reset';reason:ScopeResetReason;snapshot:ScopeSnapshot;cursor:ScopeCursor}
  |{mode:'delta';from:ScopeCursor;cursor:ScopeCursor;batches:ScopeEventBatch[];hasMore:boolean}
  |{mode:'noop';cursor:ScopeCursor};
export type ScopeDetailRead=
  |{mode:'updated';stamp:ScopeDetailStamp;scope:DispatchScope}
  |{mode:'noop';stamp:ScopeDetailStamp}
  |{mode:'empty'};
/** 两条增量和详情来自同一已提交屏障；分页增量可尚未追到头部，详情始终反映该屏障的最新状态。 */
export interface DispatchSessionRead {graph:GraphDelta;scopes:ScopeDelta;detail:ScopeDetailRead}
/** 摘要增量与重复批次证明最多保留 256 批；更旧游标读取当前快照，原事务日志仍完整保留。 */
export const scopeViewHistoryLimit=256;

function valid(condition:unknown,message:string):asserts condition{if(!condition)fail('SCOPE_VIEW_INVALID',message)}
const preview=(value:string)=>value.replace(/\s+/g,' ').trim().slice(0,240);
/** 独立序列由原图流身份派生；重启重放得到相同 streamId，不写入第二份状态。 */
export function emptyScopeSnapshot(identity:GraphIdentity,graphStreamId:string):ScopeSnapshot{
  return {identity:{...identity},cursor:{...identity,kind:'scopes',streamId:'scopes:'+graphStreamId,seq:0},scopes:[]};
}
/** 白名单摘要不含完整输入、附件、证据正文、运行私有路径或邮箱；文本预览最多 240 字符。 */
export function summarizeScope(scope:DispatchScope,streamId:string,seq:number):ScopeSummary{
  const goal=scope.goal;
  return {scopeId:scope.scopeId,status:scope.status,createdAt:scope.createdAt,...(scope.closedAt?{closedAt:scope.closedAt}:{}),...(scope.outcome?{outcome:scope.outcome}:{}),hasGoal:!!goal,hasPlan:!!goal?.plan,
    ...(goal?{goalRevision:goal.revision,inputRevision:goalInputRevision(goal),needsReplan:goalNeedsReplan(goal),inputPreview:preview(goal.input.message)}:{}),
    ...(goal?.plan?{objective:preview(goal.plan.objective)}:{}),...(goal?.review?{reviewDecision:goal.review.decision}:{}),...(scope.recovery?{readOnly:true as const,origin:'inspection' as const}:scope.replan?{origin:'business_replan' as const}:{}),
    ...(goal?.blocked?{blockedReason:preview(goal.blocked.reason)}:{}),...(scope.wait?{wait:{waitId:scope.wait.waitId,reason:preview(scope.wait.reason),goalRevision:scope.wait.goalRevision,createdAt:scope.wait.createdAt}}:{}),stamp:{scopeId:scope.scopeId,streamId,seq}};
}
function validateSummaries(scopes:ScopeSummary[],cursor:Pick<ScopeCursor,'streamId'|'seq'>,batch=false){
  valid(Array.isArray(scopes)&&new Set(scopes.map(item=>item?.scopeId)).size===scopes.length,'周期摘要标识重复或集合无效');
  for(const item of scopes){
    valid(summary.safeParse(item).success,'周期摘要字段无效');
    valid(item.stamp.scopeId===item.scopeId&&item.stamp.streamId===cursor.streamId&&item.stamp.seq<=cursor.seq&&(!batch||item.stamp.seq===cursor.seq),'周期摘要与增量序号不一致');
    valid(item.hasGoal===(item.goalRevision!==undefined)&&(!item.hasPlan||item.hasGoal),'周期摘要目标版本不一致');
    valid(item.status!=='waiting'||item.wait&&item.hasGoal&&item.goalRevision===item.wait.goalRevision&&item.reviewDecision==='awaiting_user','等待周期缺少对应检查点');
  }
}
/** 界面恢复时校验身份和摘要，而非根据消息正文重建目标。 */
export function validateScopeSnapshot(snapshot:ScopeSnapshot):void{
  valid(snapshot&&graphIdentityInput.safeParse(snapshot.identity).success&&scopeCursor.safeParse(snapshot.cursor).success,'周期快照身份或游标无效');
  assertGraphIdentity(snapshot.identity,snapshot.cursor);validateSummaries(snapshot.scopes,snapshot.cursor);
}
const seenBatches=new WeakMap<ScopeSnapshot,Map<number,ScopeEventBatch>>();
/** 原子归并完整批次；未变摘要保持引用，只有已验证的同序号重放才能直接复用原快照。 */
export function applyScopeBatch(previous:ScopeSnapshot,event:ScopeEventBatch):ScopeSnapshot{
  valid(event&&graphIdentityInput.safeParse(event.identity).success&&id.safeParse(event.streamId).success&&seq.min(1).safeParse(event.seq).success,'周期增量字段无效');
  assertGraphIdentity(previous.identity,event.identity);
  valid(event.streamId===previous.cursor.streamId,'周期事件流已变化，须重读快照');
  valid(Array.isArray(event.scopes)&&event.scopes.length>0,'周期增量不能是空批次');
  validateSummaries(event.scopes,{streamId:event.streamId,seq:event.seq},true);
  const history=seenBatches.get(previous);
  if(event.seq<=previous.cursor.seq){if(sameGoalValue(history?.get(event.seq),event))return previous;fail('SCOPE_EVENT_CONFLICT','周期序号重复但缺少一致的重放证明')}
  if(event.seq!==previous.cursor.seq+1)fail('SCOPE_SEQUENCE_GAP','周期序号断档，需要补读');
  const values=new Map(previous.scopes.map(item=>[item.scopeId,item]));
  for(const item of event.scopes)values.set(item.scopeId,structuredClone(item));
  const next:ScopeSnapshot={identity:previous.identity,cursor:{...previous.cursor,seq:event.seq},scopes:[...values.values()]};
  const seen=new Map(history);seen.set(event.seq,structuredClone(event));
  while(seen.size>scopeViewHistoryLimit)seen.delete(seen.keys().next().value!);
  seenBatches.set(next,seen);return next;
}
/** 完整批次分页；没有变化时只返回游标，缺/未来/换流游标返回当前摘要快照。 */
export function readScopeDelta(snapshot:ScopeSnapshot,batches:readonly ScopeEventBatch[],cursor?:ScopeCursor,limit=100):ScopeDelta{
  valid(Number.isSafeInteger(limit)&&limit>=1&&limit<=500,'周期增量批次数必须为 1 至 500');
  const reset=(reason:ScopeResetReason):ScopeDelta=>({mode:'reset',reason,snapshot,cursor:snapshot.cursor});
  if(!cursor)return reset('initial');
  valid(scopeCursor.safeParse(cursor).success,'周期游标无效');assertGraphIdentity(snapshot.identity,cursor);
  if(cursor.streamId!==snapshot.cursor.streamId)return reset('stream_changed');
  if(cursor.seq>snapshot.cursor.seq)return reset('cursor_ahead');
  if(cursor.seq===snapshot.cursor.seq)return {mode:'noop',cursor:snapshot.cursor};
  const first=batches[0]?.seq;
  if(first===undefined||cursor.seq<first-1)return reset('history_compacted');
  const start=cursor.seq+1-first,selected=batches.slice(start,start+limit);
  valid(selected.length,'周期增量缺少已提交记录');let expected=cursor.seq+1;
  for(const event of selected){assertGraphIdentity(snapshot.identity,event.identity);valid(event.streamId===snapshot.cursor.streamId&&event.seq===expected++&&event.seq<=snapshot.cursor.seq,'周期增量断序');validateSummaries(event.scopes,{streamId:event.streamId,seq:event.seq},true)}
  const last=selected.at(-1)!.seq;
  valid(last===snapshot.cursor.seq||start+selected.length<batches.length,'周期增量未到持久化头部');
  return {mode:'delta',from:cursor,cursor:{...snapshot.cursor,seq:last},batches:selected,hasMore:last<snapshot.cursor.seq};
}
/**
 * 只读当前会话选中周期；缺省选 active/waiting 或最后创建的周期。stamp 相同则省略大正文。
 * 显式选择不存在/其他会话的周期拒绝，不静默跳转；旧 goal 继续缺省。
 */
export function readScopeDetail(snapshot:ScopeSnapshot,scopes:readonly DispatchScope[],selectedScopeId?:string,stamp?:ScopeDetailStamp):ScopeDetailRead{
  const selected=selectedScopeId?snapshot.scopes.find(item=>item.scopeId===selectedScopeId):snapshot.scopes.find(item=>item.status!=='closed')??snapshot.scopes.at(-1);
  if(!selected){if(selectedScopeId)fail('DISPATCH_SCOPE_IDENTITY','选中周期不属于当前主会话');return {mode:'empty'}}
  if(stamp&&sameGoalValue(stamp,selected.stamp))return {mode:'noop',stamp:selected.stamp};
  const scope=scopes.find(item=>item.scopeId===selected.scopeId&&item.workspaceId===snapshot.identity.workspaceId&&item.rootSessionId===snapshot.identity.rootSessionId);
  valid(scope,'周期详情与摘要不一致');
  return {mode:'updated',stamp:selected.stamp,scope:{scopeId:scope.scopeId,workspaceId:scope.workspaceId,rootSessionId:scope.rootSessionId,status:scope.status,createdAt:scope.createdAt,...(scope.goal?{goal:structuredClone(scope.goal)}:{}),...(scope.wait?{wait:structuredClone(scope.wait)}:{}),...(scope.continuations?{continuations:structuredClone(scope.continuations)}:{}),...(scope.closedAt?{closedAt:scope.closedAt}:{}),...(scope.outcome?{outcome:scope.outcome}:{})}};
}
