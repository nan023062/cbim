/**
 * 作用定位：管理任务周期用量的一次显式读取，并验证返回身份、计量来源与汇总一致性。
 * 设计原因：大日志不按秒重复读取；控制器绑定唯一周期，切换后忽略迟到结果。读取失败保留上次快照并标记问题，不把缺失数据解释为零消费。
 * 订阅边界：前端 SubscriptionSet 只持有监听器；通知时机、状态、轮询及销毁仍由本控制器决定。
 */
import {SubscriptionSet} from '../foundations/utility';
import {scopeUsageInputSchema,scopeUsageReportSchema,type ScopeUsageInput,type ScopeUsageReport,type ScopeUsageRun} from '../../bridge/contracts/scope-usage';

export interface ScopeUsageState {report?:ScopeUsageReport;loading:boolean;error:string}
/** 身份不包含展示筛选或路径；主会话下不同目标周期不得合并。 */
export const scopeUsageKey=(identity:ScopeUsageInput)=>JSON.stringify([identity.workspaceId,identity.rootSessionId,identity.scopeId]);
const close=(a:number,b:number)=>Math.abs(a-b)<=Math.max(1,Math.abs(a),Math.abs(b))*1e-10;

/** 分组只合计报告中已知数字；未报告/未知费用的运行保留计数，不能用零填补实际账单。 */
export function scopeUsageGroup(runs:ScopeUsageRun[]){
  let tokens=0,cost=0,priced=0,missing=0;
  for(const run of runs){tokens+=run.usage.tokens.total;if(run.usage.estimatedCostUsd!==undefined){cost+=run.usage.estimatedCostUsd;priced++}if(run.logState!=='verified'||run.usage.tokensState!=='reported')missing++}
  return {runs:runs.length,tokens,cost:priced?cost:undefined,missing};
}

/** 只发布本周期且内部自洽的快照；完整标志不能覆盖缺日志、部分汇总、在途或读取中变化。 */
export function checkedScopeUsage(raw:unknown,identity:ScopeUsageInput):ScopeUsageReport{
  const report=scopeUsageReportSchema.parse(raw);
  if(scopeUsageKey(report.identity)!==scopeUsageKey(identity))throw Error('用量报告不属于当前任务周期，请重新读取');
  if(new Set(report.runs.map(run=>run.runId)).size!==report.runs.length||report.runs.some(run=>run.kind==='main'&&run.taskId!==identity.rootSessionId))throw Error('用量报告包含重复或跨会话运行');
  const totals=report.totals;
  if(totals.registeredRuns!==report.runs.length)throw Error('用量报告的运行数量不一致');
  const fields=['input','output','cacheRead','cacheWrite','reasoning','total'] as const;
  for(const run of report.runs){const t=run.usage.tokens;if(!close(t.total,t.input+t.output+t.cacheRead+t.cacheWrite)||t.reasoning>t.output)throw Error('运行用量口径不一致');}
  for(const field of fields)if(!close(totals.tokens[field],report.runs.reduce((sum,run)=>sum+run.usage.tokens[field],0)))throw Error('周期用量与逐运行合计不一致');
  const group=scopeUsageGroup(report.runs);
  if((group.cost===undefined)!==(totals.estimatedCostUsd===undefined)||group.cost!==undefined&&!close(group.cost,totals.estimatedCostUsd!))throw Error('周期费用与逐运行合计不一致');
  const ready=report.coverage==='tracked'&&report.consistency==='stable'&&report.runs.length>0&&totals.inFlightRuns===0&&report.runs.every(run=>run.logState==='verified'&&run.usage.tokensState==='reported');
  if(totals.tokensComplete&&!ready||totals.costComplete&&(!ready||report.runs.some(run=>run.usage.costState!=='priced'||run.usage.estimatedCostUsd===undefined)))throw Error('存在未核实记录，不能标记完整周期用量');
  return report;
}

/** 构造/订阅不读取；只有 read 明确查询，重复点击合并，取消只作废观察而不改变执行。 */
export class ScopeUsageController {
  private value:ScopeUsageState={loading:false,error:''};
  private generation=0;
  private listeners=new SubscriptionSet();
  readonly identity:ScopeUsageInput;
  constructor(identity:ScopeUsageInput,private request:(identity:ScopeUsageInput)=>Promise<unknown>){this.identity=scopeUsageInputSchema.parse(identity)}
  get snapshot(){return this.value}
  subscribe=(listener:()=>void)=>{return this.listeners.subscribe(listener)};
  private publish(value:ScopeUsageState){this.value=value;this.listeners.notify()}
  cancel(){this.generation++;this.value={...this.value,loading:false}}
  async read(){
    if(this.value.loading)return;const generation=this.generation;this.publish({...this.value,loading:true,error:''});
    try{const raw=await this.request({...this.identity});if(generation!==this.generation)return;this.publish({report:checkedScopeUsage(raw,this.identity),loading:false,error:''})}
    catch(error){if(generation===this.generation)this.publish({...this.value,loading:false,error:error instanceof Error?error.message:'周期用量读取失败，请重新读取'})}
  }
}
