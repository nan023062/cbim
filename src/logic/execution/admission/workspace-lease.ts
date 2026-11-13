/**
 * 目录归属：logic/execution/admission；全局准入与工作区租约。
 * 作用定位：同一已打开工作区内，主会话与独立成员共享的执行占用协调器。
 * 设计原因：主调度与执行成员是独立实例，各实例串行；不同实例只读可并行，写入或可能获批写入的运行独占工作区。同一主运行内部的证据核实可派生读占用，不能误与自身独占冲突；跨进程排他由工作区内核锁负责。
 */
import {fail} from '../../../core/errors';
import type {ChatPermission} from '../../tools/rules/policy/types';

/** 由工作区装配方共享的进程内协调器；只控制已接入运行，不限制外部程序对文件的访问。 */
export class WorkspaceExecutionLease {
  private listeners=new Set<()=>void>();
  /** 仅在占用真正释放后通知调度重试；不把监听者异常传播给已结束的执行。 */
  observeRelease(listener:()=>void){this.listeners.add(listener);return ()=>{this.listeners.delete(listener)}}
  /** 键由装配方加 conversation/member 前缀；权限在领取时固定，占用持续至对应释放函数调用。 */
  private leases=new Map<string,{permission:ChatPermission;agentInstanceId?:string}>();
  /** 同步只读资格检查，不占用也不排队；准入器可跳过本地暂不可领取的请求。 */
  canAcquire(runKey:string,permission:ChatPermission,agentInstanceId?:string):'agent_busy'|'workspace_conflict'|undefined {
    const active=[...this.leases.values()];
    if(agentInstanceId&&active.some(lease=>lease.agentInstanceId===agentInstanceId))return 'agent_busy';
    if(this.leases.has(runKey)||active.some(lease=>lease.permission!=='read')||(permission!=='read'&&this.leases.size))return 'workspace_conflict';
  }
  /** 非阻塞领取；同实例任何权限都串行，ask 按写入独占。旧未登记调用可缺省实例；释放函数幂等。 */
  acquire(runKey:string,permission:ChatPermission,agentInstanceId?:string):()=>void {
    const reason=this.canAcquire(runKey,permission,agentInstanceId);
    if(reason==='agent_busy')fail('MEMBER_BUSY','该成员实例正在执行其他任务，请等待当前运行结束');
    if(reason==='workspace_conflict')fail('WORKSPACE_EXECUTION_BUSY','工作区有冲突运行，请等待结束后启动；不同实例的只读任务可以并行');
    return this.hold(runKey,permission,agentInstanceId);
  }
  /**
   * 仅供装配方确认属于 ownerKey 的运行内只读核证。没有原占用时按普通读申请，不能借其他运行跳过排他。
   * 派生占用独立释放；即使原运行先结束，尚未结束的读取仍阻止后续写入。此方法不授予工具权限。
   */
  acquireReadWithin(runKey:string,ownerKey:string):()=>void {
    if(!this.leases.has(ownerKey))return this.acquire(runKey,'read');
    if(this.leases.has(runKey)||[...this.leases].some(([key,lease])=>key!==ownerKey&&lease.permission!=='read'))fail('WORKSPACE_EXECUTION_BUSY','证据核实与其他工作区运行冲突');
    return this.hold(runKey,'read');
  }
  private hold(runKey:string,permission:ChatPermission,agentInstanceId?:string):()=>void {
    this.leases.set(runKey,{permission,agentInstanceId});let released=false;
    return ()=>{if(!released){released=true;this.leases.delete(runKey);for(const listener of this.listeners)try{listener()}catch{/* 已释放的占用不受观察者影响 */}}};
  }
}
