/**
 * 作用定位：主 Session 按话题检索归档的只读协议，供历史服务与主 Agent 工具共用。
 * 设计原因：目录只保存权威记录的引用，正文按版本分块读取；翻页不能把两个时刻的内容拼接，历史文字不成为新指令。
 */
import {z} from 'zod';
const id=z.string().min(1).max(512),offset=z.number().int().min(0).max(100000000).default(0);
const version=z.string().regex(/^[a-f0-9]{64}$/);
const page={offset,version:version.optional(),limit:z.number().int().min(1).max(50).default(20)};
export const officeHistoryQuerySchema=z.discriminatedUnion('action',[
  z.object({action:z.literal('topics'),...page}).strict(),
  z.object({action:z.literal('topic'),scopeId:id,...page}).strict(),
  z.object({action:z.literal('content'),scopeId:id,refId:id,offset,version:version.optional(),maxChars:z.number().int().min(1).max(16000).default(8000)}).strict(),
]);
export type OfficeHistoryQuery=z.infer<typeof officeHistoryQuerySchema>;
export const officeHistoryEntrySchema=z.object({refId:id,kind:z.enum(['goal','main-run','assignment','member-run','feedback']),actorId:id,taskId:id.optional(),runId:id.optional(),inputRevision:z.number().int().positive().optional()}).strict();
export type OfficeHistoryEntry=z.infer<typeof officeHistoryEntrySchema>;
const common={workspaceId:id,rootSessionId:id,version,offset:z.number().int().nonnegative(),nextOffset:z.number().int().nonnegative().optional()};
export const officeHistoryResultSchema=z.discriminatedUnion('action',[
  z.object({...common,action:z.literal('topics'),items:z.array(z.object({scopeId:id,status:z.enum(['active','waiting','closed']),title:z.string().max(240),followupOf:id.optional()}).strict()).max(50)}).strict(),
  z.object({...common,action:z.literal('topic'),scopeId:id,items:z.array(officeHistoryEntrySchema).max(50)}).strict(),
  z.object({...common,action:z.literal('content'),scopeId:id,refId:id,totalChars:z.number().int().nonnegative(),text:z.string().max(16000)}).strict(),
]);
export type OfficeHistoryResult=z.infer<typeof officeHistoryResultSchema>;
