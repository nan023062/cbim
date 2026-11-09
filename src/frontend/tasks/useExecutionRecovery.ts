/**
 * 作用定位：把所选任务的核实报告、当前会话状态与独立的新周期草稿连接起来。
 * 设计原因：历史选择不能替换真实开放周期；再次核实先归档已关闭回执，再使该来源所有视图的报告失效。新请求必须明确重读报告，未知命令只查询/重试原请求，不读取聊天附件。
 */
import {useEffect,useMemo,useRef,useState} from 'react';
import type {ExecutionReport,RecoveryRequest,TaskNode} from '../../bridge/contracts/dispatch';
import type {ScopeGoalState} from './scope-state';
import {ExecutionRecoveryPool,recoverySourceKey,type RecoveryDraft,type RecoveryTarget,type RecoverySource} from './recovery-state';
import {executionReportStale} from './execution-report-state';

const controllers=new ExecutionRecoveryPool();
export interface RecoveryModel {options:Omit<RecoveryRequest['options'],'permission'>;label:string}
/** 来源报告属于历史节点；开放周期和模型来自主会话，而不是历史筛选。 */
export interface ExecutionRecoveryContext {state:ScopeGoalState;model?:RecoveryModel;refresh:()=>void;showScope:(id:string)=>void}
export interface ExecutionRecoveryView {
  visible:boolean;record?:RecoveryDraft;observation:string;message:string;editable:boolean;canSubmit:boolean;canPrepare:boolean;pending:boolean;error:string;reason:string;modelLabel:string;
  edit:(fields:{observation:string;message:string})=>void;submit:()=>Promise<void>;prepare:()=>Promise<void>;query:()=>Promise<void>;retry:()=>Promise<void>;showCreated:()=>void;
}

/** 准备草稿不借用旧报告；当前会话仍须空闲，所选节点与来源周期身份必须完整。 */
export function recoverySourceReason(workspaceId:string,rootSessionId:string,task:TaskNode,runId:string|undefined,state:ScopeGoalState):string{
  if(state.loading||state.error||!state.graph)return '任务与目标记录尚未同步，请稍后重新核实。';
  if(task.identity.workspaceId!==workspaceId||task.identity.rootSessionId!==rootSessionId||state.graph.identity.workspaceId!==workspaceId||state.graph.identity.rootSessionId!==rootSessionId||!state.graph.tasks.some(item=>item.taskId===task.taskId&&item.revision===task.revision))return '所选任务身份已变化，请重新选择节点。';
  const scope=state.scopes.find(item=>item.scopeId===task.scopeId);
  if(!task.scopeId||!scope)return '旧任务未保存完整周期归属，仅提供只读记录。';
  if(scope.status!=='closed')return '来源任务的周期尚未关闭，请先处理当前目标。';
  if(state.openScope||state.scopes.some(item=>item.status!=='closed'))return '当前会话仍有未结束目标，暂不能创建另一个核实周期。';
  if(task.activeRunId)return '仍有在途执行记录，暂不能创建新核实周期。';
  if(task.runIds.length?!runId||!task.runIds.includes(runId):runId!==undefined)return '请明确选择要核实的执行轮次。';
  return '';
}

/** 只为完整归属、已关闭来源及空闲会话生成新请求；未知日志允许核实，但不等于未执行。 */
export function recoveryTarget(workspaceId:string,rootSessionId:string,task:TaskNode,runId:string|undefined,report:ExecutionReport|undefined,stale:boolean,state:ScopeGoalState):{target?:RecoveryTarget;reason:string}{
  const sourceReason=recoverySourceReason(workspaceId,rootSessionId,task,runId,state);if(sourceReason)return {reason:sourceReason};
  const scope=state.scopes.find(item=>item.scopeId===task.scopeId)!;
  if(!report)return {reason:'请先核实当前执行记录。'};
  if(stale||executionReportStale(report,task,state.graph!.cursor,scope))return {reason:'核实依据已变化，请重新核实后提交。'};
  if(report.identity.workspaceId!==workspaceId||report.identity.rootSessionId!==rootSessionId||report.identity.taskId!==task.taskId||report.identity.runId!==runId||report.basis.scopeId!==scope.scopeId||report.basis.scopeStatus!=='closed')return {reason:'报告不属于当前所选执行，请重新核实。'};
  if(task.activeRunId||report.execution==='in_flight')return {reason:'仍有在途执行记录，暂不能创建新核实周期。'};
  // 无已登记运行的取消节点仍可能有未知影响；只核对是否确实没有可选轮次，不强制把报告解释成未执行。
  if(task.runIds.length?!runId||!task.runIds.includes(runId):runId!==undefined)return {reason:'请明确选择要核实的执行轮次。'};
  return {target:{workspaceId,rootSessionId,source:{scopeId:scope.scopeId,taskId:task.taskId,...(runId?{runId}:{}),reportBasis:report.basis.key}},reason:''};
}

