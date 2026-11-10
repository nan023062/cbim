/**
 * 作用定位：在共享工具轨道上组合原命令核实与影响处置入口，供主对话及任务页使用。
 * 设计原因：核实控制器属于任务领域；共享轨道只显示公开事件，成员履历无需加载恢复状态。
 * 职责边界：保持原 run/call 身份和显式点击语义，渲染不授权执行、不重试工具。
 */
import type {RunSummary} from '../../bridge/contracts/execution';
import {isVerifiableMainToolName} from '../../bridge/contracts/command-verification';
import {ToolTimeline} from '../execution-view/ToolTimeline';
import {mainCommandSelection} from './command-verification-state';
import {MainCommandVerification} from './CommandVerificationPanel';
import type {ExecutionRecoveryContext} from './useExecutionRecovery';
import {EffectObservationPanel} from './EffectObservationPanel';
import {effectObservationAnchor} from './effect-recovery-state';

/** 主来源的完整身份由原日志核验；成员及缺失绑定的旧日志只显示轨道。 */
export function ToolActivity({run,recovery,toolCallId}:{run:RunSummary;recovery?:ExecutionRecoveryContext;toolCallId?:string}){
 return <ToolTimeline run={run} toolCallId={toolCallId} renderControls={({id,name})=>{
  const mainSelection=mainCommandSelection(run,id,name),selection=isVerifiableMainToolName(name)?mainSelection:undefined;
  return <>{selection&&<MainCommandVerification selection={selection} latestSeq={run.events.at(-1)?.seq??0}/>}
   {mainSelection&&<EffectObservationPanel identity={{workspaceId:mainSelection.workspaceId,rootSessionId:mainSelection.rootSessionId,subject:{kind:'main_run',runId:run.runId,toolCallIds:[id]}}} anchor={effectObservationAnchor(recovery?.state)} context={recovery}/>}</>;
 }}/>
}
