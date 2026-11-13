/**
 * 作用定位：声明子 Agent 当前话题上下文的不可变引用契约。
 * 设计原因：逻辑 Session 长期保留，模型资料只引用当前话题；记录正文仍归原目标和任务，运行仅保存引用，不复制另一份聊天历史。
 */
import {z} from 'zod';

const id=z.string().min(1).max(512),revision=z.number().int().positive().safe();
export const memberTopicContextSchema=z.object({version:z.literal(1),workspaceId:id,rootSessionId:id,scopeId:id,sessionId:id,agentId:id,inputRevision:revision.max(32),priorTasks:z.array(z.object({taskId:id,planRevision:revision,resultId:id}).strict()).max(20),omittedTasks:z.number().int().nonnegative().safe()}).strict();
export type MemberTopicContext=z.infer<typeof memberTopicContextSchema>;
