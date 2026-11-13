/**
 * 目录归属：backend/scheduler-engine/admission；全局准入与工作区租约。
 * 作用定位：为应用内主轮和成员轮统一提供同步执行准入、FIFO 等待及独立只读投影。
 * 设计原因：名额与工作区租约必须一起取得；等待不占任何资源，只有原协调器能在通知后重新核实并启动。票据不持久化、不从历史恢复模型。
 */
import {randomUUID} from 'node:crypto';
import {fail} from '../../../core/errors';
import {admissionIdentitySchema,admissionRequestSchema,admissionPolicySchema,admissionConfigureSchema,admissionCursorSchema,type AdmissionIdentity,type AdmissionRequest,type AdmissionWaitReason,type AdmissionDenialReason,type AdmissionTicket,type AdmissionOccupant,type AdmissionPolicy,type AdmissionCursor,type AdmissionSnapshot,type AdmissionRead} from '../../../logic/runtime/rules/admission';

/** 本地端口必须同步；canAcquire/isCurrent 只查询，acquire 原子取得本地租约，通知不能直接绕过 attempt 执行。 */
export interface LocalAdmissionPort {
  canAcquire():undefined|'workspace_conflict'|'agent_busy';
  acquire():()=>void;
  isCurrent():boolean;
  onReady?():void;
}
export type AdmissionAttempt={kind:'granted';release:()=>void;occupant:AdmissionOccupant}|{kind:'waiting';ticket:AdmissionTicket}|{kind:'denied';reason:AdmissionDenialReason};
type Waiting={request:AdmissionRequest;ticket:AdmissionTicket;port:LocalAdmissionPort};
type Occupied={request:AdmissionRequest;view:AdmissionOccupant};
const clone=<T>(value:T):T=>structuredClone(value);
const key=(identity:AdmissionIdentity)=>JSON.stringify([identity.workspaceId,identity.ownerEpoch,identity.requestId]);
const ownerKey=(workspaceId:string,epoch:number)=>JSON.stringify([workspaceId,epoch]);
const same=(left:unknown,right:unknown)=>JSON.stringify(left)===JSON.stringify(right);

