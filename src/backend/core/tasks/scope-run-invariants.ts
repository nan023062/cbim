/**
 * 作用定位：在派发事务提交和重放时核验周期主运行清单的完整归属及追加边界。
 * 设计原因：登记不能依赖当前进程集合；文本补充和人工接续共用旧等待前缀与主轮计数，防止重复归属、补造旧统计或丢失无日志意图。
 */
import {fail} from '../foundation/errors';
import type {DispatchState,DispatchMutation} from '../dispatch/dispatch-storage';
import type {DispatchScope} from './dispatch-scope';
import {scopeRunTrackingSchema} from './scope-run-tracking';
import {scopeFreshContext} from './fresh-context';

const equal=(left:unknown,right:unknown):boolean=>{
  const normalize=(value:unknown):unknown=>Array.isArray(value)?value.map(normalize):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,normalize(v)])):value;
  return JSON.stringify(normalize(left))===JSON.stringify(normalize(right));
};
function valid(value:unknown,message:string):asserts value{if(!value)fail('GRAPH_INPUT_INVALID',message)}
/** 旧意图仍能证明部分运行身份，但不用于补造 legacy 周期的完整清单。 */
function recordedRuns(scope:DispatchScope):string[]{const context=scopeFreshContext(scope);return [...(scope.runTracking?.mainRunIds??[]),...(context?[context.initialRunId]:[]),...(scope.wait?.mainRunIds??[]),...(scope.continuations??[]).flatMap(item=>[item.runId,...item.wait.mainRunIds])];}

/** 只验证事实；不会读取 canonical 日志、计算用量或赋予执行权限。 */
export function validateScopeRunTracking(previous:DispatchState,next:DispatchState,mutation:DispatchMutation):void {
  const scopes=next.scopes??[],owners=new Map<string,Set<string>>();
  for(const scope of scopes){
    if(scope.runTracking!==undefined)valid(scopeRunTrackingSchema.safeParse(scope.runTracking).success,'周期主运行归属清单无效');
    for(const id of recordedRuns(scope)){const values=owners.get(id)??new Set<string>();values.add(scope.scopeId);owners.set(id,values)}
  }
  const memberIds=new Set((next.runs??[]).map(run=>run.binding.runId));
  const previouslyExcluded=new Set((previous.scopes??[]).flatMap(scope=>scopeFreshContext(scope)?.excludedRunIds??[]));
  for(const scope of scopes){
    const old=previous.scopes?.find(item=>item.scopeId===scope.scopeId),tracking=scope.runTracking;
    if(old)valid((old.runTracking===undefined)===(tracking===undefined),'已有周期不能补造或移除主运行归属清单');
    if(!tracking)continue;
    valid(scopeRunTrackingSchema.safeParse(tracking).success,'周期主运行归属清单无效');
    const ids=tracking.mainRunIds;
    for(const id of ids)valid(owners.get(id)?.size===1&&!memberIds.has(id),'主运行不能跨周期归属或借用成员运行身份');
    for(const id of ids.slice(old?.runTracking?.mainRunIds.length??0))valid(!previouslyExcluded.has(id),'新登记主运行不能重用已经隔离的历史运行');
    if(!old)valid(ids.length===1,'新周期必须原子登记且只登记首个主运行');
    else{
      const before=old.runTracking!.mainRunIds;
      valid(ids.length>=before.length&&ids.length<=before.length+1&&before.every((id,index)=>ids[index]===id),'主运行归属只能原样保留或有序追加一轮');
      if(ids.length>before.length){
        const history=scope.continuations??[],prior=old.continuations??[],supplement=history.length===prior.length+1;
        valid(scope.status==='active'&&(old.status==='active'||old.status==='waiting'&&supplement),'等待或封存周期不能登记新运行');
        valid(mutation.scopes?.length===1&&!mutation.batch&&!mutation.runs?.length&&!mutation.members?.length&&!mutation.sessions?.length&&!mutation.messages?.length,'主运行登记只能更新所属周期，不能顺带更改任务或成员');
        // 启用预算时准入证明必须与真实运行一起追加；策略和证明的边界由预算不变量独立核实。
        if(!supplement)valid(equal({...old,runTracking:tracking,budget:scope.budget},scope),'主运行追加不能顺带修改目标或周期状态');
      }
    }
    const fresh=scopeFreshContext(scope);
    if(fresh){valid(ids[0]===fresh.initialRunId,'新上下文的首个运行必须匹配周期登记');valid(ids.every(id=>!fresh.excludedRunIds.includes(id)),'周期登记不能包含已隔离的旧运行')}
    for(const item of scope.continuations??[]){
      valid(equal(ids.slice(0,item.wait.mainRunIds.length),item.wait.mainRunIds)&&ids[item.wait.mainRunIds.length]===item.runId,'补充必须紧接完整等待前缀登记新运行');
    }
    if(scope.wait)valid(equal(ids,scope.wait.mainRunIds),'等待检查点必须保留周期完整主运行清单');
    if(scope.goal?.plan)valid(ids.includes(scope.goal.plan.runId),'周期计划必须来自已登记主运行');
    if(scope.goal?.review)valid(ids.includes(scope.goal.review.runId),'周期审阅必须来自已登记主运行');
    for(const task of next.graphs.flatMap(graph=>graph.tasks).filter(task=>task.scopeId===scope.scopeId))if(task.cancelledBeforeStart)valid(ids.includes(task.cancelledBeforeStart.mainRunId),'未启动撤销必须来自本周期已登记主运行');
  }
}
