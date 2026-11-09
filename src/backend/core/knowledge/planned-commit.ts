/**
 * 作用定位：对象与资源包私有提交计划的不可变协议，供领域规划和本机固定目录加载共用。
 * 设计原因：净文件差异不足以保留整体替换语义；操作、目标域及原请求共同参与指纹，缓存回执不改变原意图。公共知识请求不接受这些证明字段。
 */
import {z} from 'zod';
import {hash,json} from '../foundation/serialization';
import {fail} from '../foundation/errors';

// 旧内部调用可直接传 KnowledgeFile（带 hash）；保留其原请求指纹，但该 hash 不参与写入或来源证明。
export const plannedRequestSchema=z.object({workspaceId:z.string().min(1),instanceId:z.string().uuid(),revision:z.string().min(1),requestId:z.string().regex(/^[A-Za-z0-9_-]{8,100}$/),changes:z.array(z.object({path:z.string().min(1),text:z.string().nullable(),hash:z.string().optional()}).strict())}).strict();
const path=z.string().min(1).max(2048),digest=z.string().regex(/^[a-f0-9]{64}$/);
export const resolvedObjectOperationSchema=z.object({kind:z.enum(['agent','module','skill','workflow']),action:z.enum(['create','update','delete']),id:path,cascade:z.boolean().optional()}).strict();
export type ResolvedObjectOperation=z.infer<typeof resolvedObjectOperationSchema>;
const objectBody={version:z.literal(2),request:plannedRequestSchema,operations:z.array(resolvedObjectOperationSchema).min(1),deletedRoots:z.array(path)};
export const objectPlanV2Schema=z.object({...objectBody,planHash:digest}).strict();
export type ObjectPlanV2=z.infer<typeof objectPlanV2Schema>;
const packageBody={version:z.literal(2),request:plannedRequestSchema,source:z.object({repositoryId:z.string().uuid(),repositoryRevision:z.string().min(1),resourceId:z.string().uuid(),contentHash:digest}).strict(),kind:z.enum(['team','agent','skill','architecture']),mode:z.enum(['add','replace']),targetRoot:path,createdRoots:z.array(path),deletedRoots:z.array(path)};
export const packagePlanBodySchema=z.object(packageBody).strict();
export const packagePlanV2Schema=packagePlanBodySchema.extend({planHash:digest}).strict();
export type PackagePlanV2=z.infer<typeof packagePlanV2Schema>;
export type PlannedKnowledgeCommit=ObjectPlanV2|PackagePlanV2;
export type KnowledgePlanRef={kind:'object_plan'|'package_plan';planId:string};
/** 仅不可变计划正文参与 hash；调用者必须剔除可变缓存，不能用旧 request-only 指纹升级意图。 */
export function knowledgePlanHash(plan:Omit<ObjectPlanV2,'planHash'>|Omit<PackagePlanV2,'planHash'>|PlannedKnowledgeCommit){const {planHash:_,...body}=plan as PlannedKnowledgeCommit;return hash(json(body))}
/** 从原保存计划核验完整协议；此函数不读取路径，实际 loader 仍须检查归属、链接与大小。 */
export function checkedKnowledgePlan(kind:KnowledgePlanRef['kind'],raw:unknown):PlannedKnowledgeCommit{
  const parsed=(kind==='object_plan'?objectPlanV2Schema:packagePlanV2Schema).safeParse(raw);
  if(!parsed.success)fail('SOURCE_PLAN_INVALID','知识计划缺少完整来源语义或已改变，请重新预览');
  // strict 校验不替换原 wire；原 request 的字段顺序属于现有事务 fingerprint，不能被 Schema 重排。
  const plan=raw as PlannedKnowledgeCommit;
  if(knowledgePlanHash(plan)!==plan.planHash)fail('SOURCE_PLAN_INVALID','知识计划指纹不一致');
  if('mode' in plan&&plan.mode==='replace'&&(!['team','architecture'].includes(plan.kind)||plan.targetRoot!==(plan.kind==='team'?'.cbim/team':'.cbim/workspace')||plan.deletedRoots.length!==1||plan.deletedRoots[0]!==plan.targetRoot))fail('SOURCE_PLAN_INVALID','整体替换计划范围不一致');
  if('mode' in plan&&plan.mode==='add'&&plan.deletedRoots.length)fail('SOURCE_PLAN_INVALID','新增计划不能携带替换范围');
  return plan;
}
