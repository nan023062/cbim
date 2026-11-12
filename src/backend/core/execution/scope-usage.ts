/**
 * 目录归属：backend/core/execution；运行协议与计量。
 * 作用定位：从单轮 canonical 摘要提取保守的已报告消耗，并汇总指定周期的主/成员计量。
 * 设计原因：界面累计允许宽松展示，周期计量必须保留缺字段、无终态、截断与未知价格；完整原生差额覆盖消息数字，不能双计摘要或把推理再次相加。
 * 职责边界：纯读取，不访问文件或模型、不修复记录，也不把估算金额当作供应商账单或预算许可。
 */
import type {RunSummary,StoredEvent} from './types';
import type {ScopeRunUsage,ScopeUsageTokens,ScopeUsageRun,ScopeUsageTotals,ScopeUsageIssue} from '../budget/scope-usage';
import {fail} from '../foundation/errors';

const tokenKeys=['input','output','cacheRead','cacheWrite'] as const;
const number=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value)&&value>=0;
const token=(value:unknown):value is number=>number(value)&&Number.isSafeInteger(value);
const record=(value:unknown):Record<string,unknown>|undefined=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:undefined;
const emptyTokens=():ScopeUsageTokens=>({input:0,output:0,cacheRead:0,cacheWrite:0,reasoning:0,total:0});
/** 缺失日志/用量时保留 missing；零只是尚无已知数字，不能呈现为免费或已确定零消耗。 */
export function emptyScopeRunUsage():ScopeRunUsage{return {source:'none',tokensState:'missing',costState:'unknown',tokens:emptyTokens(),issues:[]}}
function readTokens(raw:unknown){const value=record(raw),tokens=emptyTokens();let present=false,complete=!!value;
  for(const key of tokenKeys){if(token(value?.[key])){tokens[key]=value![key] as number;present=true}else complete=false}
  if(token(value?.reasoning))tokens.reasoning=Math.min(value!.reasoning as number,tokens.output);
  tokens.total=tokenKeys.reduce((sum,key)=>sum+tokens[key],0);
  if(!Number.isSafeInteger(tokens.total))return {tokens:emptyTokens(),present:false,complete:false};
  return {tokens,present,complete};
}
function addTokens(target:ScopeUsageTokens,value:ScopeUsageTokens){for(const key of [...tokenKeys,'reasoning','total'] as const)target[key]+=value[key]}
function price(data:Record<string,unknown>,aggregate=false){
  const value=aggregate?data.cost:record(record(data.usage)?.cost)?.total;
  const provider=aggregate?data.totalFromProvider:record(record(data.usage)?.cost)?.totalFromProvider;
  return number(value)&&(data.pricingKnown===true||provider===true||value>0)?value:undefined;
}
const hasTerminal=(event:StoredEvent,status:RunSummary['status'])=>event.type==='run.settled'&&event.data?.status===status&&status!=='running'||event.type==='run.interrupted'&&status==='interrupted';

