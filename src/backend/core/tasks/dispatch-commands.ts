/**
 * 作用定位：第一阶段成员注册与主会话派发的命令及回执契约。
 * 设计原因：跨进程只传角色、模块、目标及负责人/流程预期，不接收伪造实例、岗位正文或来源证明；旧请求形状仅保留原命令查询兼容，新许可另由可信服务和 Store 强制。
 */
import {z} from 'zod';
import type {AgentInstance, AgentSessionBinding} from '../team/agent-types';
import type {AgentRef, GraphCursor} from './graph-types';
import {workflowSelectionsSchema,validateWorkflowSelections} from './workflow-selection';
import {ownerExecutionSelectionSchema} from '../team/member-execution-binding';

const identifier=z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/);
const text=z.string().trim().min(1).max(16000);
/** 此 ID 不用于文件路径；协议仍限制字符和长度，避免混淆旧路径式知识 ID。 */
export const graphIdentityInput=z.object({workspaceId:identifier,rootSessionId:identifier}).strict();
export const openGraphInput=graphIdentityInput.extend({commandId:identifier}).strict();
export const createMemberInput=openGraphInput.extend({agentId:text.max(512)}).strict();
/** 工具可复用字段声明重命名 assignee；完整输入仍通过下方跨模块选择校验。 */
export const dispatchTaskFields=z.object({
    assigneeAgentId:text.max(512),
    moduleIds:z.array(text.max(512)).min(1).max(50),
    workflowSelections:workflowSelectionsSchema.optional(),
    ownerSelection:ownerExecutionSelectionSchema.optional(),
    goal:text,
    acceptance:z.array(z.object({id:identifier,text}).strict()).min(1).max(50),
    prerequisites:z.array(z.object({taskId:identifier,expectedPlanRevision:z.number().int().min(1).max(Number.MAX_SAFE_INTEGER)}).strict()).max(100).default([]),
  }).strict();
export const dispatchTaskInput=openGraphInput.extend({
  expectedParentRevision:z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  // 缺省只供原命令查询兼容；新工具、服务和 Store 各自要求选择，不能由解析兼容取得新派发许可。
  task:dispatchTaskFields.superRefine((value,context)=>{try{validateWorkflowSelections(value.moduleIds,value.workflowSelections)}catch{context.addIssue({code:'custom',message:'Workflow 选择不属于本次任务模块'})}if(value.ownerSelection&&(value.ownerSelection.expectedOwners.length!==value.moduleIds.length||!value.moduleIds.every(id=>value.ownerSelection!.expectedOwners.some(owner=>owner.moduleId===id))))context.addIssue({code:'custom',message:'负责人选择必须精确对应任务模块'})}),
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
