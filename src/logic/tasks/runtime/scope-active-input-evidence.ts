/**
 * 目录归属：logic/tasks/runtime；目标状态与核证恢复服务。
 * 作用定位：把目标补充的持久接收记录与原主运行的可信插入日志逐项核对。
 * 设计原因：Scope 与运行日志是两个真实存储，不能靠单边记录推断原生已经接收；未知不会被旧 review 或普通聊天完成例外洗白。
 */
import {fail} from '../../../core/errors';
import type {RunSummary} from '../../execution/rules/types';
import type {DispatchScope} from '../rules/dispatch-scope';
import {sameGoalValue} from '../rules/scope-goal';
import {scopeActiveInputTokenSchema} from '../rules/scope-active-input';
import {scopedActiveInputHash} from '../rules/scope-active-input-rules';

/** 只校验新协议标记，旧无 token 的历史不迁移；被选中的新日志必须完整、连续且属于原主运行。 */
export function validateScopeActiveInputLog(scope:DispatchScope,summary:RunSummary):void{
  const records=(scope.activeInputs??[]).filter(item=>item.runId===summary.runId),events=summary.events.filter(event=>event.type==='engine.status'&&event.data.activeInput!==undefined);
  if(!records.some(item=>item.status==='accepted')&&!events.length)return;
  const valid=(value:unknown,message:string)=>{if(!value)fail('GOAL_ACTIVE_INPUT_PROOF',message)};
  valid(summary.task.workspaceId===scope.workspaceId&&summary.task.taskId===scope.rootSessionId&&summary.task.agentId==='cbim:main'&&summary.task.mode==='chat'&&summary.logIntegrity?.partialTail===false,'补充来源的主运行身份或日志完整性不匹配');
  valid(summary.events.every((event,index)=>event.seq===index+1&&event.workspaceId===scope.workspaceId&&event.taskId===scope.rootSessionId&&event.runId===summary.runId),'补充来源日志不连续或混入其他运行');
  for(const event of events){
    const parsed=scopeActiveInputTokenSchema.safeParse(event.data.activeInput);valid(parsed.success,'补充日志缺少有效可信身份');if(!parsed.success)continue;
    const token=parsed.data,record=records.find(item=>item.insertionId===token.insertionId);
    valid(record&&token.scopeId===scope.scopeId&&token.runId===summary.runId&&token.queueId===record.queueId&&token.inputHash===record.inputHash,'原生插入日志没有对应的目标接收记录');
    valid(event.data.metric==='insertion'&&['requested','accepted','failed'].includes(String(event.data.state))&&typeof event.data.message==='string','补充日志状态或正文无效');
    if(!record)continue;
    valid(scopedActiveInputHash({message:String(event.data.message),...(record.attachmentIds?{attachmentIds:record.attachmentIds}:{})})===record.inputHash,'补充日志正文与原准备指纹不一致');
    if(event.data.state==='accepted')valid(record.status==='accepted'&&record.acceptedSeq===event.seq,'原生已接收补充尚未完整登记，不能沿旧目标完成');
    if(record.status==='accepted')valid(event.data.state!=='failed','已接收补充同时存在失败日志，结果需要核实');
  }
  for(const record of records){
    if(record.status!=='accepted')continue;
    const own=events.filter(event=>(event.data.activeInput as {insertionId?:unknown})?.insertionId===record.insertionId),requested=own.filter(event=>event.data.state==='requested'),accepted=own.filter(event=>event.data.state==='accepted');
    valid(requested.length===1&&accepted.length===1&&requested[0].seq===record.requestedSeq&&accepted[0].seq===record.acceptedSeq&&sameGoalValue(requested[0].data.activeInput,accepted[0].data.activeInput)&&requested[0].data.message===record.input.message&&accepted[0].data.message===record.input.message,'接收记录缺少原生 requested/accepted 的唯一对应日志');
  }
}
