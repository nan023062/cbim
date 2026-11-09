/**
 * 作用定位：从当前成员公开事件推导结构验证展示状态，保留当时不符合与后续通过的各次事实。
 * 设计原因：validation.checked 先于工具回执，不能直接显示已通过；晚到、失败及后续副作用分别表达，不读取文件或推断外部变化。
 */
import type {PublicValidationResult,RunSummary} from '../../bridge/contracts/execution';

export interface MemberValidationView {result:PublicValidationResult;state:'passed'|'rejected'|'unconfirmed'|'stale'}
/** 仅当前 run 的已公开结果参与展示；截断或缺工具终态时保持未确认，不把其他轮次的完成借过来。 */
export function memberValidationViews(run:RunSummary):MemberValidationView[]{
  const rows:MemberValidationView[]=[];
  for(const event of run.events){
    if(event.type!=='validation.checked'||event.runId!==run.runId||event.taskId!==run.task.taskId||event.workspaceId!==run.task.workspaceId)continue;
    const value=event.data.validation as PublicValidationResult|undefined;
    if(!value||typeof value.validationId!=='string'||typeof value.toolCallId!=='string'||!value.requirement||!value.artifact||!Array.isArray(value.issues)||!['passed','rejected'].includes(value.outcome)||rows.some(row=>row.result.validationId===value.validationId))continue;
    const finished=run.events.filter(item=>item.type==='tool.finished'&&item.seq>event.seq&&item.runId===run.runId&&item.workspaceId===run.task.workspaceId&&item.taskId===run.task.taskId&&item.data.id===value.toolCallId&&item.data.name==='cbim_validation_run');
    const unique=run.events.filter(item=>item.type==='validation.checked'&&item.runId===run.runId&&item.workspaceId===run.task.workspaceId&&item.taskId===run.task.taskId&&(item.data.validation as PublicValidationResult|undefined)?.validationId===value.validationId).length===1;
    const receipt=finished[0]?.data.receipt as {outcome?:unknown;runId?:unknown;taskId?:unknown;workspaceId?:unknown;toolCallId?:unknown;toolName?:unknown}|undefined;
    const confirmed=unique&&finished.length===1&&finished[0].data.isError!==true&&receipt?.outcome==='succeeded'&&receipt.runId===run.runId&&receipt.taskId===run.task.taskId&&receipt.workspaceId===run.task.workspaceId&&receipt.toolCallId===value.toolCallId&&receipt.toolName==='cbim_validation_run';
    // 只根据可见的真实操作保守标过期；界面不声称能持续监测外部文件修改。
    const stale=confirmed&&run.events.some(item=>item.seq>finished[0].seq&&item.runId===run.runId&&item.workspaceId===run.task.workspaceId&&item.taskId===run.task.taskId&&item.type==='tool.allowed'&&(item.data.name==='cbim_task_plan'||['write','edit','bash'].includes(String(item.data.name))));
    rows.push({result:value,state:!confirmed?'unconfirmed':stale?'stale':value.outcome});
  }
  return rows;
}
