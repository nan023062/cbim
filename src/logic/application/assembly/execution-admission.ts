/**
 * 目录归属：logic/application/assembly；全局准入与工作区租约。
 * 作用定位：把应用级并发准入与本工作区文件/实例租约组合为主轮和成员轮共用的同步领取入口。
 * 设计原因：等待不占任何租约；工作区装配代际与可信批次回调隔离迟到唤醒，准入错误区分未受理与可继续等待。
 */
import {fail} from '../../../core/errors';
import {hash} from '../../../core/platform/node/serialization';
import type {AdmissionRequest} from '../../runtime/rules/admission';
import type {GlobalRunAdmission} from '../../execution/admission/run-admission';
import type {WorkspaceExecutionLease} from '../../execution/admission/workspace-lease';
import type {ExecutionAdmissionWait} from '../../execution/admission/admission-wait';

/** 每次工作区装配固定一份；isCurrent 在退役时立刻失效，不等于监管投影是否仍有历史。 */
export interface WorkspaceAdmission {manager:GlobalRunAdmission;ownerEpoch:number;isCurrent():boolean;signal?:AbortSignal}

/** 来源加摘要构成有界安全标识；稳定命令不因原文长度或分隔符变化而生成无效票据键。 */
export function admissionRequestId(source:'main'|'member',commandId:string):string{return source+'-'+hash(commandId)}

/** 同步领取成功才返回幂等释放函数；没有等待回调的直接请求绝不留下后台排队票据。 */
export function acquireExecutionLease(lease:WorkspaceExecutionLease,runKey:string,request:Omit<AdmissionRequest,'ownerEpoch'>,admission?:WorkspaceAdmission,wait?:ExecutionAdmissionWait):()=>void{
  if(!admission)return lease.acquire(runKey,request.workspacePermission,request.agentInstanceId);
  const fixed={...request,ownerEpoch:admission.ownerEpoch};
  const attempt=admission.manager.attempt(fixed,{
    canAcquire:()=>lease.canAcquire(runKey,request.workspacePermission,request.agentInstanceId),
    acquire:()=>lease.acquire(runKey,request.workspacePermission,request.agentInstanceId),
    isCurrent:()=>admission.isCurrent()&&(!wait||wait.isCurrent()),
    onReady:wait?.onReady,
  });
  if(attempt.kind==='granted')return attempt.release;
  if(attempt.kind==='waiting'){
    const {source:_source,workspacePermission:_permission,...identity}=fixed;
    wait?.registerWithdraw(request.requestId,()=>{admission.manager.withdraw(identity)});
    fail('CAPACITY_WAITING','当前执行名额或工作区占用暂不可用，已受理的协作任务等待后重新核实启动');
  }
  if(attempt.reason==='stale_request')fail('COLLABORATION_STOPPED','当前启动所属工作区或调度批次已停止');
  if(attempt.reason==='agent_busy')fail('MEMBER_BUSY','该成员实例正在执行其他任务，请等待当前运行结束');
  if(attempt.reason==='workspace_conflict')fail('WORKSPACE_EXECUTION_BUSY','工作区有冲突运行，本次启动尚未受理');
  if(attempt.reason==='global_capacity'||attempt.reason==='fairness')fail('CAPACITY_BUSY','当前运行名额暂不可用，本次启动尚未受理，请稍后重试');
  fail('ADMISSION_FAILED','运行占用无法确认，未重新启动任务，请核实当前执行状态');
}