/** 同一个 root 共用本机请求索引；卸载只停止观察，不撤销提交或丢失迟到回执。 */
export function useExecutionRecovery(workspaceId:string,rootSessionId:string,task:TaskNode,runId:string|undefined,report:ExecutionReport|undefined,reportUnavailable:boolean,context?:ExecutionRecoveryContext,invalidateReport?:()=>void):ExecutionRecoveryView{
  const source:RecoverySource|undefined=task.scopeId?{scopeId:task.scopeId,taskId:task.taskId,...(runId?{runId}:{})}:undefined;
  const eligibility=context?recoveryTarget(workspaceId,rootSessionId,task,runId,report,reportUnavailable,context.state):{reason:'当前视图不支持创建核实周期。'};
  const prepareReason=context?recoverySourceReason(workspaceId,rootSessionId,task,runId,context.state):'当前视图不支持创建核实周期。';
  return useRecoverySource(workspaceId,rootSessionId,source,eligibility,prepareReason,!!report,context,invalidateReport);
}

/** 共用稳定请求控制器；新主来源直接传真实 run，不构造成员 TaskNode 或虚假 ExecutionReport。 */
export function useRecoverySource(workspaceId:string,rootSessionId:string,source:RecoverySource|undefined,eligibility:{target?:RecoveryTarget;reason:string},prepareReason:string,hasReport:boolean,context?:ExecutionRecoveryContext,invalidateReport?:()=>void):ExecutionRecoveryView{
  const key=JSON.stringify([workspaceId,rootSessionId]),keyRef=useRef(key);keyRef.current=key;
  const refreshRef=useRef(context?.refresh);refreshRef.current=context?.refresh;
  const controller=useMemo(()=>context?controllers.get(workspaceId,rootSessionId,{
    storage:{getItem:name=>window.localStorage.getItem(name),setItem:(name,value)=>window.localStorage.setItem(name,value)},
    submit:request=>window.cbim.call('loop.recoveryStart',request),lookup:request=>window.cbim.call('loop.recoveryReceipt',request),uuid:()=>crypto.randomUUID(),
  }):undefined,[workspaceId,rootSessionId,Boolean(context)]);
  const [,changed]=useState(0);
  const sourceKey=source?recoverySourceKey(source):'',observedHistoryCount=source?controller?.record(source)?.history?.length??0:0;
  // 同来源两处卡片共用命令，但各自报告独立；归档通知必须让两份旧报告都失效。
  useEffect(()=>{if(!controller)return;return source?controller.subscribeSource(source,()=>changed(value=>value+1),()=>invalidateReport?.(),observedHistoryCount):controller.subscribe(()=>changed(value=>value+1))},[controller,key,sourceKey,invalidateReport]);
  useEffect(()=>{if(controller)void controller.restore().then(()=>{if(keyRef.current===key)refreshRef.current?.()})},[controller,key]);
  const record=source?controller?.record(source):undefined,attempt=record?.attempt,pending=controller?.isPending(record)??false;
  const editable=Boolean(eligibility.target&&controller?.available&&!pending&&(!attempt||attempt.phase==='rejected'));
  const canPrepare=Boolean(context&&source&&controller?.available&&!pending&&attempt?.phase==='accepted'&&attempt.receipt?.scopeStatus==='closed'&&!prepareReason);
  const after=async(work:()=>Promise<void>)=>{await work();if(keyRef.current===key)refreshRef.current?.()};
  return {
    visible:!!context&&Boolean(hasReport||record||controller?.snapshot.error),record,observation:record?.observation??'',message:record?.message??'',editable,
    canSubmit:editable&&!!context?.model&&!!record?.observation.trim()&&!!record?.message.trim(),canPrepare,pending,error:controller?.snapshot.error??'',reason:!hasReport&&record?.history?.length?'请重新核实来源报告，再提交新的核实任务。':eligibility.reason,
    modelLabel:attempt&&attempt.phase!=='rejected'?attempt.request.options.model+' · 只读访问（本次请求已固定）':context?.model?context.model.label+' · 本次核实仅只读':'请先在对话输入区选择可用模型',
    edit:fields=>{if(editable&&source)controller!.edit(source,fields)},
    submit:()=>after(async()=>{if(editable&&eligibility.target&&context?.model)await controller!.submit(eligibility.target,{...context.model.options,permission:'read'})}),
    prepare:()=>after(async()=>{if(canPrepare&&source&&attempt)await controller!.prepareAgain(source,attempt.request.commandId)}),
    query:()=>after(async()=>{if(record)await controller!.query(record.source)}),
    // 未知命令可以在图已改变后重试原请求；服务端先去重，不能用新请求准入条件隐藏其查询入口。
    retry:()=>after(async()=>{if(record&&attempt?.phase==='unknown')await controller!.retry(record.source)}),
    showCreated:()=>{const id=attempt?.receipt?.scopeId;if(id)context?.showScope(id)},
  };
}
