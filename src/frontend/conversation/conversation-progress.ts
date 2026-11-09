/**
 * 作用定位：将已核实的目标详情与派发图投影成主对话的关键进展，不读取第二份日志或启动轮询。
 * 设计原因：计划、派发、执行与验收是不同事实；复用原增量屏障，重开仍从持久事实还原，不凭模型正文或运行结束推测成功。
 */
import type {GraphIdentity,GraphSnapshot,PublicDispatchScope,ScopeSummary} from '../../bridge/contracts/dispatch';
import {committedMemberHelp} from '../tasks/member-help-state';

export interface ConversationProgressItem {
  /** 来自原目标／任务身份，刷新只更新同一条目；不是新建的执行事件。 */
  id:string;title:string;lines:string[];tone:'neutral'|'running'|'warning';taskId?:string;
}
/** 只展示本会话、所选目标的同版详情；尚未追齐时不拼接另一个目标的分工。 */
export function conversationProgress(identity:GraphIdentity,graph:GraphSnapshot|undefined,summary:ScopeSummary|undefined,scope:PublicDispatchScope|undefined):ConversationProgressItem[]{
  if(!graph||!summary||!scope||graph.identity.workspaceId!==identity.workspaceId||graph.identity.rootSessionId!==identity.rootSessionId||scope.workspaceId!==identity.workspaceId||scope.rootSessionId!==identity.rootSessionId||scope.scopeId!==summary.scopeId||scope.goal?.revision!==summary.goalRevision||scope.status!==summary.status)return [];
  const items:ConversationProgressItem[]=[],goal=scope.goal,plan=goal?.plan;
  if(plan)items.push({id:scope.scopeId+':plan',title:`目标计划已保存 · 第 ${plan.revision} 版${summary.needsReplan?'（待更新）':''}`,tone:summary.needsReplan?'warning':'neutral',lines:[plan.objective,...plan.assignments.map(a=>`${a.agentName} → ${a.moduleNames.join('、')||'知识治理'}：${a.reason}${a.fallbackBinding?'（自动兜底）':''}`),`验收要求：${plan.criteria.map(c=>`${c.text}${c.kind==='human'?'（需人工验收）':''}`).join('；')}`]});
  else if(goal)items.push({id:scope.scopeId+':planning',title:scope.status==='active'?'主 Agent 正在梳理目标与分工':'本轮未保存目标计划',tone:scope.status==='active'?'running':'neutral',lines:[goal.input.message]});
  const tasks=graph.tasks.filter(t=>t.scopeId===scope.scopeId&&t.identity.workspaceId===identity.workspaceId&&t.identity.rootSessionId===identity.rootSessionId);
  for(const task of tasks){
    const own=(suffix:string,title:string,lines:string[],tone:ConversationProgressItem['tone']='neutral')=>items.push({id:task.taskId+':'+suffix,taskId:task.taskId,title,lines,tone});
    own('dispatch',`已派发给 ${task.assignee.name}`,[task.goal]);
    const dependencies=graph.edges.filter(e=>e.kind==='dependency'&&e.enabled&&e.toNodeId===task.nodeId&&e.identity.workspaceId===identity.workspaceId&&e.identity.rootSessionId===identity.rootSessionId);
    if(dependencies.length){
      const received=dependencies.filter(e=>e.kind==='dependency'&&e.condition.resultId);
      own('dependencies',received.length===dependencies.length?'前置候选已接收':'等待前置任务成果',dependencies.map(e=>{
        const source=tasks.find(t=>t.nodeId===e.fromNodeId),label=source?`${source.assignee.name}：${source.goal}`:'原前置任务';
        return (e.kind==='dependency'&&e.condition.resultId?'已接收候选 · ':'尚未接收 · ')+label;
      }),received.length===dependencies.length?'neutral':'warning');
    }
    if(task.status==='result_ready'&&task.result)own('result',`${task.assignee.name} 返回交付候选 · 尚未验收`,[task.result.summary,`证据引用 ${task.result.evidenceRefs.length} 项`,...task.result.limitations.map(x=>'限制：'+x)]);
    else{
      const titles:Record<typeof task.status,string>={planned:'等待安排',queued:task.activeRunId?'正在启动':'等待执行',running:'正在执行',waiting:'等待前置任务',checkpointed:'已保存检查点 · 等待调度',blocked:'执行受阻',failed:'执行失败',cancelled:'已停止',interrupted:'执行中断',result_ready:'交付待审阅'};
      const help=committedMemberHelp(task);
      own('execution',`${task.assignee.name} · ${titles[task.status]}`,[...(task.waitReason?[task.waitReason]:[]),...(help?[help.input.reason]:[])],task.status==='running'?'running':['failed','blocked','interrupted','waiting','checkpointed'].includes(task.status)?'warning':'neutral');
    }
  }
  if(goal?.review){const review=goal.review,labels={complete:'主 Agent 已提交完成申请',replan:'主 Agent 要求调整计划',blocked:'主 Agent 审阅：目标受阻',awaiting_user:'主 Agent 请求用户补充'};
    items.push({id:scope.scopeId+':review',title:labels[review.decision],tone:review.decision==='complete'?'neutral':'warning',lines:[review.reason,...review.gaps,...review.checks.map(c=>`${c.outcome==='satisfied'?'已满足':c.outcome==='needs_human'?'需人工确认':'尚未满足'}：${plan?.criteria.find(x=>x.id===c.criterionId)?.text??c.criterionId}；${c.reason}`)]});
  }
  if(goal?.blocked)items.push({id:scope.scopeId+':blocked',title:'目标受阻',tone:'warning',lines:[goal.blocked.reason]});
  return items;
}
