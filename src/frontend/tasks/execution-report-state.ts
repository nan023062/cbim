/**
 * 作用定位：验证成员执行核实报告的身份和分页基线，并保存一次显式读取的前端状态。
 * 设计原因：核实不等于恢复；读失败保留已有报告，跨节点迟到响应与不同基线的工具页不能混用。准备再次核实时主动清缓存并作废在途读取，必须重新显式核实。
 * 订阅边界：前端 SubscriptionSet 只持有监听器；通知时机、状态、轮询及销毁仍由本控制器决定。
 */
import {SubscriptionSet} from '../foundations/utility';
import {executionReportSchema} from '../../bridge/contracts/dispatch';
import type {ExecutionReport,ExecutionReportInput,GraphCursor,ScopeSummary,TaskNode} from '../../bridge/contracts/dispatch';

/** scope 来自已选任务；请求协议不接受路径，也不按当前工作区猜测 root 或 run。 */
export type ExecutionReportSelection=Pick<ExecutionReportInput,'workspaceId'|'rootSessionId'|'taskId'|'runId'>&{scopeId?:string};
export interface ExecutionReportState {report?:ExecutionReport;loading:boolean;error:string}
export const executionReportKey=(identity:ExecutionReportSelection)=>JSON.stringify([identity.workspaceId,identity.rootSessionId,identity.scopeId,identity.taskId,identity.runId]);
const sameIdentity=(a:ExecutionReportSelection,b:ExecutionReport['identity'])=>a.workspaceId===b.workspaceId&&a.rootSessionId===b.rootSessionId&&a.taskId===b.taskId&&a.runId===b.runId;

/** 校验全部内容后才发布；服务器分页重置替换旧报告，绝不将两个读取基线拼成完整证据。 */
export function applyExecutionReport(previous:ExecutionReport|undefined,raw:unknown,request:ExecutionReportInput,selection:ExecutionReportSelection):ExecutionReport{
  const next=executionReportSchema.parse(raw);
  if(!sameIdentity(selection,next.identity)||next.basis.scopeId!==selection.scopeId||next.basis.graphCursor.workspaceId!==selection.workspaceId||next.basis.graphCursor.rootSessionId!==selection.rootSessionId)throw Error('核实报告不属于当前任务或执行轮次');
  if(next.candidate&&next.candidate.runId!==selection.runId)throw Error('核实报告包含其他执行轮次的交付候选');
  if(next.consistency==='changed_during_read'&&next.execution!=='unknown')throw Error('读取中变化的执行记录不能视为确定结果');
  const page=next.tools.items;
  if(page.length>(request.limit??50))throw Error('工具报告超过本次读取页大小');
  if(Object.values(next.tools.counts).reduce((total,value)=>total+value,0)!==next.tools.total)throw Error('工具报告数量与分类统计不一致');
  let items=page;
  if(request.cursor&&!next.tools.paginationReset&&next.consistency==='stable'){
    if(!previous||request.cursor.basis!==previous.basis.key||request.cursor.offset!==previous.tools.items.length||next.basis.key!==previous.basis.key||next.tools.total!==previous.tools.total||JSON.stringify(next.tools.counts)!==JSON.stringify(previous.tools.counts))throw Error('工具报告分页基线已变化，请重新核实');
    items=[...previous.tools.items,...page];
  }
  if(new Set(items.map(item=>item.toolCallId)).size!==items.length)throw Error('工具报告包含重复操作标识');
  for(const item of page){const receipt=item.receipt;if(item.scope.workspaceId!==selection.workspaceId||receipt&&(receipt.workspaceId!==selection.workspaceId||receipt.taskId!==selection.taskId||receipt.runId!==selection.runId||receipt.toolCallId!==item.toolCallId||receipt.toolName!==item.toolName||receipt.scope.workspaceId!==selection.workspaceId))throw Error('工具回执不属于所选执行轮次')}
  const cursor=next.tools.nextCursor;
  if(items.length>next.tools.total||cursor&&(cursor.basis!==next.basis.key||cursor.offset!==items.length||cursor.offset>=next.tools.total)||!cursor&&next.tools.available&&items.length!==next.tools.total)throw Error('工具报告分页不连续，保留原核实记录');
  return {...next,tools:{...next.tools,items}};
}

/** 当前图或周期与核实时不同只标为过期，不自动再次读取，更不能由此启动运行。 */
export function executionReportStale(report:ExecutionReport|undefined,task:TaskNode,graphCursor?:GraphCursor,scope?:ScopeSummary):boolean{
  if(!report)return false;
  const basis=report.basis;
  return report.consistency==='changed_during_read'||basis.taskRevision!==task.revision||basis.planRevision!==task.planRevision||basis.taskStatus!==task.status||basis.scopeId!==task.scopeId||Boolean(graphCursor&&(graphCursor.streamId!==basis.graphCursor.streamId||graphCursor.seq!==basis.graphCursor.seq))||Boolean(scope&&(basis.scopeId!==scope.scopeId||basis.scopeStatus!==scope.status||basis.goalRevision!==scope.goalRevision));
}

/** 实例只属于一个选中身份；创建、订阅和取消观察均不会请求后端，只有 inspect/more 显式读取。 */
export class ExecutionReportController {
  private value:ExecutionReportState={loading:false,error:''};
  private generation=0;
  private listeners=new SubscriptionSet();
  constructor(readonly selection:ExecutionReportSelection,private read:(request:ExecutionReportInput)=>Promise<unknown>,private limit=50){}
  get snapshot(){return this.value}
  subscribe=(listener:()=>void)=>{return this.listeners.subscribe(listener)};
  private publish(value:ExecutionReportState){this.value=value;this.listeners.notify()}
  /** 切换/卸载只忽略迟到读取；不停止后端任务或改变日志。 */
  cancel(){this.generation++;this.value={...this.value,loading:false}}
  /** 新草稿必须重新显式核实；清除旧缓存并作废已发出的读取，绝不自动回读或恢复运行。 */
  invalidate(){this.generation++;this.publish({loading:false,error:''})}
  async inspect(){await this.pull()}
  async more(){const report=this.value.report;if(!report?.tools.nextCursor||report.consistency!=='stable')return;await this.pull(report.tools.nextCursor)}
  private async pull(cursor?:NonNullable<ExecutionReportInput['cursor']>){
    if(this.value.loading)return;
    const {workspaceId,rootSessionId,taskId,runId}=this.selection,request:ExecutionReportInput={workspaceId,rootSessionId,taskId,...(runId?{runId}:{}),limit:this.limit,...(cursor?{cursor}: {})};
    const generation=this.generation,previous=this.value.report;this.publish({...this.value,loading:true,error:''});
    try{const response=await this.read(request);if(generation!==this.generation)return;const report=applyExecutionReport(previous,response,request,this.selection);this.publish({report,loading:false,error:''})}
    catch(cause){if(generation===this.generation)this.publish({...this.value,loading:false,error:cause instanceof Error?cause.message:'执行记录核实失败，请重新读取'})}
  }
}
