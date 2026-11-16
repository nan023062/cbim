/**
 * 作用定位：在普通工具条目内组合 Agent 调用详情及旧派发记录的兼容读取。
 * 设计原因：新递归详情按可信调用引用展开，不依赖派发图；旧图关系仍需成功回执，折叠条目不挂载日志读取。
 */
import { useMemo } from 'react';

import type { RunSummary } from '../../bridge/contracts/execution';

import type { ExecutionRecoveryContext } from '../tasks/useExecutionRecovery';

import { MemberActivityCard } from '../tasks/MemberActivity';

import { ToolActivity } from '../tasks/ToolActivity';

import { AgentCallDetails } from '../execution-view/AgentCallDetails';

import { inlineDependencies, inlineDispatchedTask } from './inline-task-state';

/** 只有原派发的真实成功回执才装配任务状态；核实入口继续使用原调用身份。 */
export function ConversationToolCall({ run, toolCallId, recovery, active, onSelectTask }: { run: RunSummary; toolCallId: string; recovery: ExecutionRecoveryContext; active: boolean; onSelectTask: (id: string) => void })
{
  const graph = recovery.state.error ? undefined : recovery.state.graph;

  const task = useMemo(() => inlineDispatchedTask(run, toolCallId, graph), [run, toolCallId, graph]);

  return <div className="conversation-tool-call">
    <ToolActivity run={run} toolCallId={toolCallId} recovery={recovery} renderDetails={id => <><AgentCallDetails parentRun={run} toolCallId={id} active={active} />{task && graph && <><MemberActivityCard workspaceId={task.identity.workspaceId} rootSessionId={task.identity.rootSessionId} task={task} onSelectTask={onSelectTask} active={active} inline />{inlineDependencies(task, graph).map(item => <p key={item.id} className="inline-dependency">{item.text}</p>)}</>}</>} />
  </div>;
}
