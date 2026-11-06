/**
 * 作用定位：定义按静态 Agent 归档的独立 Session、任务轮次及公开事件查询协议。
 * 设计原因：执行实例会释放而角色履历须长期保留；历史按真实通道分组，不合并模型上下文，不把旧无绑定日志追认为新实例。正文仍由原运行日志提供，归档只保存可核验引用和摘要。
 */
import {z} from 'zod';
import type {RunStatus} from '../brain/types';
import type {MemberEventsRead} from '../tasks/member-events';

/** 身份显式包含工作区与静态角色；agentId 可能是内置角色或已删除定义，查询不依赖当前知识有效。 */
export interface AgentHistoryIdentity {workspaceId:string;agentId:string}
/** sessionId 是历史分组键；已登记记录取真实 agentSessionId，legacy:<taskId> 仅为旧日志分组，不是运行通道。 */
export interface AgentHistorySessionIdentity extends AgentHistoryIdentity {sessionId:string}
/** taskId 与 runId 必须同时命中归属，不能只凭最后一次运行或界面所选角色推断。 */
export interface AgentHistoryRunIdentity extends AgentHistorySessionIdentity {taskId:string;runId:string}
export type AgentHistoryStatus=RunStatus|'starting';
/** 角色名称来自已记录的执行配置；不能说明历史使用了当前同名角色的配置。 */
export interface AgentHistoryRole extends AgentHistoryIdentity {name:string;sessionCount:number;runCount:number;updatedAt:string}
export interface AgentHistorySession extends AgentHistorySessionIdentity {
  kind:'conversation'|'task'|'legacy';
  title:string;agentName:string;runCount:number;status:AgentHistoryStatus;
  /** UTC ISO 时间；排序以时间和稳定身份共同决定，不以当前列表位置分页。 */
  startedAt:string;updatedAt:string;
  agentSessionId?:string;agentInstanceId?:string;rootSessionId?:string;
}
/** 执行时归属、范围和配置版本；终态仅表示运行结束，不能当作业务验收。 */
export interface AgentHistoryRun extends AgentHistoryRunIdentity {
  source:'main'|'member'|'legacy';binding:'registered'|'legacy';
  agentName:string;goal:string;moduleIds:string[];status:AgentHistoryStatus;
  startedAt:string;updatedAt:string;
  agentSessionId?:string;agentInstanceId?:string;rootSessionId?:string;configurationRevision?:string;
}
/** diagnostics 表示归档不完整或部分记录无法核实，不能用空列表掩盖读取失败。 */
export interface AgentHistoryRoles {roles:AgentHistoryRole[];diagnostics:string[]}
export interface AgentHistoryPage<T> {items:T[];nextCursor?:string;diagnostics:string[]}
/** 复用已审核公开事件协议；禁止传原始 sessionFile、workflowContext、工具正文或私有推理。 */
export type AgentHistoryEventsRead=MemberEventsRead;

const id=z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/);
const identity={workspaceId:id,agentId:z.string().min(1).max(512)};
const sessionId=z.string().min(1).max(160);
const page={cursor:z.string().min(1).max(4096).optional(),limit:z.number().int().min(1).max(100).default(30)};
export const agentHistoryRolesInput=z.object({workspaceId:id}).strict();
export const agentHistorySessionsInput=z.object({...identity,...page}).strict();
export const agentHistoryRunsInput=z.object({...identity,sessionId,...page}).strict();
export const agentHistoryEventsInput=z.object({...identity,sessionId,taskId:id,runId:id,cursor:z.object({runId:id,seq:z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)}).strict().optional(),limit:z.number().int().min(1).max(500).default(200)}).strict();
export type AgentHistorySessionsInput=z.input<typeof agentHistorySessionsInput>;
export type AgentHistoryRunsInput=z.input<typeof agentHistoryRunsInput>;
export type AgentHistoryEventsInput=z.input<typeof agentHistoryEventsInput>;
