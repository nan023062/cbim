/**
 * 作用定位：在原工具位置组合其完整执行轨道与已验证派发任务的最新公开状态。
 * 设计原因：会话层负责组合，工具轨道仍独立于成员渲染，避免成员过程经 WorkStatus 反向依赖自身；任务过程按需读取，历史条目不常驻轮询。
 */
import {RunToolDetails} from './RunToolDetails';

import {useMemo} from 'react';
import type {RunSummary} from '../../bridge/contracts/execution';
import type {ExecutionRecoveryContext} from '../tasks/useExecutionRecovery';
import {MemberActivityCard} from '../tasks/MemberActivity';
import {ToolActivity} from '../run-view/ToolActivity';
import {inlineDependencies,inlineDispatchedTask} from './inline-task-state';

/** 只有原派发的真实成功回执才装配任务状态；核实入口继续使用原调用身份。 */
export function ConversationToolCall({run,toolCallId,recovery,active,onSelectTask}:{run:RunSummary;toolCallId:string;recovery:ExecutionRecoveryContext;active:boolean;onSelectTask:(id:string)=>void}){
  const graph=recovery.state.error?undefined:recovery.state.graph;
  const task=useMemo(()=>inlineDispatchedTask(run,toolCallId,graph),[run,toolCallId,graph]);
  return <div className="conversation-tool-call">
    <ToolActivity run={run} toolCallId={toolCallId} renderDetails={selection=><RunToolDetails {...selection} recovery={recovery}/>}/>
    {task&&graph&&<><MemberActivityCard workspaceId={task.identity.workspaceId} rootSessionId={task.identity.rootSessionId} task={task} onSelectTask={onSelectTask} active={active} inline/>{inlineDependencies(task,graph).map(item=><p key={item.id} className="inline-dependency">{item.text}</p>)}</>}
  </div>;
}
