/**
 * request 是新增可信冻结事实；旧登记缺省保持兼容，但不能据此推断正式修复的原要求。
 * 作用定位：递归业务运行的持久身份与冻结知识，供文件审计和隔离恢复定位原 canonical。
 * 设计原因：新调用没有旧任务图/信封；只登记真实运行，不伪造旧成员领取或另一份执行状态机。
 */
import type { MemberRunBinding } from './member-run';

import type { PreparedDispatchKnowledge } from '../../tasks/rules/execution-context';

import type { AgentCallReference } from '../../agents/contracts';

/** 文件机制只消费冻结身份；不依赖旧派工信封、模型或任务图。 */
export interface BusinessRunSource
{
  binding: MemberRunBinding;

  prepared: PreparedDispatchKnowledge;

  permission: 'read' | 'ask' | 'execute';

  protocol?: 'agent-tools-v1'
}
export interface AgentBusinessRun
{
  protocol: 'agent-tools-v1';

  binding: MemberRunBinding;

  scopeId: string;

  parent: AgentCallReference;

  /** 从本调用向根排列的可信 canonical 引用链；不依赖普通执行 Agent 另有业务登记。 */
  lineage: AgentCallReference[];

  prepared: PreparedDispatchKnowledge;

  permission: 'read' | 'ask' | 'execute';

  /** 新调用冻结原目标与验收要求；旧登记缺省时不能据损坏日志推断要求。 */
  request?:
  {
    message: string;

    acceptance: string[]
  };
  /** active 只表示启动意图已保存；真实授权和执行事实必须再核 canonical。 */
  status: 'active' | 'closed';

  createdAt: string;

  /** 仅实际 Runtime.close 成功后保存；重启不猜测进程退出，也不自动补此值。 */
  closedAt?: string;
}
