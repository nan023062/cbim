/**
 * 作用定位：在成员交付结算与主目标审阅时重算冻结 Workflow 的程序条件。
 * 设计原因：内存工具门禁不能替代 canonical 证据；同一纯评价供两个出口共用，防止伪造交付 proof 或遗漏某模块约定。
 * 职责边界：只核调用事实、计划与真实回执，不签署业务验收，不修改日志或放宽知识基线。
 */
import {fail} from '../../core/foundation/errors';
import {sameGoalValue} from '../../core/tasks/scope-goal';
import {preparedWorkflowContracts,validatePreparedDispatchKnowledge} from '../../core/tasks/execution-context';
import {validateWorkflowEvidence} from '../../core/tasks/workflow-evidence';
import type {RunSummary} from '../../core/brain/types';
import type {TaskNode} from '../../core/tasks/graph-types';
import type {DispatchRun} from '../../core/tasks/dispatch-execution';
import {memberPublicTask} from './member-events';

/** 有约定的新运行必须有完整当前轮日志；旧无约定保持原候选规则，绝不从最新知识补造要求。 */
export function validateMemberWorkflow(task:TaskNode,run:DispatchRun,summary:RunSummary,root:string):void{
  validatePreparedDispatchKnowledge(run.prepared);const bindings=preparedWorkflowContracts(run.prepared);if(!bindings.length)return;
  const head=summary.events[0],tail=summary.events.at(-1),bounds=summary.events.filter(event=>event.type==='session.bound'),progress=summary.events.filter(event=>event.type==='task.updated').at(-1)?.data.progress;
  if(summary.logIntegrity?.partialTail!==false||summary.status!=='completed'||summary.unresolvedTools.length||summary.runId!==run.binding.runId||summary.conversationBinding||!sameGoalValue(summary.memberBinding,run.binding)||!sameGoalValue(summary.task,memberPublicTask(task,root))||!sameGoalValue(summary.taskProgress,progress)||head?.type!=='run.started'||!sameGoalValue(head.data.task,summary.task)||!sameGoalValue(head.data.memberBinding,run.binding)||!run.session.sessionFile||summary.sessionFile!==run.session.sessionFile||!bounds.length||bounds.some(event=>event.data.sessionId!==run.session.nativeSessionId||event.data.sessionFile!==run.session.sessionFile)||tail?.type!=='run.settled'||tail.data.status!=='completed')fail('WORKFLOW_EVIDENCE_INVALID','Workflow 交付缺少完整的本轮日志、原生通道和可信成员身份');
  validateWorkflowEvidence(summary.events,{workspaceId:task.identity.workspaceId,taskId:task.taskId,goal:task.goal,acceptance:task.acceptance.map(item=>item.text)},bindings);
}
