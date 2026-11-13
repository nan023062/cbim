/**
 * 目录归属：backend/main/knowledge；知识物理事务与恢复。
 * 作用定位：知识 journal 的来源绑定与完整性核实，独立于两个存储队列。
 * 设计原因：Dispatch 只保存紧凑屏障，恢复所需的原请求及计划留在原知识日志；证明必须覆盖正文、派生索引和可信替换语义，不能根据当前文件猜成功。
 */
import {z} from 'zod';
import {isDeepStrictEqual} from 'node:util';
import {hash,json} from '../../../core/platform/node/serialization';
import {fail} from '../../../core/errors';
import {plannedRequestSchema,objectPlanV2Schema,packagePlanV2Schema,checkedKnowledgePlan,type PlannedKnowledgeCommit} from '../../../logic/knowledge/rules/planned-commit';
import {knowledgeSourceTransitionSchema,type KnowledgeSourceTransition} from '../../../logic/workspace/rules/knowledge-source';
import {knowledgeSourceCanonical} from '../../../logic/workspace/rules/knowledge-source-rules';
import type {ChangeRequest,Snapshot} from '../../../logic/knowledge/rules/types';
const digest=z.string().regex(/^[a-f0-9]{64}$/);
export const knowledgeSourceJournalSchema=z.object({version:z.literal(1),request:plannedRequestSchema,plan:z.union([objectPlanV2Schema,packagePlanV2Schema]).optional(),beforeHash:digest,afterHash:digest,transition:knowledgeSourceTransitionSchema}).strict();
export type KnowledgeSourceJournal=z.infer<typeof knowledgeSourceJournalSchema>;
/** 哈希不包含自身或可变结算结果；过往 committed 的证据不要求今天正文仍相同。 */
export function sourceJournalHash(source:KnowledgeSourceJournal){const {journalBindingHash:_,...transition}=source.transition;return hash(knowledgeSourceCanonical({...source,transition}))}
export function sourceTransitionId(workspaceId:string,requestId:string){return hash(json({kind:'knowledge-source',workspaceId,requestId}))}
export function checkedSourceJournal(raw:unknown,before:Record<string,string|null>,after:Record<string,string|null>,request:ChangeRequest):KnowledgeSourceJournal{
  const parsed=knowledgeSourceJournalSchema.safeParse(raw);if(!parsed.success)fail('SOURCE_JOURNAL_INVALID','来源事务记录格式无效');const value=raw as KnowledgeSourceJournal,t=value.transition;
  if(!isDeepStrictEqual(value.request,request)||t.workspaceId!==request.workspaceId||t.instanceId!==request.instanceId||t.requestId!==request.requestId||t.requestFingerprint!==hash(json(request))||t.transitionId!==sourceTransitionId(request.workspaceId,request.requestId)||t.state!=='pending'||value.beforeHash!==hash(json(before))||value.afterHash!==hash(json(after))||t.journalBindingHash!==sourceJournalHash(value))fail('SOURCE_JOURNAL_INVALID','来源事务与原请求或前后正文不一致');
  if(value.plan){const plan=checkedKnowledgePlan('operations' in value.plan?'object_plan':'package_plan',value.plan);if(!isDeepStrictEqual(plan.request,request))fail('SOURCE_JOURNAL_INVALID','来源计划未绑定原知识请求')}
  return value;
}
/** 只在 Main 私有装配中实现；prepare 必须可靠保存后才允许写知识，settle 位于知识回滚 catch 之外。 */
export interface KnowledgeSourceAuthority {
  build(request:ChangeRequest,current:Snapshot,projected:Snapshot,before:Record<string,string|null>,after:Record<string,string|null>,plan?:PlannedKnowledgeCommit):Promise<KnowledgeSourceJournal>;
  prepare(source:KnowledgeSourceJournal):Promise<void>;
  settle(source:KnowledgeSourceJournal,outcome:'committed'|'rolled_back',proofHash:string,revision?:string):Promise<void>;
  verify(source:KnowledgeSourceJournal,requirePending:boolean):Promise<void>;
  pending():Promise<readonly KnowledgeSourceTransition[]>;
  transitions():Promise<readonly KnowledgeSourceTransition[]>;
}
