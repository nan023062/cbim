/**
 * 作用定位：在共享工具轨道外组合主调用核证、影响观察及可选的恢复控制。
 * 设计原因：展示组件不认识任务 hook；本装配层核原主身份并传递真实恢复上下文，成员和历史视图可复用只读核实部分。
 * 职责边界：无可信主来源时不提供面板；挂载不执行旧工具，刷新、选择和新核实仍由各业务控制器负责。
 */
import type {ToolDetailsSelection} from '../run-view/contracts';
import {isVerifiableMainToolName} from '../../bridge/contracts/command-verification';
import {mainCommandSelection} from './command-verification-state';
import {MainCommandVerification} from './CommandVerificationPanel';
import type {ExecutionRecoveryContext} from '../tasks/useExecutionRecovery';
import {EffectObservationPanel} from '../tasks/EffectObservationPanel';
import {effectObservationAnchor} from '../tasks/effect-recovery-state';

/** 只为真实主调用生成独立核实入口；可选上下文决定恢复能力，展示不自动发起核实。 */
export function RunToolDetails({run,toolCallId,toolName,recovery}:ToolDetailsSelection&{recovery?:ExecutionRecoveryContext}){
  const main=mainCommandSelection(run,toolCallId,toolName);
  if(!main)return null;
  return <>
    {isVerifiableMainToolName(toolName)&&<MainCommandVerification selection={main} latestSeq={run.events.at(-1)?.seq??0}/>}
    <EffectObservationPanel identity={{workspaceId:main.workspaceId,rootSessionId:main.rootSessionId,subject:{kind:'main_run',runId:run.runId,toolCallIds:[toolCallId]}}} anchor={effectObservationAnchor(recovery?.state)} context={recovery}/>
  </>;
}
