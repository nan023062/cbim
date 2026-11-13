/**
 * 作用定位：可信桌面入口启动、观察和停止成员任务，以及读取和确认结果信封的序列化契约。
 * 设计原因：请求只选择已有任务/通道与公开运行选项；后端核实成员归属、知识、租约和原生会话，命令回执不等于执行完成。
 */
import {z} from 'zod';
import {graphIdentityInput} from './dispatch-commands';
import type {GraphCursor,TaskNode} from './graph-types';
import type {DispatchRunStatus} from './dispatch-execution';
import type {MemberRunBinding} from '../../execution/rules/member-run';

const id=z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/);
/** 以工作区、主会话和业务 taskId 精确定位；后端仍须核对已派发任务，不能只凭格式授权。 */
export const memberTaskInput=graphIdentityInput.extend({taskId:id}).strict();
/** commandId 提供幂等身份；expectedRevision 是 TaskNode.revision，运行权限缺省 read，超时单位毫秒。 */
export const memberStartInput=memberTaskInput.extend({commandId:id,expectedRevision:z.number().int().positive(),options:z.object({
  profileId:id.optional(),model:z.string().trim().min(1).max(256).optional(),
  permission:z.enum(['read','ask','execute']).default('read'),
  turnTimeoutMs:z.number().int().min(1000).max(3600000).optional(),
}).strict().default({permission:'read'})}).strict();
/** 定位当前图内的成员逻辑通道；不是原生会话 ID，也不允许读取其他主会话的邮箱。 */
export const memberMessageInput=graphIdentityInput.extend({agentSessionId:id}).strict();
/** 确认已接收的 result 信封；只推进投递状态，不启动成员或把候选标为验收通过。 */
export const memberAcknowledgeInput=memberMessageInput.extend({commandId:id,messageId:id}).strict();
/** 可信界面可选的运行参数；模型凭据和成员身份不能通过 options 注入。 */
export type MemberStartOptions=z.infer<typeof memberStartInput>['options'];
/** starting 只表示启动意图已可靠落盘；运行状态须通过 inspect 或图增量观察。 */
export interface MemberStartReceipt {taskId:string;runId:string;cursor:GraphCursor}
/** 无提示词、凭据、工具正文或磁盘会话路径的观察视图。 */
export interface MemberExecutionView {
  task:TaskNode;
  runs:Array<{binding:MemberRunBinding;status:DispatchRunStatus;permission:MemberStartOptions['permission'];model:string;createdAt:string;startedAt?:string;settledAt?:string;error?:string}>;
}
