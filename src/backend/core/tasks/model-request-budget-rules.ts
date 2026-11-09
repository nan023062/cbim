/**
 * 作用定位：从不可变请求阶段计算预留、真实用量和后续请求的准入，供服务及 Store 独立核对。
 * 设计原因：所有在途预留共同占额度，跨实例遗留视为未知；按协议报告结算，不能根据模型文字或错误状态猜测免费。
 */
import {hash,json} from '../foundation/serialization';
import type {ScopeBudgetPolicy} from './scope-budget';
import {modelRequestBudgetLimits,type ModelRequestBudgetChange,type RequestBudgetRecord,type RequestBudgetIntent,type RequestBudgetModel,type RequestBudgetUsage,type RequestBudgetReport,type RequestBudgetDenial} from './model-request-budget';

/** 保守以完整输入容量加本次明确输出上限预留；不以字符数声称精确 tokenizer 计数。 */
export function requestBudgetReservation(model:Pick<RequestBudgetModel,'contextWindow'|'maxTokens'|'pricing'>,maxOutputTokens:number):{tokens:number;estimatedCostUsd?:number}{
  if(!Number.isSafeInteger(maxOutputTokens)||maxOutputTokens<1||maxOutputTokens>model.maxTokens)throw Error('模型请求缺少有效的冻结输出上限');
  const tokens=model.contextWindow+maxOutputTokens,p=model.pricing;
  const weighted=p?model.contextWindow*Math.max(p.input,p.cacheRead,p.cacheWrite)+maxOutputTokens*p.output:undefined;
  const cost=weighted===undefined?undefined:weighted>0?Math.max(Number.MIN_VALUE,weighted/1000000):0;
  if(cost!==undefined&&(!Number.isFinite(cost)||cost>Number.MAX_SAFE_INTEGER))throw Error('模型请求价格超出可核实范围');
  return {tokens,...(cost===undefined?{}:{estimatedCostUsd:cost})};
}
/** 价格由原模型快照给出；没有价格保留 undefined，明确全零价格才表示估算为零。 */
export function requestBudgetCost(model:RequestBudgetModel,usage:RequestBudgetUsage):number|undefined{
  const p=model.pricing;if(!p)return;const weighted=usage.input*p.input+usage.output*p.output+usage.cacheRead*p.cacheRead+usage.cacheWrite*p.cacheWrite;
  // 极小的正价格仍不是免费；单位换算下溢时取最小正表示，不能据浮点零放行下一请求。
  const cost=weighted>0?Math.max(Number.MIN_VALUE,weighted/1000000):0;
  if(!Number.isFinite(cost)||cost>Number.MAX_SAFE_INTEGER)throw Error('模型请求用量计价超出范围');return cost;
}
export function requestBudgetRecords(changes:readonly ModelRequestBudgetChange[]):RequestBudgetRecord[]{
  const records=new Map<string,RequestBudgetRecord>();for(const change of changes){if(change.phase==='reserved'||change.phase==='denied')records.set(change.requestId,{intent:change.intent,change});else{const old=records.get(change.requestId);if(!old)throw Error('请求预算阶段没有原预留');records.set(change.requestId,{intent:old.intent,change})}}return [...records.values()];
}
/** ownerInstanceId 只用于区分本进程真实在途与重启遗留，不修改原未决阶段。 */
export function requestBudgetReport(records:readonly RequestBudgetRecord[],scope:{workspaceId:string;rootSessionId:string;scopeId:string;policyRevision:number},ownerInstanceId:string):RequestBudgetReport{
  const report:RequestBudgetReport={...scope,requests:0,reported:0,inFlight:0,unknown:0,denied:0,notSent:0,tokens:0,reservedTokens:0,estimatedCostUsd:0,costComplete:true,reservedCostUsd:0,overrun:0};
  for(const {intent,change} of records){if(intent.binding.scopeId!==scope.scopeId||intent.binding.workspaceId!==scope.workspaceId||intent.binding.rootSessionId!==scope.rootSessionId)continue;report.requests++;
    if(change.phase==='denied'){report.denied++;report.lastDenial=change.reason;report.lastDeniedTokens=intent.tokens;if(intent.estimatedCostUsd===undefined)delete report.lastDeniedCostUsd;else report.lastDeniedCostUsd=intent.estimatedCostUsd;continue}
    if(change.phase==='not_sent'){report.notSent++;continue}
    if(change.phase==='reported'){
      report.reported++;report.tokens+=change.usage.totalTokens;if(change.estimatedCostUsd===undefined)report.costComplete=false;else report.estimatedCostUsd+=change.estimatedCostUsd;
      if(change.usage.input+change.usage.cacheRead+change.usage.cacheWrite>intent.model.contextWindow||change.usage.output>intent.maxOutputTokens||change.estimatedCostUsd!==undefined&&intent.estimatedCostUsd!==undefined&&exceeds(change.estimatedCostUsd,intent.estimatedCostUsd))report.overrun++;continue;
    }
    report.reservedTokens+=intent.tokens;report.reservedCostUsd+=intent.estimatedCostUsd??0;
    if(change.phase==='unknown'||intent.binding.ownerInstanceId!==ownerInstanceId)report.unknown++;else report.inFlight++;
    if(intent.estimatedCostUsd===undefined)report.costComplete=false;
  }return report;
}
/** 只容忍同数量级浮点尾差；极小正额度不按零处理。 */
function exceeds(value:number,limit:number){return value>limit&&value-limit>4*Number.EPSILON*Math.max(Math.abs(value),Math.abs(limit))}
export function requestBudgetDecision(policy:ScopeBudgetPolicy,report:RequestBudgetReport,intent:Pick<RequestBudgetIntent,'tokens'|'estimatedCostUsd'>,records:readonly RequestBudgetRecord[]):RequestBudgetDenial|undefined{
  if(records.length>=modelRequestBudgetLimits.requests||report.requests>=modelRequestBudgetLimits.requestsPerScope)return 'capacity';
  if(report.unknown||report.overrun)return 'usage_unverifiable';
  if(policy.limits.tokens!==undefined&&exceeds(report.tokens+report.reservedTokens+intent.tokens,policy.limits.tokens))return 'token_reserve';
  if(policy.limits.estimatedCostUsd!==undefined){if(!report.costComplete||intent.estimatedCostUsd===undefined)return 'unpriced';if(exceeds(report.estimatedCostUsd+report.reservedCostUsd+intent.estimatedCostUsd,policy.limits.estimatedCostUsd))return 'cost_reserve'}
}
/** 请求阶段占独立幂等键；不能用相同 ID 改正文摘要或把另一请求的结算套进来。 */
export const requestBudgetCommand=(change:ModelRequestBudgetChange)=>({commandId:'model-request:'+change.requestId+':'+change.revision,fingerprint:hash(json(change.phase==='reserved'||change.phase==='denied'?{intent:change.intent}:change))});
export const requestBudgetReceipt=(change:ModelRequestBudgetChange)=>({requestId:change.requestId,phase:change.phase,revision:change.revision});
