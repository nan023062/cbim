/**
 * 作用定位：在主会话层装配唯一补充控制器，向对话卡和任务根提供同一份草稿、提交锁及回执状态。
 * 设计原因：历史选择只切换只读视图；已发请求始终绑定原工作区/会话/等待身份，迟到结果不能写进新目标。挂载只查询本地未知命令，不自动续跑。
 */
import {useEffect,useMemo,useRef,useState} from 'react';
import type {GoalContinuationRequest} from '../../bridge/contracts/dispatch';
import type {ScopeGoalState} from './scope-state';
import {ScopeContinuationPool,type ContinuationDraft,type ContinuationTarget} from './continuation-state';

// 同 renderer 的工作区切换不能产生两个写同一本机索引的在途控制器；真正重开应用仍从磁盘读取。
const controllers=new ScopeContinuationPool();

/** 模型身份由主输入区解析为实际供应商配置，纯文本补充不读取或移除聊天附件。 */
export interface ContinuationModel {options:GoalContinuationRequest['options'];label:string}
export interface ScopeContinuationView {
  scopeId?:string;waitId?:string;text:string;record?:ContinuationDraft;
  editable:boolean;canSubmit:boolean;canRetry:boolean;pending:boolean;
  error:string;modelLabel:string;
  edit:(text:string)=>void;submit:()=>Promise<void>;query:()=>Promise<void>;retry:()=>Promise<void>;
}
/** 仅当前 waiting 且详情已与摘要核对时产生写入目标，模型等待申请和历史选择均不能构造恢复身份。 */
export function continuationTarget(workspaceId:string,rootSessionId:string|undefined,state:ScopeGoalState):ContinuationTarget|undefined{
  const scope=state.selectedScope,waiting=state.waitingScope;
  if(!rootSessionId||state.loading||state.detailLoading||state.error||!waiting||waiting.status!=='waiting'||waiting.scopeId!==state.selectedScopeId||scope?.scopeId!==waiting.scopeId||scope.status!=='waiting'||!scope.goal||!scope.wait||scope.wait.waitId!==waiting.wait?.waitId||scope.goal.revision!==waiting.goalRevision||scope.goal.revision!==scope.wait.goalRevision||(scope.goal.inputRevision??1)!==(waiting.inputRevision??1))return;
  if(scope.workspaceId!==workspaceId||scope.rootSessionId!==rootSessionId)return;
  return {workspaceId,rootSessionId,scopeId:scope.scopeId,waitId:scope.wait.waitId,expectedGoalRevision:scope.goal.revision,expectedInputRevision:scope.goal.inputRevision??1};
}

export function useScopeContinuation(workspaceId:string,rootSessionId:string|undefined,state:ScopeGoalState,model:ContinuationModel|undefined,refresh:()=>void):ScopeContinuationView{
  const key=JSON.stringify([workspaceId,rootSessionId]),keyRef=useRef(key);keyRef.current=key;
  const refreshRef=useRef(refresh);refreshRef.current=refresh;
  const controller=useMemo(()=>rootSessionId?controllers.get(workspaceId,rootSessionId,{
    storage:{getItem:name=>window.localStorage.getItem(name),setItem:(name,value)=>window.localStorage.setItem(name,value)},
    submit:request=>window.cbim.call('loop.goalContinue',request),lookup:request=>window.cbim.call('loop.goalContinuation',request),uuid:()=>crypto.randomUUID(),
  }):undefined,[workspaceId,rootSessionId]);
  const [,changed]=useState(0);
  useEffect(()=>{
    if(!controller)return;
    const unsubscribe=controller.subscribe(()=>changed(value=>value+1));
    void controller.restore().then(()=>{if(keyRef.current===key)refreshRef.current()});
    return unsubscribe;
  },[controller,key]);
  const target=continuationTarget(workspaceId,rootSessionId,state),records=controller?.snapshot.records??[];
  const record=target?controller?.record(target.scopeId,target.waitId):[...records].reverse().find(item=>item.scopeId===state.selectedScopeId);
  const pending=controller?.isPending(record)??false,attempt=record?.attempt,error=controller?.snapshot.error??'';
  const editable=!!target&&!!controller?.available&&!pending&&(!attempt||attempt.phase==='rejected');
  const refreshAfter=async(work:()=>Promise<void>)=>{await work();if(keyRef.current===key)refreshRef.current()};
  return {
    scopeId:target?.scopeId??record?.scopeId,waitId:target?.waitId??record?.waitId,text:record?.text??'',record,
    editable,canSubmit:editable&&!!model&&!!record?.text.trim(),canRetry:!!target&&!pending&&attempt?.phase==='unknown',pending,error,
    modelLabel:attempt&&attempt.phase!=='rejected'?`${attempt.request.options.model} · ${{read:'只读访问',ask:'默认权限',execute:'完全访问'}[attempt.request.options.permission]}（本次提交已固定）`:model?.label??'请先选择可用模型',
    edit:text=>{if(editable&&target)controller!.edit(target,text)},
    submit:()=>refreshAfter(async()=>{if(editable&&target&&model)await controller!.submit(target,model.options)}),
    query:()=>refreshAfter(async()=>{if(record)await controller!.query(record.scopeId,record.waitId)}),
    retry:()=>refreshAfter(async()=>{if(target&&attempt?.phase==='unknown')await controller!.retry(target.scopeId,target.waitId)}),
  };
}
