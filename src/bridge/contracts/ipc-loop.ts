/**
 * 作用定位：会话、排队、历史与安全续接的公开 IPC 请求与响应。
 * 设计原因：插入绑定原 expectedRunId，查询原回执不重放；退役的业务启动入口继续拒绝。类型不替代身份和权限校验。
 */
import {z} from 'zod';
import {ipcId,workspaceIdArgs,taskIdArgs,runIdArgs,questionAnswers} from './ipc-shapes';
import {type ConversationThreadView,type RunSummary} from '../../logic/execution/rules/types';
import {type ChatApproval} from '../../logic/tools/rules/policy/types';
import {type HumanContinuationReceipt,humanContinuationLookupSchema,humanContinuationRequestSchema} from '../../logic/tasks/rules/human-continue';
import {type QueueDelta,type QueuedMessage} from '../../logic/tasks/rules/queue';
import {type GoalContinuationReceipt,goalContinuationRequestSchema,scopeContinuationLookupSchema} from '../../logic/tasks/rules/scope-continuation';
import {type RecoveryReceipt,recoveryLookupSchema,recoveryRequestSchema} from '../../logic/tasks/rules/scope-recovery';
import {type ReplanReceipt,replanLookupSchema,replanRequestSchema} from '../../logic/tasks/rules/scope-replan';
import {type TaskSpec} from '../../logic/tasks/rules/types';
import {type PendingQuestion} from '../../logic/tools/rules/questions';

export const loopIpcRequests={
  'loop.prepare':workspaceIdArgs.extend({task:z.object({goal:z.string(),moduleId:ipcId,agentId:ipcId,workflowId:ipcId,responsiblePerson:z.string().optional(),acceptance:z.array(z.string())}).strict()}).strict(),
  'loop.choices':workspaceIdArgs,
  'loop.thread':taskIdArgs,
  'loop.threadView':taskIdArgs,
  'loop.start':z.never(),
  'loop.queue':taskIdArgs,
  'loop.queueDelta':taskIdArgs.extend({cursor:z.object({epoch:ipcId,revision:z.number().int().nonnegative(),items:z.record(z.number())}).strict().optional()}).strict(),
  'loop.enqueue':taskIdArgs.extend({message:z.string(),attachments:z.array(z.string()).optional(),options:z.object({engine:z.enum(['pi','claude-code','codex']).optional(),provider:z.string().optional(),model:z.string().optional(),profileId:z.string().optional(),permission:z.enum(['read','ask','execute']).optional(),collaborationMode:z.enum(['auto','team']).optional(),allowNativeExecution:z.boolean().optional(),turnTimeoutMs:z.number().optional()}).strict().optional()}).strict(),
  'loop.chat':workspaceIdArgs.extend({message:z.string(),attachments:z.array(z.string()).optional(),options:z.object({engine:z.enum(['pi','claude-code','codex']).optional(),provider:z.string().optional(),model:z.string().optional(),profileId:z.string().optional(),permission:z.enum(['read','ask','execute']).optional(),collaborationMode:z.enum(['auto','team']).optional(),allowNativeExecution:z.boolean().optional(),turnTimeoutMs:z.number().optional()}).strict().optional()}).strict(),
  'loop.resume':runIdArgs.extend({message:z.string(),attachments:z.array(z.string()).optional(),options:z.object({engine:z.enum(['pi','claude-code','codex']).optional(),provider:z.string().optional(),model:z.string().optional(),profileId:z.string().optional(),permission:z.enum(['read','ask','execute']).optional(),collaborationMode:z.enum(['auto','team']).optional(),allowNativeExecution:z.boolean().optional(),turnTimeoutMs:z.number().optional()}).strict().optional(),reconciledToolIds:z.array(z.string()).optional()}).strict(),
  'loop.queueChange':taskIdArgs.extend({queueId:ipcId,action:z.enum(['first','up','down','remove'])}).strict(),
  'loop.queueEdit':taskIdArgs.extend({queueId:ipcId,message:z.string(),expected:z.string()}).strict(),
  'loop.queueMove':taskIdArgs.extend({queueId:ipcId,beforeId:ipcId.optional()}).strict(),
  'loop.queueInsert':taskIdArgs.extend({queueId:ipcId,expectedRunId:ipcId}).strict(),
  'loop.queueContinue':taskIdArgs,
  'loop.goalContinue':goalContinuationRequestSchema,
  'loop.goalContinuation':scopeContinuationLookupSchema,
  'loop.humanContinue':humanContinuationRequestSchema,
  'loop.humanContinuation':humanContinuationLookupSchema,
  'loop.recoveryStart':recoveryRequestSchema,
  'loop.recoveryReceipt':recoveryLookupSchema,
  'loop.replanStart':replanRequestSchema,
  'loop.replanReceipt':replanLookupSchema,
  'loop.questions':taskIdArgs,
  'loop.approvals':taskIdArgs,
  'loop.answerQuestion':taskIdArgs.extend({questionId:ipcId,answers:questionAnswers}).strict(),
  'loop.approve':taskIdArgs.extend({approvalId:ipcId,allow:z.boolean(),allowAll:z.boolean().optional()}).strict(),
  'loop.stop':taskIdArgs,
  'loop.inspect':runIdArgs,
  'loop.list':workspaceIdArgs,
};
export interface LoopIpcResponses {
  'loop.prepare':TaskSpec;
  'loop.choices':z.infer<typeof loopChoicesSchema>;
  'loop.thread':RunSummary[];
  'loop.threadView':ConversationThreadView;
  'loop.start':never;
  'loop.queue':QueuedMessage[];
  'loop.queueDelta':QueueDelta;
  'loop.enqueue':QueuedMessage;
  'loop.chat':{workspaceId:string;taskId:string;runId:string};
  'loop.resume':{workspaceId:string;taskId:string;runId:string;queued?:true;queueId?:string};
  'loop.queueChange':void;
  'loop.queueEdit':void;
  'loop.queueMove':void;
  'loop.queueInsert':void;
  'loop.queueContinue':void;
  'loop.goalContinue':GoalContinuationReceipt;
  'loop.goalContinuation':GoalContinuationReceipt|undefined;
  'loop.humanContinue':HumanContinuationReceipt;
  'loop.humanContinuation':HumanContinuationReceipt|undefined;
  'loop.recoveryStart':RecoveryReceipt;
  'loop.recoveryReceipt':RecoveryReceipt|undefined;
  'loop.replanStart':ReplanReceipt;
  'loop.replanReceipt':ReplanReceipt|undefined;
  'loop.questions':PendingQuestion[];
  'loop.approvals':ChatApproval[];
  'loop.answerQuestion':void;
  'loop.approve':void;
  'loop.stop':void;
  'loop.inspect':RunSummary;
  'loop.list':(Omit<RunSummary,'events'>&{eventCount:number}|{taskId:string;runId:string;status:'unreadable';error:string;task?:never})[];
}

/** 选择器源自知识 JSON，只公开当前可展示的标识、名称和流程列表。 */
export const loopChoicesSchema=z.object({modules:z.array(z.object({id:z.string(),name:z.string(),workflows:z.array(z.object({id:z.string(),name:z.string()}))})),agents:z.array(z.object({id:z.string(),name:z.string()})),people:z.array(z.never()),structural:z.boolean().optional()});
