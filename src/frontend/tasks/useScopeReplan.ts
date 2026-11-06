/**
 * 作用定位：在主会话装配独立业务重规划控制器，把同一草稿与核验结果交给对话目标卡和任务根。
 * 设计原因：入口只接受本会话最后提交且已完成的核实周期，准入同时取整个 root 的真实开放状态；旧证据不能跨后续业务周期沿用，新业务权限独立选择。
 */
import {useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import type {ReplanRequest} from '../../bridge/contracts/dispatch';
import type {ScopeGoalState} from './scope-state';
import {ScopeReplanPool,type ReplanDraft,type ReplanPreviewState,type ReplanTarget} from './replan-state';

const controllers=new ScopeReplanPool();
/** 只共享主输入区解析后的实际模型身份，不共享其 permission，也不读取附件或聊天草稿。 */
export interface ReplanModel {options:Omit<ReplanRequest['options'],'permission'>;label:string}
export interface ScopeReplanView {
  visible:boolean;inspectionScopeId?:string;record?:ReplanDraft;message:string;permission:'ask'|'execute';
  previewState?:ReplanPreviewState;editable:boolean;canPreview:boolean;canSubmit:boolean;pending:boolean;
  error:string;reason:string;modelLabel:string;
  edit:(message:string,permission:'ask'|'execute')=>void;
  preview:()=>Promise<void>;submit:()=>Promise<void>;query:()=>Promise<void>;retry:()=>Promise<void>;showCreated:()=>void;
}

/** 原生隔离/日志核验仍由后端负责；前端仅为明确已完成的 inspection 来源构造可读身份。 */
export function replanTarget(workspaceId:string,rootSessionId:string|undefined,state:ScopeGoalState,modelKey=''):{target?:ReplanTarget;reason:string}{
  if(!rootSessionId||state.loading||state.detailLoading||state.error||!state.graph)return {reason:'目标与任务图尚未同步，请稍后核验。'};
  const summary=state.scopes.find(item=>item.scopeId===state.selectedScopeId),scope=state.selectedScope;
  if(!summary||summary.origin!=='inspection'||!summary.readOnly||summary.status!=='closed'||summary.outcome!=='completed')return {reason:'仅从已完成的只读核实周期创建新业务任务。'};
  if(scope?.scopeId!==summary.scopeId||scope.workspaceId!==workspaceId||scope.rootSessionId!==rootSessionId||state.graph.identity.workspaceId!==workspaceId||state.graph.identity.rootSessionId!==rootSessionId)return {reason:'所选周期或任务图身份不一致，请重新同步。'};
  if(scope.status!=='closed'||scope.outcome!=='completed'||!scope.goal?.plan||scope.goal.review?.decision!=='complete'||summary.reviewDecision!=='complete'||scope.goal.review.planRevision!==scope.goal.plan.revision||scope.goal.review.revision!==scope.goal.revision||scope.goal.revision!==summary.goalRevision||(scope.goal.inputRevision??1)!==(summary.inputRevision??1)||!summary.hasGoal||!summary.hasPlan||summary.needsReplan)return {reason:'所选周期的完整计划与完成记录尚未核对，请重新同步。'};
  if(state.openScope||state.scopes.some(item=>item.status!=='closed'))return {reason:'当前会话还有未结束目标，暂不能创建新业务周期。'};
  // 后端摘要保留首次提交顺序；不能按本机时间排序，也不能在后续业务改动后沿用旧核实证据。
  if(state.scopes.at(-1)?.scopeId!==scope.scopeId)return {reason:'该核实周期之后已有新任务，请先完成新的只读核实，再创建业务任务。'};
  const graphCursor={streamId:state.graph.cursor.streamId,seq:state.graph.cursor.seq};
  return {target:{workspaceId,rootSessionId,inspectionScopeId:scope.scopeId,graphCursor,inspectionGoalRevision:scope.goal.revision,anchor:JSON.stringify([summary.stamp,graphCursor,modelKey])},reason:''};
}

/** 两处面板只消费本 Hook，不独立调用预览或生成命令；切换来源仅影响观察对象。 */
export function useScopeReplan(workspaceId:string,rootSessionId:string|undefined,state:ScopeGoalState,model:ReplanModel|undefined,refresh:()=>void,showScope:(scopeId:string)=>void):ScopeReplanView{
  const rootKey=JSON.stringify([workspaceId,rootSessionId]),rootRef=useRef(rootKey);rootRef.current=rootKey;
  const refreshRef=useRef(refresh);refreshRef.current=refresh;
  const controller=useMemo(()=>rootSessionId?controllers.get(workspaceId,rootSessionId,{
    storage:{getItem:name=>window.localStorage.getItem(name),setItem:(name,value)=>window.localStorage.setItem(name,value)},
    preview:input=>window.cbim.call('dispatch.replans.preview',input),submit:request=>window.cbim.call('loop.replanStart',request),lookup:input=>window.cbim.call('loop.replanReceipt',input),uuid:()=>crypto.randomUUID(),
  }):undefined,[workspaceId,rootSessionId]);
  const [,changed]=useState(0);
  useEffect(()=>{if(!controller)return;const unsubscribe=controller.subscribe(()=>changed(value=>value+1));void controller.restore().then(()=>{if(rootRef.current===rootKey)refreshRef.current()});return()=>{unsubscribe();controller.observeTarget(undefined)}},[controller,rootKey]);
  const eligibility=replanTarget(workspaceId,rootSessionId,state,JSON.stringify(model?.options)),target=eligibility.target;
  // 布局提交时先作废旧来源/版本；即使请求在切换窗口后返回，也不能启用另一来源的提交按钮。
  useLayoutEffect(()=>controller?.observeTarget(target),[controller,target?.anchor,target?.inspectionScopeId]);
  const source=state.selectedScopeId,record=source?controller?.record(source):undefined,attempt=record?.attempt;
  const pending=controller?.isPending(record)??false,editable=!!target&&!!controller?.available&&!pending&&(!attempt||attempt.phase==='rejected');
  const summary=state.scopes.find(item=>item.scopeId===source),observedPreview=controller?.snapshot.preview,previewState=observedPreview?.target.inspectionScopeId===source?observedPreview:undefined;
  const fresh=controller?.ready(target),modelLabel=attempt&&attempt.phase!=='rejected'?attempt.request.options.model+' · '+(attempt.request.options.permission==='ask'?'默认权限':'完全访问')+'（本次请求已固定）':model?.label??'请先在对话输入区选择可用模型';
  const after=async(work:()=>Promise<void>)=>{await work();if(rootRef.current===rootKey)refreshRef.current()};
  return {
    visible:Boolean(record||summary?.origin==='inspection'&&summary.status==='closed'&&summary.outcome==='completed'),inspectionScopeId:source,record,message:record?.message??'',permission:record?.permission??'ask',previewState,editable,
    canPreview:editable&&!previewState?.loading,canSubmit:editable&&!!record?.message.trim()&&!!model&&!!fresh,pending,error:controller?.snapshot.error??'',reason:eligibility.reason,modelLabel,
    edit:(message,permission)=>{if(editable&&source)controller!.edit(source,message,permission)},
    preview:()=>after(async()=>{if(editable&&target)await controller!.preview(target)}),
    submit:()=>after(async()=>{if(editable&&target&&model)await controller!.submit(target,model.options)}),
    query:()=>after(async()=>{if(record)await controller!.query(record.inspectionScopeId)}),
    // 已冻结命令先由后端去重；当前已有周期或预览过期不能隐藏它的查询/原请求重试入口。
    retry:()=>after(async()=>{if(record&&attempt?.phase==='unknown')await controller!.retry(record.inspectionScopeId)}),
    showCreated:()=>{if(attempt?.receipt)showScope(attempt.receipt.scopeId)},
  };
}