/** Application 单例。所有资格判断与本地领取都在一个同步段内；异步等待由调用方已有队列负责。 */
export class GlobalRunAdmission {
  private readonly streamId=randomUUID();
  private revision=0;
  private policy:AdmissionPolicy={revision:1,maxConcurrentRuns:4};
  private attempted=false;
  private policyRestored=false;
  private configured=false;
  private inAttempt=false;
  private order=0;
  private readonly occupied=new Map<string,Occupied>();
  private readonly waiting=new Map<string,Waiting>();
  /** 关闭的装配代际不再接收新请求；旧运行的释放函数仍然有效，不能假释放活动占用。 */
  private readonly retired=new Set<string>();
  private readonly listeners=new Set<()=>void>();
  private changeScheduled=false;
  private wakeScheduled=false;
  private changed(){
    this.revision++;
    if(this.changeScheduled)return;this.changeScheduled=true;
    queueMicrotask(()=>{this.changeScheduled=false;for(const listener of this.listeners)try{listener()}catch{/* 观察失败不改变准入 */}});
  }
  observeChange(listener:()=>void){this.listeners.add(listener);return ()=>{this.listeners.delete(listener)}}
  private current(request:AdmissionRequest,port:LocalAdmissionPort){if(this.retired.has(ownerKey(request.workspaceId,request.ownerEpoch)))return false;try{return port.isCurrent()===true}catch{return false}}
  private local(port:LocalAdmissionPort):AdmissionWaitReason|undefined {try{const value=port.canAcquire();return value===undefined?undefined:value==='agent_busy'?'agent_busy':'workspace_conflict'}catch{return 'workspace_conflict'}}
  private prune(){let removed=false;for(const [id,item] of this.waiting)if(!this.current(item.request,item.port)){this.waiting.delete(id);this.changed();removed=true}return removed}
  /** FIFO 只比较可领取票；较早 writer 即使本地阻塞也形成同工作区屏障，不能被后来 reader 饿死。 */
  private evaluate(candidate?:Waiting){
    const entries=[...this.waiting.values(),...(candidate?[candidate]:[])].sort((left,right)=>left.ticket.order-right.ticket.order);
    let free=Math.max(0,this.policy.maxConcurrentRuns-this.occupied.size);
    const writers=new Set<string>(),selectedReaders=new Set<string>(),selectedAgents=new Set<string>();
    const choices=new Map<string,{ready:boolean;reason:AdmissionWaitReason}>();
    for(const item of entries){
      const {request}=item,id=key(request),workspace=request.workspaceId,agent=request.agentInstanceId?JSON.stringify([workspace,request.agentInstanceId]):undefined;
      let reason=this.local(item.port);
      if(writers.has(workspace))reason='fairness';
      else if(agent&&selectedAgents.has(agent))reason='agent_busy';
      else if(request.workspacePermission!=='read'&&selectedReaders.has(workspace))reason='workspace_conflict';
      const ready=!reason&&free>0;
      choices.set(id,{ready,reason:reason??(free>0?'fairness':'global_capacity')});
      if(request.workspacePermission!=='read')writers.add(workspace);
      if(ready){free--;if(agent)selectedAgents.add(agent);if(request.workspacePermission==='read')selectedReaders.add(workspace)}
    }
    return choices;
  }
  private updateReasons(choices:ReturnType<GlobalRunAdmission['evaluate']>){for(const [id,item] of this.waiting){const reason=choices.get(id)?.reason;if(reason&&reason!==item.ticket.reason){item.ticket={...item.ticket,reason};this.changed()}}}
  /**
   * 同请求排队重试保留原票；变参拒绝，已占用不返回第二把释放句柄。direct 拒绝不排票。
   * 本地领取失败不会创建全局占用；只有成功返回 granted 才允许调用方继续创建 run/模型。
   */
  attempt(raw:AdmissionRequest,port:LocalAdmissionPort):AdmissionAttempt {
    if(this.inAttempt)fail('ADMISSION_REENTRANT','准入的同步本地检查不能重入领取');
    this.attempted=true;const parsed=admissionRequestSchema.safeParse(raw);if(!parsed.success)fail('ADMISSION_INPUT_INVALID','执行准入身份或参数无效');
    const request=parsed.data,id=key(request),old=this.waiting.get(id),active=this.occupied.get(id);
    if((old&&!same(old.request,request))||(active&&!same(active.request,request)))fail('ADMISSION_REQUEST_CONFLICT','同一执行准入请求不能改变身份、来源或权限');
    if(active)return {kind:'denied',reason:'already_running'};
    this.inAttempt=true;
    try{
      if(this.prune())this.wake();
      if(!this.current(request,port)){if(this.waiting.delete(id))this.changed();return {kind:'denied',reason:'stale_request'}}
      // 等待者仍由当前调用的可信本地端口负责，身份/来源/权限保持原值，不存储模型正文。
      let item=this.waiting.get(id);if(item)item.port=port;
      const candidate=item??{request,ticket:{...request,ticketId:randomUUID(),order:this.order+1,requestedAt:new Date().toISOString(),reason:'fairness' as const},port};
      const choices=this.evaluate(item?undefined:candidate),choice=choices.get(id)!;this.updateReasons(choices);
      if(!choice.ready)return this.waitOrDeny(candidate,choice.reason);
      if(!this.current(request,port)){if(this.waiting.delete(id))this.changed();return {kind:'denied',reason:'stale_request'}}
      let releaseLocal:()=>void;
      try{releaseLocal=port.acquire();if(typeof releaseLocal!=='function')throw Error('invalid local release')}
      catch(error){
        const code=(error as {code?:string})?.code;
        if(code==='WORKSPACE_EXECUTION_BUSY'||code==='MEMBER_BUSY')return this.waitOrDeny(candidate,code==='MEMBER_BUSY'?'agent_busy':'workspace_conflict');
        if(this.waiting.delete(id)){this.changed();this.wake()}return {kind:'denied',reason:'local_acquire_failed'};
      }
      // acquire 契约要求同步；若它在内部触发停止，立即退回本地占用而不创建全局许可。
      if(!this.current(request,port)){releaseLocal();if(this.waiting.delete(id))this.changed();return {kind:'denied',reason:'stale_request'}}
      this.waiting.delete(id);const view:AdmissionOccupant={...request,acquiredAt:new Date().toISOString()};this.occupied.set(id,{request,view});this.changed();
      let released=false;
      return {kind:'granted',occupant:clone(view),release:()=>{
        if(released)return;released=true;this.occupied.delete(id);this.changed();
        // 先退出全局，再释放本地；finally 保证异常释放也会通知其它工作区，旧句柄不可二次释放新占用。
        try{releaseLocal()}finally{this.wake()}
      }};
    }finally{this.inAttempt=false}
  }
  private waitOrDeny(item:Waiting,reason:AdmissionWaitReason):AdmissionAttempt {
    if(item.request.source==='direct')return {kind:'denied',reason};
    const id=key(item.request),old=this.waiting.get(id);
    if(!old){item.ticket={...item.ticket,order:++this.order,reason};this.waiting.set(id,item);this.changed()}
    else if(old.ticket.reason!==reason){old.ticket={...old.ticket,reason};this.changed()}
    // 排队本身不触发 onReady；只有外部状态变化唤醒，防止无资源重试形成微任务忙循环。
    return {kind:'waiting',ticket:clone(this.waiting.get(id)!.ticket)};
  }
  /** 只撤销等待票；提供的可选身份必须匹配，不会中止或假释放已运行占用。 */
  withdraw(raw:AdmissionIdentity):boolean {
    const parsed=admissionIdentitySchema.safeParse(raw);if(!parsed.success)fail('ADMISSION_INPUT_INVALID','撤票身份无效');
    const identity=parsed.data,id=key(identity),item=this.waiting.get(id);if(!item)return false;
    if(Object.entries(identity).some(([field,value])=>(item.request as Record<string,unknown>)[field]!==value))fail('ADMISSION_REQUEST_CONFLICT','撤票身份与原执行请求不一致');
    this.waiting.delete(id);this.changed();this.wake();return true;
  }
  /** 工作区关闭代际只撤等待；既有运行持续占用名额直到其真实释放函数返回。 */
  retireOwner(workspaceId:string,ownerEpoch:number):void {
    const parsed=admissionIdentitySchema.pick({workspaceId:true,ownerEpoch:true}).safeParse({workspaceId,ownerEpoch});if(!parsed.success)fail('ADMISSION_INPUT_INVALID','工作区准入代际无效');
    this.retired.add(ownerKey(workspaceId,ownerEpoch));let changed=false;
    for(const [id,item] of this.waiting)if(item.request.workspaceId===workspaceId&&item.request.ownerEpoch===ownerEpoch){this.waiting.delete(id);changed=true}
    if(changed)this.changed();this.wake();
  }
  /** 合并外部释放/配置/本地状态变化，仅通知可轮到的原协调器；不直接创建模型或运行。 */
  wake():void {
    if(this.wakeScheduled)return;this.wakeScheduled=true;
    queueMicrotask(()=>{
      this.wakeScheduled=false;this.prune();const choices=this.evaluate();this.updateReasons(choices);
      const ready=[...this.waiting].filter(([id])=>choices.get(id)?.ready).map(([id])=>id);
      for(const id of ready){const item=this.waiting.get(id);if(!item||!this.current(item.request,item.port)||!this.evaluate().get(id)?.ready)continue;try{item.port.onReady?.()}catch{/* 原协调器负责失败处置，通知本身不签发执行 */}}
    });
  }
  /** 持久设置只允许在启动恢复阶段安装一次；不能在执行过请求或改配后回滚版本。 */
  restorePolicy(raw:AdmissionPolicy):void {
    if(this.attempted||this.configured||this.policyRestored||this.occupied.size||this.waiting.size||this.inAttempt)fail('ADMISSION_RESTORE_FORBIDDEN','运行准入已经开始，不能覆盖恢复策略');
    const parsed=admissionPolicySchema.safeParse(raw);if(!parsed.success)fail('ADMISSION_POLICY_INVALID','执行并发策略无效');this.policyRestored=true;
    if(!same(this.policy,parsed.data)){this.policy=parsed.data;this.changed()}
  }
  /** revision 是当前策略的 CAS 版本；额度下降不取消已有占用。调用方须先可靠保存新策略再调用。 */
  configure(raw:AdmissionPolicy):AdmissionPolicy {
    if(this.inAttempt)fail('ADMISSION_REENTRANT','准入领取期间不能重入修改策略');
    const parsed=admissionConfigureSchema.safeParse(raw);if(!parsed.success)fail('ADMISSION_POLICY_INVALID','执行并发上限必须为 1 至 32');
    if(parsed.data.revision!==this.policy.revision||this.policy.revision===Number.MAX_SAFE_INTEGER)fail('ADMISSION_POLICY_CONFLICT','执行并发策略版本已变化，请重新读取');
    this.configured=true;this.policy={revision:this.policy.revision+1,maxConcurrentRuns:parsed.data.maxConcurrentRuns};this.changed();this.wake();return clone(this.policy);
  }
  snapshot():AdmissionSnapshot{return {cursor:{streamId:this.streamId,revision:this.revision},policy:clone(this.policy),occupied:[...this.occupied.values()].map(item=>clone(item.view)),waiting:[...this.waiting.values()].sort((a,b)=>a.ticket.order-b.ticket.order).map(item=>clone(item.ticket))}}
  /** 读取不执行本地回调、不清理票据、不扫描日志；不同/未来游标返回新快照，同游标为 noop。 */
  read(cursor?:AdmissionCursor):AdmissionRead {
    if(cursor!==undefined&&!admissionCursorSchema.safeParse(cursor).success)fail('ADMISSION_CURSOR_INVALID','运行准入游标无效');
    if(cursor?.streamId===this.streamId&&cursor.revision===this.revision)return {kind:'noop',cursor:{...cursor}};
    return {kind:'snapshot',snapshot:this.snapshot()};
  }
}
