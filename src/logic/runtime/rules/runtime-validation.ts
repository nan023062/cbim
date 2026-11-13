/**
 * 作用定位：校验全局运行总览的跨进程只读快照，供 Bridge 和界面共享真实字段边界。
 * 设计原因：界面不能从不完整身份跳转到其它任务，未知字段不能把日志正文、凭据或执行能力混入监管数据。
 * 职责边界：仅核对传输形状、身份和公开状态一致性，不重算业务验收、费用完整性或执行资格；无默认补值和变换。
 */
import {z} from 'zod';
import type {RuntimeRead,RuntimeScope,RuntimeSnapshot} from './types';

const id=z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/);
const logicalId=z.string().min(1).max(512);
const count=z.number().int().nonnegative().safe();
const positive=count.min(1);
const amount=z.number().finite().nonnegative();
const availability=z.enum(['loading','ready','closed','unavailable']);
const runStatus=z.enum(['running','completed','cancelled','failed','interrupted']);
const taskStatus=z.enum(['planned','queued','running','waiting','result_ready','blocked','failed','cancelled','interrupted','checkpointed']);
const activity=z.enum(['idle','working','waiting','communicating']);
const unique=(values:readonly string[])=>new Set(values).size===values.length;
const ids=z.array(id).refine(unique,'身份集合不能重复');
const moduleIds=z.array(logicalId).refine(unique,'模块集合不能重复');
const reason=z.string().max(240);
const queue=z.object({pending:count,paused:count,inserting:count}).strict();
const workspace=z.object({workspaceId:id,name:z.string(),epoch:positive,availability,issues:z.array(z.object({source:z.string(),message:z.string()}).strict()),queue}).strict();
const member=z.object({workspaceId:id,teamId:logicalId,agentId:logicalId,agentInstanceId:id,leaseEpoch:count,mainRootSessionId:id.optional(),executionScopeId:id.optional(),executionTaskId:id.optional(),lifecycle:z.enum(['active','released']).optional(),releasedAt:z.string().optional(),activity,activityCurrent:z.boolean(),availability,sessionCount:count,activeTaskId:id.optional(),activeRunId:id.optional(),activeConversation:z.object({rootSessionId:id,agentSessionId:id,runId:id}).strict().optional(),waitingTaskIds:ids,communicatingMessageIds:ids}).strict();
const dispatchTask=z.object({source:z.literal('dispatch'),binding:z.literal('instance'),workspaceId:id,rootSessionId:id,taskId:id,scopeId:id.optional(),agentId:logicalId,agentInstanceId:id,moduleIds,status:taskStatus,revision:positive,planRevision:positive,runIds:ids,updatedAt:z.string()}).strict();
const loopFields={source:z.literal('loop'),workspaceId:id,taskId:id,agentId:logicalId.optional(),moduleIds,status:runStatus,runIds:ids,activeRunIds:ids,lastRunId:id,updatedAt:z.string()};
const loopTask=z.union([z.object({...loopFields,binding:z.literal('role-only')}).strict(),z.object({...loopFields,binding:z.literal('instance'),agentInstanceId:id,agentSessionId:id,rootSessionId:id}).strict()]).superRefine((value,context)=>{
  if(!value.runIds.includes(value.lastRunId)||value.activeRunIds.some(run=>!value.runIds.includes(run)))context.addIssue({code:'custom',message:'主会话轮次引用不属于自身运行集合'});
  if(value.binding==='instance'&&value.taskId!==value.rootSessionId)context.addIssue({code:'custom',message:'主会话绑定与任务身份不一致'});
});
const bindingFields={workspaceId:id,teamId:logicalId,agentId:logicalId,agentInstanceId:id,agentSessionId:id,rootSessionId:id};
const memberBinding=z.object({...bindingFields,taskId:id,runId:id,leaseEpoch:count,planRevision:positive}).strict();
const conversationBinding=z.object({...bindingFields,agentId:z.literal('cbim:main')}).strict();
// 旧日志可能缺失/无法解析时间，保持原字符串；不能为了展示补造开始时间。
const usage=z.object({input:amount,output:amount,cacheRead:amount,cacheWrite:amount,reasoning:amount,total:amount,cost:amount.optional(),costPartial:z.boolean(),usageReported:z.boolean()}).strict();
const run=z.object({workspaceId:id,taskId:id,runId:id,agentId:logicalId.optional(),status:runStatus,memberBinding:memberBinding.optional(),conversationBinding:conversationBinding.optional(),phase:z.enum(['working','tool','waiting','stopping','settled']),lastSeq:count,startedAt:z.string().optional(),updatedAt:z.string(),usage}).strict().superRefine((value,context)=>{
  const member=value.memberBinding,conversation=value.conversationBinding;
  if(member&&conversation)context.addIssue({code:'custom',message:'一个运行不能同时属于成员和主会话'});
  if(member&&(member.workspaceId!==value.workspaceId||member.taskId!==value.taskId||member.runId!==value.runId||member.agentId!==value.agentId))context.addIssue({code:'custom',message:'成员运行绑定与公开运行身份矛盾'});
  if(conversation&&(conversation.workspaceId!==value.workspaceId||conversation.rootSessionId!==value.taskId||conversation.agentId!==value.agentId))context.addIssue({code:'custom',message:'主会话运行绑定与公开运行身份矛盾'});
});
const pressure=z.object({taskInstances:count,memberInstances:count,openWorkspaces:count,unavailableWorkspaces:count,activeMembers:count,workingMembers:count,waitingMembers:count,communicatingMembers:count,activeRuns:count,queuedDispatchTasks:count,waitingDispatchTasks:count,blockedDispatchTasks:count,pendingOutbox:count,queuedConversationMessages:count,pausedConversationMessages:count,insertingConversationMessages:count}).strict();
const totalUsage=usage.extend({runCount:count,reportedRuns:count,unreportedRuns:count,unpricedRuns:count}).strict().refine(value=>value.reportedRuns+value.unreportedRuns===value.runCount&&value.unpricedRuns<=value.reportedRuns,'已报告/未报告运行计数矛盾');

