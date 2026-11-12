/**
 * 目录归属：backend/core/budget；请求与周期预算规则。
 * 作用定位：在派发事务提交与重放时保护冻结额度、真实运行准入证明和不可改写的预算拒绝事实。
 * 设计原因：单独保存“允许”会被后续运行误用；证明必须和唯一新增主运行或成员领取一起提交，拒绝只能记录原因，不能消费等待或改变目标。
 * 职责边界：这里核对已有证明及跨对象关系，不重新读取日志或判断模型账单；可信观察由调度层在同一事务内取得。
 */
import {fail} from '../foundation/errors';
import type {DispatchMutation,DispatchState} from '../dispatch/dispatch-storage';
import type {DispatchScope} from '../tasks/dispatch-scope';
import {evaluateScopeBudget,scopeBudgetSchema,type ScopeBudgetObservation} from './scope-budget';

const normalize=(value:unknown):unknown=>Array.isArray(value)?value.map(normalize):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,normalize(v)])):value;
const equal=(left:unknown,right:unknown)=>JSON.stringify(normalize(left))===JSON.stringify(normalize(right));
function valid(value:unknown,message:string):asserts value {if(!value)fail('GRAPH_INPUT_INVALID',message)}
function memberRuns(state:DispatchState,scope:DispatchScope){
  const ids=new Set(state.graphs.find(graph=>graph.identity.rootSessionId===scope.rootSessionId)?.tasks.filter(task=>task.scopeId===scope.scopeId).map(task=>task.taskId)??[]);
  return (state.runs??[]).filter(run=>run.binding.workspaceId===scope.workspaceId&&run.binding.rootSessionId===scope.rootSessionId&&ids.has(run.binding.taskId));
}
/** 清单包含已登记而日志尚未产生的意图；不能只数成功读取的运行。 */
function sources(state:DispatchState,scope:DispatchScope|undefined):string[]{return scope?[...(scope.runTracking?.mainRunIds??[]),...memberRuns(state,scope).map(run=>run.binding.runId)]:[]}
function observation(value:ScopeBudgetObservation,ids:string[]){
  valid(value.registeredRuns===ids.length&&new Set(ids).size===ids.length,'预算观察必须覆盖全部既有运行归属');
  valid([...value.liveRunIds,...value.unknownRunIds].every(id=>ids.includes(id)),'预算观察不能引用其他周期或未登记运行');
}

/** 保留旧缺省；新周期策略创建后冻结，等待只允许独立记录拒绝，关闭记录永久不变。 */
export function validateScopeBudgets(previous:DispatchState,next:DispatchState,mutation:DispatchMutation):void {
  for(const scope of next.scopes??[]){
    const old=previous.scopes?.find(value=>value.scopeId===scope.scopeId),budget=scope.budget;
    if(old)valid((old.budget===undefined)===(budget===undefined),'旧周期不能补造或移除预算策略');
    if(!budget)continue;
    valid(scopeBudgetSchema.safeParse(budget).success,'周期预算结构无效');
    if(old)valid(equal(old.budget!.policy,budget.policy),'周期额度策略创建后不能修改');
    if(!budget.policy.enabled){valid(!budget.lastAdmission&&!budget.blocked,'关闭的额度不能包含准入或拒绝证明');continue}
    valid(scope.runTracking,'启用额度必须有自创建起完整登记的主运行清单');
    const before=sources(previous,old),after=sources(next,scope),newIds=after.filter(id=>!before.includes(id));
    valid(newIds.length<=1,'预算周期每次事务只能受理一个新运行');
    if(old?.budget?.blocked)valid(equal(old.budget.blocked,budget.blocked)&&!newIds.length,'预算拒绝不可改写、删除或继续启动');
    const admissionChanged=!equal(old?.budget?.lastAdmission,budget.lastAdmission);
    if(newIds.length){
      valid(!budget.blocked&&scope.status==='active'&&admissionChanged&&budget.lastAdmission,'新运行必须原子提交新的预算准入证明');
      valid(mutation.scopes?.some(value=>value.scopeId===scope.scopeId&&equal(value.budget,budget)),'预算证明不能脱离实际周期提交');
      const proof=budget.lastAdmission,runId=newIds[0],main=scope.runTracking.mainRunIds.includes(runId),run=memberRuns(next,scope).find(value=>value.binding.runId===runId);
      valid(proof.runId===runId&&proof.policyRevision===budget.policy.revision&&proof.kind===(main?'main':'member')&&proof.taskId===(main?scope.rootSessionId:run?.binding.taskId),'预算证明必须绑定本次真实主运行或成员任务');
      observation(proof.observation,before);
      valid(evaluateScopeBudget(budget.policy,proof.observation).kind==='allow','准入证明没有通过冻结额度检查');
      valid(!old||!memberRuns(previous,old).some(run=>run.status==='starting'||run.status==='running'),'预算周期必须等待已受理成员结算后再启动');
      if(!main)valid(old&&equal({...old,budget},scope)&&run?.status==='starting','成员准入不能顺带修改周期状态或目标');
    }else valid(!admissionChanged,'预算准入证明只能随真实新运行更换');
    if(budget.blocked&&!old?.budget?.blocked){
      valid(old&&scope.status!=='closed'&&!newIds.length&&equal({...old,budget},scope),'预算拒绝只能给未关闭周期独立追加原因');
      valid(mutation.scopes?.length===1&&!mutation.batch&&!mutation.runs?.length&&!mutation.members?.length&&!mutation.sessions?.length&&!mutation.messages?.length,'预算拒绝不能消费等待、运行或成员状态');
      valid(budget.blocked.policyRevision===budget.policy.revision,'预算拒绝必须引用冻结策略');
      observation(budget.blocked.observation,before);
      const result=evaluateScopeBudget(budget.policy,budget.blocked.observation);
      valid(result.kind==='deny'&&result.reason===budget.blocked.reason,'预算拒绝原因与已核实观察不一致');
      valid(!memberRuns(previous,old).some(run=>run.status==='starting'||run.status==='running'),'已受理成员尚未结算时只能等待，不能关闭预算周期');
    }
  }
}
