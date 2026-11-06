/**
 * 作用定位：把所选任务的核实报告、当前会话状态与独立的新周期草稿连接起来。
 * 设计原因：历史选择不能替换真实开放周期；新请求必须基于新鲜报告，未知命令则始终使用旧冻结请求查询/重试。模型可选，权限固定只读，不读取聊天附件。
 */
import {useEffect,useMemo,useRef,useState} from 'react';
import type {ExecutionReport,RecoveryRequest,TaskNode} from '../../bridge/contracts/dispatch';
import type {ScopeGoalState} from './scope-state';
import {ExecutionRecoveryPool,type RecoveryDraft,type RecoveryTarget,type RecoverySource} from './recovery-state';
import {executionReportStale} from './execution-report-state';

const controllers=new ExecutionRecoveryPool();
export interface RecoveryModel {options:Omit<RecoveryRequest['options'],'permission'>;label:string}
/** 来源报告属于历史节点；开放周期和模型来自主会话，而不是历史筛选。 */
export interface ExecutionRecoveryContext {state:ScopeGoalState;model?:RecoveryModel;refresh:()=>void;showScope:(id:string)=>void}
export interface ExecutionRecoveryView {
  visible:boolean;record?:RecoveryDraft;observation:string;message:string;editable:boolean;canSubmit:boolean;pending:boolean;error:string;reason:string;modelLabel:string;
  edit:(fields:{observation:string;message:string})=>void;submit:()=>Promise<void>;query:()=>Promise<void>;retry:()=>Promise<void>;showCreated:()=>void;
}

/** 只为完整归属、已关闭来源及空闲会话生成新请求；未知日志允许核实，但不等于未执行。 */
export function recoveryTarget(workspaceId:string,rootSessionId:string,task:TaskNode,runId:string|undefined,report:ExecutionReport|undefined,stale:boolean,state:ScopeGoalState):{target?:RecoveryTarget;reason:string}{
  if(state.loading||state.error||!state.graph)return {reason:'任务与目标记录尚未同步，请稍后重新核实。'};
  if(task.identity.workspaceId!==workspaceId||task.identity.rootSessionId!==rootSessionId||state.graph.identity.workspaceId!==workspaceId||state.graph.identity.rootSessionId!==rootSessionId||!state.graph.tasks.some(item=>item.taskId===task.taskId&&item.revision===task.revision))return {reason:'所选任务身份已变化，请重新选择节点。'};
  const scope=state.scopes.find(item=>item.scopeId===task.scopeId);
  if(!task.scopeId||!scope)return {reason:'旧任务未保存完整周期归属，仅提供只读记录。'};
  if(scope.status!=='closed')return {reason:'来源任务的周期尚未关闭，请先处理当前目标。'};
  if(state.openScope||state.scopes.some(item=>item.status!=='closed'))return {reason:'当前会话仍有未结束目标，暂不能创建另一个核实周期。'};
  if(!report)return {reason:'请先核实当前执行记录。'};
  if(stale||executionReportStale(report,task,state.graph.cursor,scope))return {reason:'核实依据已变化，请重新核实后提交。'};
  if(report.identity.workspaceId!==workspaceId||report.identity.rootSessionId!==rootSessionId||report.identity.taskId!==task.taskId||report.identity.runId!==runId||report.basis.scopeId!==scope.scopeId||report.basis.scopeStatus!=='closed')return {reason:'报告不属于当前所选执行，请重新核实。'};
  if(task.activeRunId||report.execution==='in_flight')return {reason:'仍有在途执行记录，暂不能创建新核实周期。'};
  if(task.runIds.length?!runId||!task.runIds.includes(runId):runId!==undefined||report.execution!=='not_started'||report.log.state!=='not_expected')return {reason:'请明确选择要核实的执行轮次。'};
  return {target:{workspaceId,rootSessionId,source:{scopeId:scope.scopeId,taskId:task.taskId,...(runId?{runId}:{}),reportBasis:report.basis.key}},reason:''};
}

/** 同一个 root 共用本机请求索引；卸载只停止观察，不撤销提交或丢失迟到回执。 */
export function useExecutionRecovery(workspaceId:string,rootSessionId:string,task:TaskNode,runId:string|undefined,report:ExecutionReport|undefined,reportUnavailable:boolean,context?:ExecutionRecoveryContext):ExecutionRecoveryView{
  const key=JSON.stringify([workspaceId,rootSessionId]),keyRef=useRef(key);keyRef.current=key;
  const refreshRef=useRef(context?.refresh);refreshRef.current=context?.refresh;
  const controller=useMemo(()=>context?controllers.get(workspaceId,rootSessionId,{
    storage:{getItem:name=>window.localStorage.getItem(name),setItem:(name,value)=>window.localStorage.setItem(name,value)},
    submit:request=>window.cbim.call('loop.recoveryStart',request),lookup:request=>window.cbim.call('loop.recoveryReceipt',request),uuid:()=>crypto.randomUUID(),
  }):undefined,[workspaceId,rootSessionId,Boolean(context)]);
  const [,changed]=useState(0);
  useEffect(()=>{if(!controller)return;const unsubscribe=controller.subscribe(()=>changed(value=>value+1));void controller.restore().then(()=>{if(keyRef.current===key)refreshRef.current?.()});return unsubscribe},[controller,key]);
  const source:RecoverySource|undefined=task.scopeId?{scopeId:task.scopeId,taskId:task.taskId,...(runId?{runId}:{})}:undefined;
  const record=source?controller?.record(source):undefined,attempt=record?.attempt,pending=controller?.isPending(record)??false;
  const eligibility=context?recoveryTarget(workspaceId,rootSessionId,task,runId,report,reportUnavailable,context.state):{reason:'当前视图不支持创建核实周期。'};
  const editable=Boolean(eligibility.target&&controller?.available&&!pending&&(!attempt||attempt.phase==='rejected'));
  const after=async(work:()=>Promise<void>)=>{await work();if(keyRef.current===key)refreshRef.current?.()};
  return {
    visible:!!context&&Boolean(report||record||controller?.snapshot.error),record,observation:record?.observation??'',message:record?.message??'',editable,
    canSubmit:editable&&!!context?.model&&!!record?.observation.trim()&&!!record?.message.trim(),pending,error:controller?.snapshot.error??'',reason:eligibility.reason,
    modelLabel:attempt&&attempt.phase!=='rejected'?attempt.request.options.model+' · 只读访问（本次请求已固定）':context?.model?context.model.label+' · 本次核实仅只读':'请先在对话输入区选择可用模型',
    edit:fields=>{if(editable&&source)controller!.edit(source,fields)},
    submit:()=>after(async()=>{if(editable&&eligibility.target&&context?.model)await controller!.submit(eligibility.target,{...context.model.options,permission:'read'})}),
    query:()=>after(async()=>{if(record)await controller!.query(record.source)}),
    // 未知命令可以在图已改变后重试原请求；服务端先去重，不能用新请求准入条件隐藏其查询入口。
    retry:()=>after(async()=>{if(record&&attempt?.phase==='unknown')await controller!.retry(record.source)}),
    showCreated:()=>{const id=attempt?.receipt?.scopeId;if(id)context?.showScope(id)},
  };
}