/** 监管流只用于读取，无变化响应不能据此恢复执行或签发权限。 */
export const runtimeCursorSchema=z.object({streamId:id,revision:count}).strict();
/** 真实周期事实的有界白名单；已关闭周期可以保留此前的等待原因作为历史。 */
export const runtimeScopeSchema:z.ZodType<RuntimeScope>=z.object({workspaceId:id,rootSessionId:id,scopeId:id,status:z.enum(['active','waiting','closed']),createdAt:z.string().datetime(),closedAt:z.string().datetime().optional(),outcome:z.enum(['completed','failed','cancelled','interrupted']).optional(),hasGoal:z.boolean(),goalRevision:positive.optional(),reviewDecision:z.enum(['complete','replan','blocked','awaiting_user']).optional(),goalBlocked:z.object({reason}).strict().optional(),wait:z.object({createdAt:z.string().datetime(),reason}).strict().optional(),budgetBlocked:z.object({reason:z.enum(['token_limit','cost_limit','usage_unverifiable'])}).strict().optional()}).strict().superRefine((value,context)=>{
  const issue=(message:string)=>context.addIssue({code:'custom',message});
  if(value.hasGoal!==(value.goalRevision!==undefined)||!value.hasGoal&&(value.reviewDecision!==undefined||value.goalBlocked!==undefined))issue('目标是否存在与目标字段矛盾');
  if(value.status==='waiting'&&(!value.hasGoal||!value.wait||value.reviewDecision!=='awaiting_user'))issue('等待状态缺少真实等待及审阅事实');
  if(value.status==='active'&&value.wait)issue('活动周期不能仍持有已消费的等待检查点');
  if(value.status==='closed'?(!value.closedAt||!value.outcome):(value.closedAt!==undefined||value.outcome!==undefined))issue('周期结算与关闭字段矛盾');
});

/** 校验整份原子监管快照；成员/轮次可以暂缺关联记录，但不能归属不存在或重复的工作区。 */
export const runtimeSnapshotSchema:z.ZodType<RuntimeSnapshot>=z.object({cursor:runtimeCursorSchema,workspaces:z.array(workspace),members:z.array(member),tasks:z.array(z.union([dispatchTask,loopTask])),runs:z.array(run),scopes:z.array(runtimeScopeSchema),pressure,usage:totalUsage,complete:z.boolean()}).strict().superRefine((value,context)=>{
  const issue=(message:string)=>context.addIssue({code:'custom',message}),workspaces=new Set(value.workspaces.map(item=>item.workspaceId));
  if(workspaces.size!==value.workspaces.length)issue('工作区身份重复');
  const groups=[value.members,value.tasks,value.runs,value.scopes];
  if(groups.some(items=>items.some(item=>!workspaces.has(item.workspaceId))))issue('监管记录属于快照外的工作区');
  const memberKeys=value.members.map(item=>JSON.stringify([item.workspaceId,item.agentInstanceId])),taskKeys=value.tasks.map(item=>JSON.stringify([item.workspaceId,item.source,item.source==='dispatch'?item.rootSessionId:null,item.taskId])),runKeys=value.runs.map(item=>JSON.stringify([item.workspaceId,item.taskId,item.runId])),scopeKeys=value.scopes.map(item=>JSON.stringify([item.workspaceId,item.scopeId]));
  if(!unique(memberKeys)||!unique(taskKeys)||!unique(runKeys)||!unique(scopeKeys))issue('成员、任务、运行或周期身份重复');
  const open=value.scopes.filter(item=>item.status!=='closed').map(item=>JSON.stringify([item.workspaceId,item.rootSessionId]));
  if(!unique(open))issue('同一主会话存在多个未关闭周期');
  const scopes=new Map(value.scopes.map(item=>[JSON.stringify([item.workspaceId,item.scopeId]),item]));
  for(const task of value.tasks)if(task.source==='dispatch'&&task.scopeId){const scope=scopes.get(JSON.stringify([task.workspaceId,task.scopeId]));if(!scope||scope.rootSessionId!==task.rootSessionId)issue('任务周期归属缺失或跨主会话')}
  if(value.complete&&value.workspaces.some(item=>(item.availability!=='ready'&&item.availability!=='closed')||item.issues.length>0))issue('不完整来源不能标为完整监管快照');
});

/** 外层游标必须与快照相同，禁止半包数据被前端当作较新的完整版本。 */
export const runtimeReadSchema:z.ZodType<RuntimeRead>=z.discriminatedUnion('mode',[z.object({mode:z.literal('noop'),cursor:runtimeCursorSchema}).strict(),z.object({mode:z.literal('snapshot'),cursor:runtimeCursorSchema,snapshot:runtimeSnapshotSchema}).strict()]).superRefine((value,context)=>{
  if(value.mode==='snapshot'&&(value.cursor.streamId!==value.snapshot.cursor.streamId||value.cursor.revision!==value.snapshot.cursor.revision))context.addIssue({code:'custom',message:'读取游标与监管快照不一致'});
});