/** 只有完整且不早于任何消息的原生汇总能声明 reported；仅消息计量始终是部分值。 */
export function measureScopeRunUsage(summary:RunSummary):ScopeRunUsage {
  const result=emptyScopeRunUsage(),issues:ScopeUsageIssue[]=[];
  const issue=(code:string,message:string)=>{if(!issues.some(item=>item.code===code))issues.push({code,message})};
  let messages=emptyTokens(),messageCount=0,reportedMessages=0,completeMessages=0,pricedMessages=0,messageCost=0;
  let lastMessage=-1,lastInvalidSummary=-1,aggregate:{index:number;tokens:ScopeUsageTokens;cost?:number}|undefined;
  let sequenceValid=true,terminalIndex=-1;
  for(const [index,event] of summary.events.entries()){
    if(event.workspaceId!==summary.task.workspaceId||event.taskId!==summary.task.taskId||event.runId!==summary.runId||event.seq!==index+1)sequenceValid=false;
    const data=record(event.data)??{};
    if(hasTerminal(event,summary.status))terminalIndex=index;
    if(event.type==='message'&&data.role==='assistant'){
      lastMessage=index;messageCount++;const measured=readTokens(data.usage);
      if(measured.present){reportedMessages++;addTokens(messages,measured.tokens)}
      if(measured.complete)completeMessages++;
      const cost=price(data);if(cost!==undefined){pricedMessages++;messageCost+=cost}
    }
    if(event.type==='engine.status'&&data.metric==='run-usage'){
      const measured=readTokens(data.tokens);
      // 原生累计差额不应小于同轮此前已知消息；损坏汇总不能抹掉已有数字或宣称完整。
      if(measured.complete&&tokenKeys.every(key=>measured.tokens[key]>=messages[key]))aggregate={index,tokens:{...measured.tokens,reasoning:Math.min(Math.max(measured.tokens.reasoning,messages.reasoning),measured.tokens.output)},cost:price(data,true)};
      else lastInvalidSummary=index;
    }
  }
  if(!sequenceValid){issue('USAGE_SEQUENCE_INVALID','运行事件身份或顺序不完整，不能形成可靠计量');return {...result,issues}}
  if(aggregate&&aggregate.index>=lastMessage){
    result.source='run-summary';result.tokens={...aggregate.tokens};result.estimatedCostUsd=aggregate.cost;
    const complete=terminalIndex>aggregate.index&&terminalIndex===summary.events.length-1&&summary.status!=='running'&&summary.logIntegrity?.partialTail===false&&lastInvalidSummary<aggregate.index;
    result.tokensState=complete?'reported':'partial';result.costState=aggregate.cost===undefined?'unknown':complete?'priced':'partial';
    if(aggregate.cost===undefined&&pricedMessages){result.estimatedCostUsd=messageCost;result.costState='partial'}
  }else if(reportedMessages||pricedMessages){
    result.source='messages';result.tokens={...messages};result.tokensState=reportedMessages?'partial':'missing';
    if(pricedMessages)result.estimatedCostUsd=messageCost;
    result.costState=pricedMessages?'partial':'unknown';
  }
  if(!token(result.tokens.total)||!number(result.estimatedCostUsd??0)){issue('USAGE_VALUE_INVALID','累计数字超过可可靠表示的范围');return {...emptyScopeRunUsage(),issues}}
  if(summary.logIntegrity?.partialTail)issue('USAGE_LOG_INCOMPLETE','运行日志尾行不完整，当前只包含已读前缀');
  else if(summary.logIntegrity?.partialTail!==false)issue('USAGE_LOG_UNVERIFIED','未提供磁盘日志完整性，不能声明本轮计量完整');
  if(terminalIndex<0||summary.status==='running')issue('USAGE_RUN_UNSETTLED','运行尚无可靠终态，用量仍可能继续增加');
  if(lastInvalidSummary>=0&&(!aggregate||lastInvalidSummary>aggregate.index))issue('USAGE_SUMMARY_INVALID','原生用量汇总不完整或与此前已报告数字矛盾');
  if(result.tokensState==='missing')issue('USAGE_NOT_REPORTED','没有取得可核实的 Token 用量，不代表未消费');
  else if(result.tokensState==='partial')issue('USAGE_PARTIAL','当前仅为部分已报告消耗，可能缺少摘要、失败请求或后续运行用量');
  if(result.source!=='run-summary'&&completeMessages<messageCount)issue('USAGE_MESSAGE_PARTIAL','部分模型消息未报告完整的输入、输出或缓存用量');
  if(result.costState==='unknown')issue('USAGE_PRICE_UNKNOWN','没有可信计价依据，不能把费用当作零');
  else if(result.costState==='partial')issue('USAGE_COST_PARTIAL','金额只包含已取得计价依据的部分消耗');
  result.issues=issues;return result;
}

/** 汇总仅接受本次读取的精确运行集合；legacy、读取竞争、在途或缺日志均使完整性为 false。 */
export function summarizeScopeUsage(runs:readonly ScopeUsageRun[],coverage:'tracked'|'legacy',consistency:'stable'|'changed_during_read'):ScopeUsageTotals {
  const totals:ScopeUsageTotals={tokens:emptyTokens(),registeredRuns:runs.length,readRuns:0,inFlightRuns:0,missingUsageRuns:0,partialUsageRuns:0,unpricedRuns:0,tokensComplete:runs.length>0&&coverage==='tracked'&&consistency==='stable',costComplete:runs.length>0&&coverage==='tracked'&&consistency==='stable'};
  const seen=new Set<string>();
  let priced=0;
  for(const run of runs){
    if(seen.has(run.runId))fail('SCOPE_USAGE_DUPLICATE','运行归属重复，不能重复累计消耗');seen.add(run.runId);
    const usage=run.usage,read=run.logState==='verified'||run.logState==='incomplete',inFlight=run.status==='running'||run.status==='starting';
    if(read)totals.readRuns++;if(inFlight)totals.inFlightRuns++;
    if(usage.tokensState==='missing')totals.missingUsageRuns++;else if(usage.tokensState==='partial')totals.partialUsageRuns++;
    if(usage.costState!=='priced')totals.unpricedRuns++;
    if(read){addTokens(totals.tokens,usage.tokens);if(usage.estimatedCostUsd!==undefined){totals.estimatedCostUsd=(totals.estimatedCostUsd??0)+usage.estimatedCostUsd;priced++}}
    totals.tokensComplete&&=run.logState==='verified'&&!inFlight&&run.status!=='unknown'&&usage.tokensState==='reported';
    totals.costComplete&&=run.logState==='verified'&&!inFlight&&run.status!=='unknown'&&usage.costState==='priced';
  }
  if(!priced)delete totals.estimatedCostUsd;
  if(!Object.values(totals.tokens).every(token)||!number(totals.estimatedCostUsd??0))fail('SCOPE_USAGE_LIMIT','累计消耗超过可可靠表示的范围，不能返回零或不精确总数');
  return totals;
}
