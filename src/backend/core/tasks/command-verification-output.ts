/**
 * 作用定位：后端原命令报告的回执归属校验与紧凑公共投影，复用现有主工具输出契约。
 * 设计原因：原 Store 回执可能带私有周期上下文；先核原请求与绑定，再只返回白名单摘要，不把当前对象状态或 Schema 补值当成原事实。
 * 职责边界：这里不计算命令指纹、不访问 Store、不签发执行许可；本模块仅供后端，Bridge 只导叶子报告协议。
 */
import {isDeepStrictEqual} from 'node:util';
import {fail} from '../foundation/errors';
import type {DispatchScope} from './dispatch-scope';
import {goalInputRevision} from './scope-goal';
import {mainToolOutputSchema,projectMainScope,type MainToolOutput,type MainToolOutputExpectation} from './main-tool-output';
import {commandResultSummarySchema,commandVerificationLimits,type CommandResultSummary,type VerifiableMainToolName} from './command-verification';

/** 真实完整回执已由原 Store JSON 固定；不允许解析时 trim/默认化掩盖坏原值。 */
export function projectCommandReceipt(name:VerifiableMainToolName,raw:unknown,expected:MainToolOutputExpectation):CommandResultSummary {
  const publicValue=name==='cbim_goal_plan'||name==='cbim_goal_review'?projectMainScope(raw as DispatchScope):raw;
  const parsed=mainToolOutputSchema(name,expected).safeParse(publicValue);
  if(!parsed.success||!isDeepStrictEqual(parsed.data,publicValue))fail('COMMAND_RECEIPT_INVALID','原命令回执无法按真实请求及归属核实');
  const tasks=(ids:string[])=>({total:ids.length,taskIds:ids.slice(0,commandVerificationLimits.summaryItems),truncated:ids.length>commandVerificationLimits.summaryItems});
  let result:CommandResultSummary;
  if(name==='cbim_goal_plan'||name==='cbim_goal_review'){
    const scope=parsed.data as MainToolOutput<'cbim_goal_plan'>,goal=scope.goal!,plan=goal.plan!;
    if(name==='cbim_goal_plan')result={toolName:name,goalRevision:goal.revision,inputRevision:goalInputRevision(goal),planRevision:plan.revision,recordedAt:plan.recordedAt,criterionCount:plan.criteria.length,assignmentCount:plan.assignments.length};
    else {const review=goal.review!;result={toolName:name,goalRevision:goal.revision,inputRevision:goalInputRevision(goal),planRevision:review.planRevision,reviewRevision:review.revision,recordedAt:review.recordedAt,decision:review.decision,checkCount:review.checks.length}}
  }else if(name==='cbim_dispatch_task'){
    const r=parsed.data as MainToolOutput<'cbim_dispatch_task'>;result={toolName:name,taskId:r.taskId,messageId:r.messageId,cursor:r.cursor,disposition:r.disposition};
  }else if(name==='cbim_dispatch_cancel'){
    const r=parsed.data as MainToolOutput<'cbim_dispatch_cancel'>;result={toolName:name,cancelled:tasks(r.cancelledTaskIds),graphCursor:r.graphCursor};
  }else if(name==='cbim_dispatch_replace_dependency'){
    const r=parsed.data as MainToolOutput<'cbim_dispatch_replace_dependency'>;result={toolName:name,taskId:r.taskId,status:r.status,retiredEdgeId:r.replacement.retired.edgeId,replacementEdgeId:r.replacement.replacement.edgeId,sourceTaskId:r.replacement.replacement.sourceTaskId,sourceRunId:r.replacement.replacement.runId,sourceResultId:r.replacement.replacement.resultId,tracked:tasks(r.trackedTaskIds),graphCursor:r.graphCursor};
  }else if(name==='cbim_dispatch_add_dependency'){
    const r=parsed.data as MainToolOutput<'cbim_dispatch_add_dependency'>;result={toolName:name,taskId:r.taskId,status:r.status,edgeId:r.addition.dependency.edgeId,sourceTaskId:r.addition.dependency.sourceTaskId,tracked:tasks(r.trackedTaskIds),graphCursor:r.graphCursor};
  }else if(name==='cbim_dispatch_resume'){
    const r=parsed.data as MainToolOutput<'cbim_dispatch_resume'>;result={toolName:name,taskId:r.taskId,checkpointId:r.checkpointId,requestId:r.requestId,tracked:tasks(r.trackedTaskIds),cursor:r.cursor};
  }else{
    const r=parsed.data as MainToolOutput<'cbim_dispatch_abandon_checkpoint'>,a=r.abandonment;result={toolName:name,taskId:r.taskId,status:r.status,checkpointId:a.checkpointId,sourceRunId:a.sourceRunId,resumeRequestId:a.resumeRequestId,previousLeaseEpoch:a.previousLeaseEpoch,nextLeaseEpoch:a.nextLeaseEpoch,abandonedAt:a.abandonedAt,graphCursor:r.graphCursor};
  }
  // 再核投影自身的有界契约；构造新对象不会把原私有上下文带出。
  return commandResultSummarySchema.parse(result);
}
