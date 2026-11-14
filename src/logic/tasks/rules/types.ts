/**
 * 自动执行 TaskSpec 保留独立兜底身份，随真实运行日志冻结，不把 cbim:executor 推断成登记岗位。
 * 作用定位：业务目标和冻结上下文的任务定义。
 * 设计原因：任务身份独立于某次模型执行；正式成员保存原负责人绑定供日志核验，旧缺省不推断岗位，不把定义当自动验收。
 */
import {type AutomaticExecutionBinding} from '../../team/rules/automatic-execution';
import type {OwnerExecutionBinding} from '../../team/rules/member-execution-binding';
/** 不随运行重试改变的任务定义；恢复必须与最初持久化的定义一致。 */
export interface TaskSpec {
  /** chat 使用内置主 Agent；缺省为既有团队任务，不能绕过团队快照校验。 */
  mode?: 'chat';
  /** 业务任务身份；一个任务可以有多个 runId。 */
  taskId: string;
  /** 规范化工程路径对应的工作区身份，不是界面当前选中项。 */
  workspaceId: string;
  root: string;
  goal: string;
  moduleIds: string[];
  agentId?: string;
  /** 正式派发的真实岗位快照，主对话和旧日志缺省；不能从 agentId 推断。 */
  ownerBinding?:OwnerExecutionBinding;
  /** 自动模式独立兜底身份，不是登记岗位或人工确认。 */
  fallbackBinding?:AutomaticExecutionBinding;
  responsiblePerson?: string;
  /** 人声明的验收要求；当前运行时只记录，不自动判断是否通过。 */
  acceptance: string[];
  /** 启动时冻结的业务知识正文与版本；恢复沿用此快照，不静默替换流程。 */
  workflowContext?: {revision:string;workflowId:string;module:unknown;agent:unknown;workflow:unknown;standards:unknown[]};
}
