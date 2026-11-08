/**
 * 完整清单与旧文件选择在同一候选互斥，选择不调用后端；两处卡片继续共享同一草稿及冻结请求。
 * 作用定位：为当前主会话装配唯一人工决定控制器，将同一草稿和冻结请求传给对话及任务根。
 * 设计原因：只依据已同步的 waiting 详情开放提交，历史可查看而不能冒充当前目标；文件核实及返工后的清除旧选择均由明确点击触发，不追加轮询或自动批准。
 */
import {useEffect,useMemo,useRef,useState} from 'react';
import type {HumanDecisionBaselineSelection,HumanDecisionManifestSelection,HumanDecisionKind,HumanDecisionRecord} from '../../bridge/contracts/human-decisions';
import type {ScopeGoalState} from './scope-state';
import {HumanDecisionPool,type HumanDecisionTarget,type HumanDecisionDraft,type HumanDecisionPreviewState} from './human-decision-state';

const controllers=new HumanDecisionPool();
export interface HumanDecisionsView {
  scopeId?:string;criterionId:string;criteria:Array<{id:string;text:string}>;
  record?:HumanDecisionDraft;history:HumanDecisionRecord[];preview?:HumanDecisionPreviewState;
  eligible:boolean;editable:boolean;pending:boolean;previewCurrent:boolean;canSubmit:boolean;canRetry:boolean;error:string;
  select:(criterionId:string)=>void;chooseBaseline:(taskId:string,runId:string,baselineId:string)=>void;
  chooseManifest:(taskId:string,runId:string,manifestId:string)=>void;
  chooseDecision:(decision:HumanDecisionKind)=>void;comment:(text:string)=>void;
  inspect:()=>Promise<void>;clearBaselines:()=>Promise<void>;submit:()=>Promise<void>;query:()=>Promise<void>;retry:()=>Promise<void>;
}
/** 详情和摘要都必须属于当前 waiting，目标或独立决定增量变化会使旧预览失效。 */
export function humanDecisionTarget(workspaceId:string,rootSessionId:string|undefined,state:ScopeGoalState,criterionId:string):HumanDecisionTarget|undefined{
  const scope=state.selectedScope,summary=state.waitingScope;
  if(!rootSessionId||!criterionId||state.loading||state.detailLoading||state.error||!scope||scope.status!=='waiting'||!scope.wait||!scope.goal?.plan||scope.goal.review?.decision!=='awaiting_user'||summary?.scopeId!==scope.scopeId||summary.scopeId!==state.selectedScopeId||summary.wait?.waitId!==scope.wait.waitId||summary.goalRevision!==scope.goal.revision||scope.goal.revision!==scope.wait.goalRevision||(summary.humanDecisions?.revision??0)!==(scope.humanDecisions?.revision??0)||scope.workspaceId!==workspaceId||scope.rootSessionId!==rootSessionId||!scope.goal.plan.criteria.some(value=>value.id===criterionId&&value.kind==='human'))return;
  return {workspaceId,rootSessionId,scopeId:scope.scopeId,criterionId,anchor:JSON.stringify([summary.stamp,scope.wait.waitId,scope.goal.revision,scope.humanDecisions?.revision??0])};
}
export function useHumanDecisions(workspaceId:string,rootSessionId:string|undefined,state:ScopeGoalState,refresh:()=>void):HumanDecisionsView{
  const [selection,select]=useState(''),[,render]=useState(0),refreshRef=useRef(refresh);refreshRef.current=refresh;
  const identity=JSON.stringify([workspaceId,rootSessionId]),identityRef=useRef(identity);identityRef.current=identity;
  const controller=useMemo(()=>rootSessionId?controllers.get(workspaceId,rootSessionId,{
    storage:{getItem:key=>window.localStorage.getItem(key),setItem:(key,value)=>window.localStorage.setItem(key,value)},uuid:()=>crypto.randomUUID(),
    preview:input=>window.cbim.call('dispatch.humanPreview',input),submit:input=>window.cbim.call('dispatch.humanDecide',input),lookup:input=>window.cbim.call('dispatch.humanReceipt',input),
  }):undefined,[workspaceId,rootSessionId]);
  useEffect(()=>{if(!controller)return;const unsubscribe=controller.subscribe(()=>render(value=>value+1));void controller.restore().then(()=>{if(identityRef.current===identity)refreshRef.current()});return unsubscribe},[controller,identity]);
  const scope=state.selectedScope,criteria=(scope?.goal?.plan?.criteria??[]).filter(value=>value.kind==='human'),criterionId=criteria.some(value=>value.id===selection)?selection:criteria[0]?.id??'';
  const target=humanDecisionTarget(workspaceId,rootSessionId,state,criterionId),record=scope&&controller?.record(scope.scopeId,criterionId),pending=controller?.isPending(record)??false;
  const preview=target?controller?.previewState(target):undefined,current=target?controller?.currentPreview(target):undefined;
  const editable=!!target&&!!controller?.available&&!controller.locked(record);
  const after=async(action:()=>Promise<void>)=>{await action();if(identityRef.current===identity)refreshRef.current()};
  const edit=(change:Partial<Pick<HumanDecisionDraft,'baselines'|'manifests'|'decision'|'comment'>>)=>{if(target&&editable)controller?.edit(target,change)};
  return {scopeId:scope?.scopeId,criterionId,criteria,record,preview,history:scope?.humanDecisions?.records??[],eligible:!!target,editable,pending,previewCurrent:!!current,
    canSubmit:editable&&record?.attempt?.phase!=='accepted'&&!!record?.decision&&!!current?.basis&&current.allowedDecisions.includes(record.decision)&&(record.decision==='accept'||!!record.comment.trim()),
    canRetry:!!controller?.available&&!pending&&record?.attempt?.phase==='unknown',error:controller?.snapshot.error??'',select,
    chooseBaseline:(taskId,runId,baselineId)=>{const baselines:HumanDecisionBaselineSelection[]=(record?.baselines??[]).filter(value=>value.taskId!==taskId);if(baselineId)baselines.push({taskId,runId,baselineId});edit({baselines,...(record?.manifests?{manifests:record.manifests.filter(value=>value.taskId!==taskId)}:{})})},
    chooseManifest:(taskId,runId,manifestId)=>{const manifests:HumanDecisionManifestSelection[]=(record?.manifests??[]).filter(value=>value.taskId!==taskId);if(manifestId)manifests.push({taskId,runId,manifestId});edit({manifests,baselines:(record?.baselines??[]).filter(value=>value.taskId!==taskId)})},
    chooseDecision:decision=>edit({decision}),comment:text=>edit({comment:text}),
    inspect:async()=>{if(target)await controller?.preview(target)},clearBaselines:async()=>{if(target&&editable&&controller?.resetBaselines(target))await controller.preview(target)},submit:async()=>{if(target&&controller)await after(()=>controller.submit(target))},
    query:async()=>{if(scope&&controller)await after(()=>controller.query(scope.scopeId,criterionId))},retry:async()=>{if(scope&&controller)await after(()=>controller.retry(scope.scopeId,criterionId))},
  };
}
