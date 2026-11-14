/**
 * 作用定位：原知识事务的有界公开观察协议，供后端与界面共同校验，只有纯 Schema 依赖。
 * 设计原因：未知、未查到、回滚和已提交不能互相替代；摘要不携带正文或私有路径，后端请求/计划解析不经此文件进入渲染进程。
 */
import {z} from 'zod';
const id=z.string().min(1).max(512),digest=z.string().regex(/^[a-f0-9]{64}$/);
export const knowledgeTransactionObservationSchema=z.object({
  identity:z.object({workspaceId:id,instanceId:z.string().uuid(),requestId:z.string().regex(/^[A-Za-z0-9_-]{8,100}$/)}).strict(),
  state:z.enum(['absent','prepared','committing','committed','rolled_back','recovery_required','unverifiable']),
  /** 原实际解析请求的语义序列化指纹；计划缺失时不补造。 */
  requestHash:digest.optional(),
  /** 核实后的原 journal 阶段、前后字节及回执摘要，不表示今天的知识状态。 */
  evidenceHash:digest.optional(),
  revision:id.optional(),changedCount:z.number().int().nonnegative().max(10000).optional(),
  reason:z.enum(['original_plan_unavailable','original_record_unverifiable','query_unavailable']).optional(),
}).strict().superRefine((value,context)=>{
  const issue=(message:string)=>context.addIssue({code:'custom',message});
  if(value.state!=='unverifiable'&&!value.requestHash)issue('可核实阶段必须绑定原请求');
  if(!['absent','unverifiable'].includes(value.state)!==!!value.evidenceHash)issue('原持久阶段与证据摘要必须一致');
  if(value.state==='committed'?(value.revision===undefined||value.changedCount===undefined):(value.revision!==undefined||value.changedCount!==undefined))issue('仅原 committed 阶段可携带提交结果');
  if(value.state==='unverifiable'?!value.reason:value.reason!==undefined)issue('不可核实结果须明确缺失依据');
});
export type KnowledgeTransactionObservation=z.infer<typeof knowledgeTransactionObservationSchema>;
