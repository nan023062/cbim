/**
 * 作用定位：定义一次用户任务的调度周期，与长期主会话和单次模型运行区分。
 * 设计原因：一次目标可以经历多轮调度、执行和结果回注；冻结本轮真实输入，避免续聊借用旧 TaskSpec.goal。周期结束仍保留输入、图和证据，不在每次 LLM 回合结束时销毁成员。
 */
import {z} from 'zod';

/** 来自可信用户启动入口的本轮正文与附件快照身份；省略附件规范化为空数组，不裁剪正文。 */
export interface DispatchScopeInput {message:string;attachmentIds?:string[]}
/** 当前版本固定为 1；这是实际输入快照，不是模型计划、完成条件或业务验收结论。 */
export interface DispatchScopeGoal {revision:1;input:{message:string;attachmentIds:string[]}}
const message=z.string().max(1_000_000).refine(value=>value.trim().length>0,'周期输入正文不能为空');
const attachments=z.array(z.string().uuid()).max(12);
/** 启动参数仅接受正文和附件身份，不接受模型注入目标版本、计划或周期状态。 */
export const dispatchScopeInputSchema=z.object({message,attachmentIds:attachments.optional()}).strict();
/** 持久化快照的附件字段不可省略；旧兼容只允许整个 goal 缺省，不默默修补部分损坏内容。 */
export const dispatchScopeGoalSchema=z.object({revision:z.literal(1),input:z.object({message,attachmentIds:attachments}).strict()}).strict();

export type DispatchScopeOutcome='completed'|'failed'|'cancelled'|'interrupted';
/** scopeId 由可信主调度入口创建，不从模型参数读取；closed 是生命周期结束，不代表业务已验收。 */
export interface DispatchScope {
  scopeId:string;
  workspaceId:string;
  rootSessionId:string;
  status:'active'|'closed';
  createdAt:string;
  /** 新周期保存真实输入，创建后不可改绑/移除；缺省仅表示旧记录，不从首轮任务或历史正文猜测补造。 */
  goal?:DispatchScopeGoal;
  closedAt?:string;
  outcome?:DispatchScopeOutcome;
}
