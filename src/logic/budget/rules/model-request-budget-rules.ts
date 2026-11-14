/**
 * 目录归属：logic/budget/rules/budget；请求与周期预算规则。
 * 作用定位：从不可变请求阶段计算预留、真实用量和后续请求的准入，供服务及 Store 独立核对。
 * 设计原因：所有在途预留共同占额度，跨实例遗留视为未知；按协议报告结算，不能根据模型文字或错误状态猜测免费。
 */
import {hash,json} from '../../../core/platform/node/serialization';
import type {ScopeBudgetPolicy} from './scope-budget';
import {modelRequestBudgetLimits,type ModelRequestBudgetChange,type RequestBudgetRecord,type RequestBudgetIntent,type RequestBudgetModel,type RequestBudgetCapacity,type RequestBudgetUsage,type RequestBudgetReport,type RequestBudgetDenial} from './model-request-budget';

/** 生成按输入容量和输出上限预留，向量只按其输入容量预留；不猜 tokenizer。 */
export function requestBudgetReservation(model:RequestBudgetCapacity,maxOutputTokens:number):{tokens:number;estimatedCostUsd?:number}{
  if('inputTokens' in model){
    if(maxOutputTokens!==0)throw Error('向量请求不能声明生成输出容量');
    const cost=priced(model.inputPrice===undefined?undefined:model.inputTokens*model.inputPrice);
    return {tokens:model.inputTokens,...(cost===undefined?{}:{estimatedCostUsd:cost})};
  }
  if(!Number.isSafeInteger(maxOutputTokens)||maxOutputTokens<1||maxOutputTokens>model.maxTokens)throw Error('模型请求缺少有效的冻结输出上限');
  const tokens=model.contextWindow+maxOutputTokens,p=model.pricing;
  const cost=priced(p?model.contextWindow*Math.max(p.input,p.cacheRead,p.cacheWrite)+maxOutputTokens*p.output:undefined);
  return {tokens,...(cost===undefined?{}:{estimatedCostUsd:cost})};
}
/** 极小正价格不能因单位换算变成免费；未知价格保持缺省。 */
function priced(weighted:number|undefined):number|undefined{
  if(weighted===undefined)return;
  const cost=weighted>0?Math.max(Number.MIN_VALUE,weighted/1000000):0;
  if(!Number.isFinite(cost)||cost>Number.MAX_SAFE_INTEGER)throw Error('模型请求用量计价超出范围');return cost;
}
/** 向量协议不得把输出、缓存或推理分量混进已核实的输入用量。 */
export function requestBudgetCost(model:RequestBudgetModel,usage:RequestBudgetUsage):number|undefined{
  if(model.api==='openai-embeddings'){
    if(usage.output||usage.cacheRead||usage.cacheWrite)throw Error('向量请求用量包含非输入分量');
    return priced(model.inputPrice===undefined?undefined:usage.input*model.inputPrice);
  }
  const p=model.pricing;return priced(p?usage.input*p.input+usage.output*p.output+usage.cacheRead*p.cacheRead+usage.cacheWrite*p.cacheWrite:undefined);
}
/** 只读容量投影，不为向量假造 contextWindow 或 maxTokens。 */
export const requestBudgetInputCapacity=(model:RequestBudgetModel)=>model.api==='openai-embeddings'?model.inputTokens:model.contextWindow;
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
      if(change.usage.input+change.usage.cacheRead+change.usage.cacheWrite>requestBudgetInputCapacity(intent.model)||change.usage.output>intent.maxOutputTokens||change.estimatedCostUsd!==undefined&&intent.estimatedCostUsd!==undefined&&exceeds(change.estimatedCostUsd,intent.estimatedCostUsd))report.overrun++;continue;
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
