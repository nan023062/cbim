/**
 * 作用定位：把工作区治理服务绑定到一个真实主运行，提供模型专用的四个窄端口。
 * 设计原因：身份、原命令 ID 和来源来自后端实例及工具调用闭包；持久观察与提案不经过桌面批准入口，也不进入共享知识工具缓存。
 * 职责边界：只读查询或追加私有待办，不批准、不实施、不换实例重放；失败只返回可查询的原命令身份，不泄露底层正文。
 */
import type {TaskSpec} from '../../core/tasks/types';
import {checkedConversationAgentBinding,type ConversationAgentBinding} from '../../core/brain/conversation-binding';
import {safeId} from '../../core/foundation/identity';
import {fail,Fault} from '../../core/foundation/errors';
import {moduleGovernanceMainOriginSchema} from '../../core/governance/module-governance';
import {moduleGovernanceMainCommandId} from '../../core/governance/module-governance-rules';
import {
  governanceGetInputSchema,governanceObserveInputSchema,governanceProposeInputSchema,governanceReceiptInputSchema,
  projectGovernanceGet,projectGovernanceReceipt,type GovernanceToolsPort,
} from '../../core/governance/module-governance-tools';
import type {Workspace} from '../workspace/workspace';

/** 仅实际主运行的 createEngine 工厂调用；参数不来自模型或页面选中记录。 */
export function mainGovernanceTools(workspace:Workspace,task:TaskSpec,runId:string,binding:ConversationAgentBinding):GovernanceToolsPort{
  const main=checkedConversationAgentBinding(binding,task),run=safeId(runId),identity={workspaceId:workspace.entry.id,instanceId:workspace.instanceId},publicIdentity={workspaceId:identity.workspaceId,rootSessionId:main.rootSessionId};
  if(main.workspaceId!==identity.workspaceId||task.root!==workspace.entry.path)fail('GOVERNANCE_IDENTITY','治理工具与实际主运行工作区不一致');
  const current=(signal:AbortSignal)=>{signal.throwIfAborted();workspace.assert(identity)};
  const source=(action:'observe'|'propose',toolCallId:string,sourceRun=run)=>moduleGovernanceMainOriginSchema.parse({kind:'main_agent',rootSessionId:main.rootSessionId,agentInstanceId:main.agentInstanceId,agentSessionId:main.agentSessionId,runId:sourceRun,toolCallId,toolName:`cbim_governance_${action}`});
  const write=async(action:'observe'|'propose',raw:unknown,toolCallId:string,signal:AbortSignal)=>{
    const origin=source(action,toolCallId),commandId=moduleGovernanceMainCommandId(identity.workspaceId,origin);
    try{
      current(signal);
      // 在任何展开或合并前严格检查原始模型输入，防止 strip 后伪造 actor/命令身份被忽略。
      const result=action==='observe'
        ?await workspace.governance.observeFromMain({...governanceObserveInputSchema.parse(raw),...identity,commandId},origin,signal)
        :await workspace.governance.proposeFromMain({...governanceProposeInputSchema.parse(raw),...identity,commandId},origin,signal);
      current(signal);
      if('status' in result)return result;
      const receipt=projectGovernanceReceipt(result,publicIdentity,commandId);
      if(receipt.status!=='recorded')fail('GOVERNANCE_UNKNOWN','治理写入未得到可核实回执');return receipt;
    }catch(error){
      const code=error instanceof Fault?error.code:signal.aborted?'GOVERNANCE_CANCELLED':'GOVERNANCE_UNKNOWN';
      fail(code,`治理${action==='observe'?'观察':'提案'}未交付可核实结果；原 commandId=${commandId}。操作可能已保存，只查询原回执，不自动重试或新建命令。`);
    }
  };
  return {
    get:async(raw,signal)=>{current(signal);const input=governanceGetInputSchema.parse(raw),{view}=await workspace.governance.readForMain({...input,...identity},signal);current(signal);return projectGovernanceGet(view,publicIdentity)},
    observe:(input,toolCallId,signal)=>write('observe',input,toolCallId,signal),
    propose:(input,toolCallId,signal)=>write('propose',input,toolCallId,signal),
    receipt:async(raw,signal)=>{
      current(signal);const input=governanceReceiptInputSchema.parse(raw),commandId='commandId' in input?input.commandId:moduleGovernanceMainCommandId(identity.workspaceId,source(input.action,input.toolCallId,input.runId??run));
      const value=await workspace.governance.lookup({workspaceId:identity.workspaceId,commandId});current(signal);
      return projectGovernanceReceipt(value,publicIdentity,commandId);
    },
  };
}
