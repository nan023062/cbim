/**
 * 作用定位：在唯一工作区 Store 提交与重放时核实请求身份、预算预留和不可改写的阶段链。
 * 设计原因：网络 IO 必须在持久事务外；只有精确预留能进入发送意图，终态记录允许停止后结算，但不能改写原预算或夹带业务变化。
 */
import {isDeepStrictEqual as equal} from 'node:util';
import {fail} from '../foundation/errors';
import {workspaceMemberModelHash} from '../team/workspace-member-rules';
import type {DispatchState,DispatchMutation,DispatchCommand} from './dispatch-storage';
import {modelRequestBudgetChangeSchema,modelRequestBudgetLimits,type RequestBudgetIntent} from './model-request-budget';
import {requestBudgetRecords,requestBudgetReport,requestBudgetDecision,requestBudgetReservation,requestBudgetCost,requestBudgetCommand,requestBudgetReceipt} from './model-request-budget-rules';

function check(value:unknown,message:string):asserts value{if(!value)fail('MODEL_REQUEST_BUDGET_AUDIT',message)}
/** 仅新预留和发送意图要求当前在途身份；既有请求终态不能被停止或后来配置变化抹掉。 */
function live(state:DispatchState,intent:RequestBudgetIntent){
  const b=intent.binding,scope=state.scopes?.find(s=>s.scopeId===b.scopeId&&s.workspaceId===b.workspaceId&&s.rootSessionId===b.rootSessionId);
  check(b.workspaceId===state.workspaceId&&scope?.status==='active'&&scope.budget?.policy.enabled&&scope.budget.policy.enforcement==='request'&&scope.budget.policy.revision===intent.policyRevision,'请求必须属于当前已冻结逐请求预算的活动周期');
  if(b.kind==='main')check(b.taskId===b.rootSessionId&&scope.runTracking?.mainRunIds.at(-1)===b.runId,'主请求必须属于本周期最近登记的真实主运行');
  else{
    const task=state.graphs.find(g=>g.identity.rootSessionId===b.rootSessionId)?.tasks.find(t=>t.taskId===b.taskId),run=state.runs?.find(r=>r.binding.runId===b.runId);
    check(task?.scopeId===scope.scopeId&&task.activeRunId===b.runId&&task.status==='running'&&run?.status==='running'&&run.binding.workspaceId===b.workspaceId&&run.binding.rootSessionId===b.rootSessionId&&run.binding.taskId===b.taskId,'成员请求缺少当前实际领取的运行');
    check(intent.model.configurationHash===workspaceMemberModelHash(run.model as Parameters<typeof workspaceMemberModelHash>[0]),'成员请求不能换用其它模型或计价');
  }return scope;
}
/** 附录每次只保存一条事件和对应窄回执；旧缺省保留，任何请求历史都不因新事务被删除。 */
export function projectModelRequestBudgetMutation(previous:DispatchState,mutation:DispatchMutation,command:DispatchCommand):Pick<DispatchState,'modelRequestBudgetChanges'>{
  const prior=previous.modelRequestBudgetChanges;
  if(mutation.modelRequestBudgetChanges===undefined){check(!command.commandId.startsWith('model-request:'),'请求预算命令缺少阶段事件');return prior===undefined?{}:{modelRequestBudgetChanges:prior}}
  const changes=mutation.modelRequestBudgetChanges;check(Array.isArray(changes)&&changes.length===1&&Object.keys(mutation).every(k=>k==='modelRequestBudgetChanges'||k==='receipt'),'请求预算不能混入其它领域变化');
  const change=changes[0],parsed=modelRequestBudgetChangeSchema.safeParse(change);check(parsed.success&&equal(parsed.data,change),'请求预算阶段结构无效');
  check(equal(command,requestBudgetCommand(change))&&equal(mutation.receipt,requestBudgetReceipt(change)),'请求预算原命令或回执不匹配');
  const records=requestBudgetRecords(prior??[]),old=records.find(r=>r.intent.requestId===change.requestId);
  if(change.phase==='reserved'||change.phase==='denied'){
    const i=change.intent;check(!old&&change.revision===1&&i.requestId===change.requestId&&i.createdAt===change.recordedAt,'新请求身份重复或时间不一致');
    const scope=live(previous,i),expected=requestBudgetReservation(i.model,i.maxOutputTokens);check(expected.tokens===i.tokens&&expected.estimatedCostUsd===i.estimatedCostUsd,'请求预留未使用原模型容量和价格');
    const report=requestBudgetReport(records,{workspaceId:scope.workspaceId,rootSessionId:scope.rootSessionId,scopeId:scope.scopeId,policyRevision:i.policyRevision},i.binding.ownerInstanceId),reason=requestBudgetDecision(scope.budget!.policy,report,i,records);
    check(change.phase==='reserved'?!reason:!!reason&&reason===change.reason,'请求预算决策与原冻结额度或未决消耗不一致');
    check(records.length<modelRequestBudgetLimits.requests&&report.requests<modelRequestBudgetLimits.requestsPerScope,'请求预算历史容量已满，不删除旧记录');
  }else{
    check(old&&['reserved','issuing'].includes(old.change.phase)&&change.revision===old.change.revision+1&&change.recordedAt>=old.change.recordedAt,'请求阶段前缀、版本或时间不一致');
    check(change.phase==='not_sent'||(old.change.phase==='reserved'?change.phase==='issuing':change.phase==='reported'||change.phase==='unknown'),'不能跳过发送意图或重写请求终态');
    if(change.phase==='issuing'){
      const scope=live(previous,old.intent),report=requestBudgetReport(records,{workspaceId:scope.workspaceId,rootSessionId:scope.rootSessionId,scopeId:scope.scopeId,policyRevision:old.intent.policyRevision},old.intent.binding.ownerInstanceId);
      check(!report.unknown&&!report.overrun,'已有未知或超额请求，不能进入新的发送意图');
    }
    if(change.phase==='reported')check(change.estimatedCostUsd===requestBudgetCost(old.intent.model,change.usage),'请求结算未使用原冻结价格');
  }
  const next=[...prior??[],structuredClone(change)],nextRecords=requestBudgetRecords(next),reserve=nextRecords.reduce((sum,r)=>sum+(r.change.phase==='reserved'?2:r.change.phase==='issuing'?1:0)*modelRequestBudgetLimits.terminalReserveBytes,0);
  check(Buffer.byteLength(JSON.stringify(next),'utf8')+reserve<=modelRequestBudgetLimits.storedBytes,'请求账本无法保留新阶段及后续结算空间');
  return {modelRequestBudgetChanges:next};
}
