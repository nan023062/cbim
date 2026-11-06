/**
 * 作用定位：成员运行的公开事件分页协议，供主对话和任务节点详情复用现有消息渲染。
 * 设计原因：图状态与执行日志分别保留权威序号；只公开目标、执行状态和受限工具摘要，不暴露冻结知识、原生会话或凭据。
 */
import {z} from 'zod';
import type {RunStatus,StoredEvent} from '../brain/types';
import type {TaskSpec} from './types';
import type {TaskProgress} from './progress';
import {memberTaskInput} from './member-commands';

/** 序号是单个 run 已读到的连续日志前缀；0 表示尚未读事件，与任务图批次 seq 无关。 */
export interface MemberEventCursor {runId:string;seq:number}
const runId=z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/);
/** 按事件条数分页，默认 200、最大 500；调用入口须同时核对 cursor.runId 与请求运行一致。 */
export const memberEventsInput=memberTaskInput.extend({runId,cursor:z.object({runId,seq:z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)}).strict().optional(),limit:z.number().int().min(1).max(500).default(200)}).strict();
/** 外部输入允许省略 limit；schema 解析后才补分页默认值。 */
export type MemberEventsInput=z.input<typeof memberEventsInput>;
/** task 含业务身份、工作区根路径、目标、模块和验收；不携带 workflowContext、sessionFile 或成员配置正文。 */
export interface MemberRunView {
  task:TaskSpec;
  runId:string;
  /** 以派发运行事务为准；starting 公开为 running，候选 result_ready 对应 completed。 */
  status:RunStatus;
  acceptance:'not_evaluated';
  unresolvedTools:string[];
  taskProgress?:TaskProgress;
}
/**
 * reset 从空前缀重建，delta 续读，事件的受限字段经投影替换而不跳号；hasMore 时继续分页。
 * noop 仍包含运行快照：最后一个日志事件之后，调度终态事务可能才完成。
 */
export type MemberEventsRead=
  |{mode:'reset';run:MemberRunView;cursor:MemberEventCursor;events:StoredEvent[];hasMore:boolean}
  |{mode:'delta';run:MemberRunView;cursor:MemberEventCursor;events:StoredEvent[];hasMore:boolean}
  |{mode:'noop';run:MemberRunView;cursor:MemberEventCursor};
