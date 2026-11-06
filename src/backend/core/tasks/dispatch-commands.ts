/**
 * 作用定位：第一阶段成员注册与主会话派发的命令及回执契约。
 * 设计原因：跨进程只传角色、模块和目标，不接收伪造的成员实例、维护关系或执行状态；内核再解析真实知识。
 */
import {z} from 'zod';
import type {AgentInstance, AgentSessionBinding} from '../team/agent-types';
import type {AgentRef, GraphCursor} from './graph-types';

const identifier=z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/);
const text=z.string().trim().min(1).max(16000);
/** 此 ID 不用于文件路径；协议仍限制字符和长度，避免混淆旧路径式知识 ID。 */
export const graphIdentityInput=z.object({workspaceId:identifier,rootSessionId:identifier}).strict();
export const openGraphInput=graphIdentityInput.extend({commandId:identifier}).strict();
export const createMemberInput=openGraphInput.extend({agentId:text.max(512)}).strict();
export const dispatchTaskInput=openGraphInput.extend({
  expectedParentRevision:z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  task:z.object({
    assigneeAgentId:text.max(512),
    moduleIds:z.array(text.max(512)).min(1).max(50),
    goal:text,
    acceptance:z.array(z.object({id:identifier,text}).strict()).min(1).max(50),
    prerequisites:z.array(z.object({taskId:identifier,expectedPlanRevision:z.number().int().min(1).max(Number.MAX_SAFE_INTEGER)}).strict()).max(100).default([]),
  }).strict(),
}).strict();
export type OpenGraphInput=z.infer<typeof openGraphInput>;
export type CreateMemberInput=z.infer<typeof createMemberInput>;
export type DispatchTaskInput=z.infer<typeof dispatchTaskInput>;
/** 建图只注册主成员与独立逻辑通道，不启动模型进程。 */
export interface OpenGraphReceipt {agent:AgentRef;cursor:GraphCursor}
/** member 的活动和任务引用限定于本图；agentSessionIds 仅包含当前通道，不是全局实例详情。 */
export interface CreateMemberReceipt extends OpenGraphReceipt {member:AgentInstance;session:AgentSessionBinding}
/** 成功仅代表派发已可靠排队，尚未交给大脑执行。 */
export interface DispatchReceipt {
  commandId:string;taskId:string;messageId:string;cursor:GraphCursor;
  disposition:'queued'|'waiting';
}
