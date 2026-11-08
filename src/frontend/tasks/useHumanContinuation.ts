/**
 * 作用定位：在主会话装配按人工决定继续的唯一控制器，向两个目标卡提供固定选择和提交状态。
 * 设计原因：只有与摘要同步的当前等待可启动；每项取跨依据的最新意见，不能挑旧接受跳过新拒绝。历史与普通补充始终独立。
 * 展示边界：新等待尚无意见时不回退到上次已受理接续；旧请求仍保存在控制器中供原命令查询。
 */
import {useEffect,useMemo,useRef,useState} from 'react';
import type {HumanDecisionRecord} from '../../bridge/contracts/human-decisions';
import type {ScopeGoalState} from './scope-state';
import {continuationTarget,continuationModel,type ContinuationModel} from './useScopeContinuation';
import {HumanContinuationPool,type HumanContinuationTarget,type HumanContinuationDraft} from './human-continuation-state';

const controllers=new HumanContinuationPool();
/** 先按验收项取最后记录，再限定真实等待；较新的拒绝不能被另一个 basis 的旧接受绕过。 */
export function currentHumanDecisions(state:ScopeGoalState):HumanDecisionRecord[]{
  const scope=state.selectedScope;if(!scope?.wait)return [];
  const latest=new Map<string,HumanDecisionRecord>();for(const record of scope.humanDecisions?.records??[])latest.set(record.criterionId,record);
  return [...latest.values()].filter(record=>record.proof.source.waitId===scope.wait!.waitId&&scope.goal?.plan?.criteria.some(criterion=>criterion.kind==='human'&&criterion.id===record.criterionId)).sort((a,b)=>a.criterionId.localeCompare(b.criterionId));
}
/** 只构造已同步的写入身份；没有真实决定、版本未追齐或历史选择时不能启动。 */
export function humanContinuationTarget(workspaceId:string,rootSessionId:string|undefined,state:ScopeGoalState):HumanContinuationTarget|undefined{
  const base=continuationTarget(workspaceId,rootSessionId,state),scope=state.selectedScope,revision=scope?.humanDecisions?.revision,records=currentHumanDecisions(state);
  if(!base||!revision||state.waitingScope?.humanDecisions?.revision!==revision||scope?.goal?.review?.decision!=='awaiting_user'||!records.length)return;
  return {...base,expectedDecisionRevision:revision,decisionIds:records.map(record=>record.decisionId)};
}
/** 当前等待只展示同 wait 的意图；没有当前意见不等于可以拿上一等待的已受理卡填充。 */
export function humanContinuationDraftForView(state:ScopeGoalState,records:readonly HumanContinuationDraft[],target?:HumanContinuationTarget):HumanContinuationDraft|undefined{
  if(target)return records.find(item=>item.scopeId===target.scopeId&&item.waitId===target.waitId);
  if(state.loading||state.detailLoading)return;
  const scope=state.selectedScope;
  if(scope?.status==='waiting')return scope.scopeId===state.selectedScopeId&&scope.wait?records.find(item=>item.scopeId===scope.scopeId&&item.waitId===scope.wait!.waitId):undefined;
  return [...records].reverse().find(item=>item.scopeId===state.selectedScopeId);
}
export interface HumanContinuationView {
  scopeId?:string;waitId?:string;record?:HumanContinuationDraft;decisions:HumanDecisionRecord[];
  eligible:boolean;pending:boolean;canSubmit:boolean;canRetry:boolean;error:string;modelLabel:string;
  submit:()=>Promise<void>;query:()=>Promise<void>;retry:()=>Promise<void>;
}
/** 使用输入区当前真实模型；只读核实周期仍强制 read，未知/已受理请求保持旧配置。 */
export function useHumanContinuation(workspaceId:string,rootSessionId:string|undefined,state:ScopeGoalState,model:ContinuationModel|undefined,refresh:()=>void):HumanContinuationView{
  const [,render]=useState(0),identity=JSON.stringify([workspaceId,rootSessionId]),identityRef=useRef(identity),refreshRef=useRef(refresh);identityRef.current=identity;refreshRef.current=refresh;
  const controller=useMemo(()=>rootSessionId?controllers.get(workspaceId,rootSessionId,{storage:{getItem:key=>window.localStorage.getItem(key),setItem:(key,value)=>window.localStorage.setItem(key,value)},submit:input=>window.cbim.call('loop.humanContinue',input),lookup:input=>window.cbim.call('loop.humanContinuation',input),uuid:()=>crypto.randomUUID()}):undefined,[workspaceId,rootSessionId]);
  useEffect(()=>{if(!controller)return;const unsubscribe=controller.subscribe(()=>render(value=>value+1));void controller.restore().then(()=>{if(identityRef.current===identity)refreshRef.current()});return unsubscribe},[controller,identity]);
  const target=humanContinuationTarget(workspaceId,rootSessionId,state),records=controller?.snapshot.records??[],record=humanContinuationDraftForView(state,records,target),attempt=record?.attempt,pending=controller?.isPending(record)??false,effectiveModel=continuationModel(model,state);
  const editable=!!target&&!!controller?.available&&!pending&&(!attempt||attempt.phase==='rejected'),frozen=attempt&&attempt.phase!=='rejected';
  const decisions=frozen?(state.selectedScope?.humanDecisions?.records??[]).filter(value=>attempt.request.decisionIds.includes(value.decisionId)):currentHumanDecisions(state);
  const after=async(action:()=>Promise<void>)=>{await action();if(identityRef.current===identity)refreshRef.current()};
  return {scopeId:target?.scopeId??record?.scopeId,waitId:target?.waitId??record?.waitId,record,decisions,eligible:!!target,pending,canSubmit:editable&&!!effectiveModel,canRetry:!!target&&!!controller?.available&&!pending&&attempt?.phase==='unknown',error:controller?.snapshot.error??'',
    modelLabel:frozen?`${attempt.request.options.model} · ${{read:'只读访问',ask:'默认权限',execute:'完全访问'}[attempt.request.options.permission]}（本次接续已固定）`:effectiveModel?.label??'请先选择可用模型',
    submit:async()=>{if(target&&controller&&editable&&effectiveModel)await after(()=>controller.submit(target,effectiveModel.options))},
    query:async()=>{if(record&&controller)await after(()=>controller.query(record.scopeId,record.waitId))},retry:async()=>{if(target&&record&&controller)await after(()=>controller.retry(record.scopeId,record.waitId))},
  };
}
