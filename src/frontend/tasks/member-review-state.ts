/**
 * 作用定位：展示成员候选从交付、主调度审阅到最终验收的阶段说明。
 * 设计原因：result_ready 只说明候选存在；明确等待对象与依赖关口，不凭标签猜测主模型正在运行。
 */
import type {TaskNode} from '../../bridge/contracts/dispatch';
export function memberReviewStage(task:TaskNode,tasks:TaskNode[]=[]){
  if(task.status!=='result_ready'||!task.result)return;
  const review=task.candidateReview;
  if(review&&review.resultId===task.result.resultId&&review.runId===task.result.runId&&review.planRevision===task.planRevision){
    if(review.decision==='reject')return {label:'主 Agent 审阅未通过',description:'后继任务保持阻塞；主 Agent 需安排返工并明确替换依赖。审阅理由：'+review.reason};
    return {label:'主 Agent 已审阅通过',description:'此候选已允许后继任务使用；不代表目标完成或用户验收。主 Agent 最后仍需集成审阅，涉及人工验收时等待用户确认。审阅理由：'+review.reason};
  }
  const active=tasks.filter(t=>t.scopeId===task.scopeId&&t.identity.rootSessionId===task.identity.rootSessionId&&t.identity.workspaceId===task.identity.workspaceId&&t.activeRunId);
  return {label:'交付待主 Agent 审阅',description:(active.length?'等待当前成员运行结束，随后回到主 Agent 审阅。':'等待主 Agent 接收并审阅此候选。')+'阶段：成员交付 → 主 Agent 核对证据并接受/拒绝 → 通过后放行需审阅的后继 → 整体集成审阅 → 按目标要求由用户验收。旧依赖保留原规则，不补造审阅记录。'};
}
