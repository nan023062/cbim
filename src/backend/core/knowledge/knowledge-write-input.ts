/**
 * 作用定位：知识提交工具与后端原事务核实共用的输入解析和原引用构造。
 * 设计原因：原 canonical 输入须经过与实际执行相同的字段解析才能核对请求指纹；refresh 仅识别可信授权 v2，旧内部随机 ID 不猜测。计划校验属于后端，不经公开观察 DTO 将 Node 依赖带入渲染进程。
 */
import {z} from 'zod';
import {plannedRequestSchema} from './planned-commit';
import type {ChangeRequest} from './types';

const toolIdentity={workspaceId:z.string(),instanceId:z.string()};
// 与既有 ToolRegistry 保持同样的 strip 语义及字段顺序；这里解析字段，不授予调用权限。
export const knowledgeCommitInputSchema=z.object({...toolIdentity,revision:z.string(),requestId:z.string(),changes:z.array(z.object({path:z.string(),text:z.string().nullable()})).max(1000)});
export const knowledgeObjectCommitInputSchema=z.object({...toolIdentity,planId:z.string()});
/** v2 刷新只接固定原版本及请求 ID；不接受正文变更或由当前快照代填原请求。 */
export const knowledgeRefreshInputSchema=z.object({workspaceId:z.string().min(1),instanceId:z.string().uuid(),revision:z.string().min(1),requestId:z.string().regex(/^[A-Za-z0-9_-]{8,100}$/)});
export type KnowledgeRefreshInput=z.infer<typeof knowledgeRefreshInputSchema>;
/** 字段顺序与实际提交保持一致；空 changes 只允许事务生成派生索引。 */
export function knowledgeRefreshRequest(input:KnowledgeRefreshInput):ChangeRequest{return {...knowledgeRefreshInputSchema.parse(input),changes:[]}}
export type KnowledgeWriteReference={kind:'request';request:ChangeRequest}|{kind:'object_plan';workspaceId:string;instanceId:string;planId:string};
/** 重现实际工具解析，不访问当前实例、文件或知识服务；无安全原引用时不猜测请求。 */
export function originalKnowledgeWrite(name:string,raw:unknown,contractVersion?:number):KnowledgeWriteReference|undefined{
  if(name==='cbim_knowledge_refresh'){
    if(contractVersion!==2)return;
    const parsed=knowledgeRefreshInputSchema.safeParse(raw);if(!parsed.success)return;
    return {kind:'request',request:knowledgeRefreshRequest(parsed.data)};
  }
  if(name==='cbim_knowledge_commit'){
    const parsed=knowledgeCommitInputSchema.safeParse(raw);
    if(!parsed.success||!plannedRequestSchema.safeParse(parsed.data).success)return;
    return {kind:'request',request:parsed.data};
  }
  if(name==='cbim_object_commit'){
    const parsed=knowledgeObjectCommitInputSchema.safeParse(raw);
    if(!parsed.success||!parsed.data.workspaceId||!z.string().uuid().safeParse(parsed.data.instanceId).success||!z.string().uuid().safeParse(parsed.data.planId).success)return;
    return {kind:'object_plan',...parsed.data};
  }
}
/** 查询身份来自原工具参数或原 planId，不取当前实例身份替换历史。 */
export function originalKnowledgeIdentity(reference:KnowledgeWriteReference){return reference.kind==='request'?{workspaceId:reference.request.workspaceId,instanceId:reference.request.instanceId,requestId:reference.request.requestId}:{workspaceId:reference.workspaceId,instanceId:reference.instanceId,requestId:reference.planId}}
