import {it,expect,vi} from 'vitest';
import {GlobalRunAdmission,type AdmissionAttempt,type LocalAdmissionPort} from '../src/logic/execution/admission/run-admission';
import {admissionReadSchema,admissionSnapshotSchema,type AdmissionRequest} from '../src/logic/runtime/rules/admission';

const request=(id:string,patch:Partial<AdmissionRequest>={}):AdmissionRequest=>({workspaceId:'workspace',ownerEpoch:1,rootSessionId:'root-'+id,requestId:id,source:'member',workspacePermission:'read',...patch});
const tick=async()=>{await Promise.resolve();await Promise.resolve();await Promise.resolve()};
function port(reason:ReturnType<LocalAdmissionPort['CanAcquire']>=undefined){let current=true;const release=vi.fn();return {CanAcquire:vi.fn(()=>reason),Acquire:vi.fn<()=>()=>void>(()=>release),IsCurrent:vi.fn(()=>current),OnReady:vi.fn(),release,setCurrent(value:boolean){current=value},setReason(value:typeof reason){reason=value}}}
function granted(result:AdmissionAttempt){expect(result.kind).toBe('granted');if(result.kind!=='granted')throw Error('not granted');return result}
function waiting(result:AdmissionAttempt){expect(result.kind).toBe('waiting');if(result.kind!=='waiting')throw Error('not waiting');return result}
function localWorkspace(){
  const held=new Map<string,AdmissionRequest>();
  const forRequest=(input:AdmissionRequest)=>{
    const canAcquire=()=>input.agentInstanceId&&[...held.values()].some(item=>item.agentInstanceId===input.agentInstanceId)?'agent_busy' as const:[...held.values()].some(item=>item.workspacePermission!=='read')||input.workspacePermission!=='read'&&held.size?'workspace_conflict' as const:undefined;
    return {CanAcquire:vi.fn(canAcquire),IsCurrent:vi.fn(()=>true),OnReady:vi.fn(),Acquire:vi.fn(()=>{if(canAcquire())throw Object.assign(Error('busy'),{code:'WORKSPACE_EXECUTION_BUSY'});held.set(input.requestId,input);let released=false;return ()=>{if(!released){released=true;held.delete(input.requestId)}}})};
  };
  return {held,forRequest};
}

it('默认4槽、恢复完整策略版本、CAS配置以及降低配额不逐出活动运行',async()=>{
  const controller=new GlobalRunAdmission();expect(controller.Snapshot().policy).toEqual({revision:1,maxConcurrentRuns:4});
  controller.RestorePolicy({revision:7,maxConcurrentRuns:2});expect(controller.Configure({revision:7,maxConcurrentRuns:3})).toEqual({revision:8,maxConcurrentRuns:3});
  expect(()=>controller.Configure({revision:7,maxConcurrentRuns:1})).toThrowError(expect.objectContaining({code:'ADMISSION_POLICY_CONFLICT'}));
  expect(()=>controller.Configure({revision:8,maxConcurrentRuns:33})).toThrowError(expect.objectContaining({code:'ADMISSION_POLICY_INVALID'}));
  const releases=Array.from({length:3},(_,index)=>granted(controller.Attempt(request('active-'+index,{workspaceId:'ws-'+index}),port())));
  controller.Configure({revision:8,maxConcurrentRuns:1});expect(controller.Snapshot().occupied).toHaveLength(3);const pending=port();waiting(controller.Attempt(request('pending'),pending));
  releases[0].release();releases[1].release();await tick();expect(pending.OnReady).not.toHaveBeenCalled();
  releases[2].release();await tick();expect(pending.OnReady).toHaveBeenCalledTimes(1);expect(pending.Acquire).not.toHaveBeenCalled();
  expect(()=>controller.RestorePolicy({revision:1,maxConcurrentRuns:4})).toThrowError(expect.objectContaining({code:'ADMISSION_RESTORE_FORBIDDEN'}));
});

it('主轮与成员跨工作区共同计数，等待不占本地，direct不足明确拒绝且无票',async()=>{
  const controller=new GlobalRunAdmission(),leases:ReturnType<typeof granted>[]=[];
  for(const [index,source] of (['direct','member','main-result','direct'] as const).entries())leases.push(granted(controller.Attempt(request('r-'+index,{source,workspaceId:'ws-'+index}),port())));
  const member=port(),ticket=waiting(controller.Attempt(request('queued'),member)).ticket;expect(ticket.reason).toBe('global_capacity');expect(member.Acquire).not.toHaveBeenCalled();
  const direct=port();expect(controller.Attempt(request('rejected',{source:'direct'}),direct)).toEqual({kind:'denied',reason:'global_capacity'});expect(direct.Acquire).not.toHaveBeenCalled();expect(controller.Snapshot().waiting).toHaveLength(1);
  leases[0].release();leases[0].release();await tick();expect(controller.Snapshot().occupied).toHaveLength(3);expect(member.OnReady).toHaveBeenCalledTimes(1);expect(member.Acquire).not.toHaveBeenCalled();
  granted(controller.Attempt(request('queued'),member));expect(controller.Snapshot().occupied).toHaveLength(4);expect(controller.Snapshot().waiting).toEqual([]);
});

it('FIFO按可执行顺序通知，direct不能抢占已排票者释放出的最后名额',async()=>{
  const controller=new GlobalRunAdmission();controller.Configure({revision:1,maxConcurrentRuns:1});const active=granted(controller.Attempt(request('active'),port())),first=port(),second=port();
  const one=waiting(controller.Attempt(request('first'),first)),two=waiting(controller.Attempt(request('second'),second));expect(one.ticket.order).toBeLessThan(two.ticket.order);
  active.release();expect(controller.Attempt(request('direct',{source:'direct'}),port()).kind).toBe('denied');await tick();expect(first.OnReady).toHaveBeenCalledTimes(1);expect(second.OnReady).not.toHaveBeenCalled();
  const started=granted(controller.Attempt(request('first'),first));started.release();await tick();expect(second.OnReady).toHaveBeenCalledTimes(1);
});

it('本地冲突不阻塞其它工作区，较早writer阻止同工作区后来reader持续插队',async()=>{
  const controller=new GlobalRunAdmission(),local=localWorkspace(),external=request('external'),externalRelease=local.forRequest(external).Acquire();
  const writer=request('writer',{workspacePermission:'ask'}),reader=request('reader'),writerPort=local.forRequest(writer),readerPort=local.forRequest(reader);
  expect(waiting(controller.Attempt(writer,writerPort)).ticket.reason).toBe('workspace_conflict');expect(waiting(controller.Attempt(reader,readerPort)).ticket.reason).toBe('fairness');
  expect(controller.Attempt(request('direct',{source:'direct'}),local.forRequest(request('direct',{source:'direct'})))).toEqual({kind:'denied',reason:'fairness'});
  const other=granted(controller.Attempt(request('other',{workspaceId:'elsewhere'}),port()));expect(controller.Snapshot().occupied).toHaveLength(1);
  externalRelease();controller.Wake();await tick();expect(writerPort.OnReady).toHaveBeenCalledTimes(1);expect(readerPort.OnReady).not.toHaveBeenCalled();
  const writing=granted(controller.Attempt(writer,writerPort));expect(local.held.size).toBe(1);writing.release();await tick();expect(readerPort.OnReady).toHaveBeenCalledTimes(1);granted(controller.Attempt(reader,readerPort));other.release();
});

it('重复等待保留票序和时间，变参拒绝，已运行请求不重复领取或返回释放能力',()=>{
  const controller=new GlobalRunAdmission(),blocked=port('agent_busy'),input=request('same',{agentInstanceId:'agent-1'}),first=waiting(controller.Attempt(input,blocked));
  expect(waiting(controller.Attempt(input,blocked))).toEqual(first);expect(controller.Snapshot().waiting).toHaveLength(1);
  for(const patch of [{workspacePermission:'execute' as const},{rootSessionId:'other'},{source:'main-result' as const},{agentInstanceId:'agent-2'}])expect(()=>controller.Attempt({...input,...patch},blocked)).toThrowError(expect.objectContaining({code:'ADMISSION_REQUEST_CONFLICT'}));
  blocked.setReason(undefined);const active=granted(controller.Attempt(input,blocked));expect(controller.Attempt(input,blocked)).toEqual({kind:'denied',reason:'already_running'});expect(blocked.Acquire).toHaveBeenCalledTimes(1);active.release();active.release();expect(blocked.release).toHaveBeenCalledTimes(1);
});

it('关闭owner只撤票不假释放，旧代迟到请求被拒，新代须等待真实占用释放',async()=>{
  const controller=new GlobalRunAdmission();controller.Configure({revision:1,maxConcurrentRuns:1});const activePort=port(),active=granted(controller.Attempt(request('active'),activePort)),oldPort=port();waiting(controller.Attempt(request('old-wait'),oldPort));
  controller.RetireOwner('workspace',1);expect(controller.Snapshot().waiting).toEqual([]);expect(controller.Snapshot().occupied).toHaveLength(1);expect(activePort.release).not.toHaveBeenCalled();
  expect(controller.Attempt(request('late'),port())).toEqual({kind:'denied',reason:'stale_request'});const next=port();waiting(controller.Attempt(request('new',{ownerEpoch:2}),next));
  active.release();await tick();expect(oldPort.OnReady).not.toHaveBeenCalled();expect(next.OnReady).toHaveBeenCalledTimes(1);const current=granted(controller.Attempt(request('new',{ownerEpoch:2}),next));active.release();expect(controller.Snapshot().occupied).toHaveLength(1);current.release();
});

it('取消或失效等待不会被迟到唤醒重建，等待重试本身不产生微任务忙循环',async()=>{
  const controller=new GlobalRunAdmission();controller.Configure({revision:1,maxConcurrentRuns:1});const active=granted(controller.Attempt(request('active'),port())),cancelled=port(),stale=port();
  waiting(controller.Attempt(request('cancelled',{scopeId:'scope'}),cancelled));waiting(controller.Attempt(request('stale'),stale));
  expect(()=>controller.Withdraw({...request('cancelled'),rootSessionId:'foreign'})).toThrow();
  expect(controller.Withdraw({workspaceId:'workspace',ownerEpoch:1,rootSessionId:'root-cancelled',requestId:'cancelled'})).toBe(true);expect(controller.Withdraw({workspaceId:'workspace',ownerEpoch:1,rootSessionId:'root-cancelled',requestId:'cancelled'})).toBe(false);
  stale.setCurrent(false);active.release();await tick();expect(cancelled.OnReady).not.toHaveBeenCalled();expect(stale.OnReady).not.toHaveBeenCalled();expect(controller.Snapshot().waiting).toEqual([]);
  const blocked=port('workspace_conflict');blocked.OnReady.mockImplementation(()=>{controller.Attempt(request('blocked'),blocked)});waiting(controller.Attempt(request('blocked'),blocked));controller.Wake();await tick();await tick();expect(blocked.OnReady).not.toHaveBeenCalled();
});

it('本地领取失败不漏全局槽，已知冲突保持等待，未知异常不伪造获准',async()=>{
  const controller=new GlobalRunAdmission(),unknown=port();unknown.Acquire.mockImplementation(()=>{throw Error('failed')});
  expect(controller.Attempt(request('bad'),unknown)).toEqual({kind:'denied',reason:'local_acquire_failed'});expect(controller.Snapshot().occupied).toEqual([]);expect(controller.Snapshot().waiting).toEqual([]);
  const raced=port();raced.Acquire.mockImplementation(()=>{throw Object.assign(Error('busy'),{code:'MEMBER_BUSY'})});expect(waiting(controller.Attempt(request('race'),raced)).ticket.reason).toBe('agent_busy');expect(controller.Snapshot().occupied).toEqual([]);
  raced.Acquire.mockReturnValue(raced.release);granted(controller.Attempt(request('race'),raced));expect(controller.Snapshot().occupied).toHaveLength(1);
});

it('只读游标和快照不调用端口或泄漏回调，观察异常不改变准入，重建不重放票据',async()=>{
  const controller=new GlobalRunAdmission(),local=port('workspace_conflict'),notice=vi.fn(()=>{throw Error('observer')});controller.ObserveChange(notice);waiting(controller.Attempt(request('pending'),local));await tick();
  local.CanAcquire.mockClear();local.IsCurrent.mockClear();const first=controller.Read();expect(admissionReadSchema.safeParse(first).success).toBe(true);expect(admissionSnapshotSchema.safeParse(controller.Snapshot()).success).toBe(true);
  const cursor=controller.Snapshot().cursor;expect(controller.Read(cursor)).toEqual({kind:'noop',cursor});expect(controller.Read({...cursor,revision:cursor.revision+100}).kind).toBe('snapshot');expect(controller.Read({streamId:'other',revision:0}).kind).toBe('snapshot');
  const changed=controller.Snapshot();changed.waiting[0].reason='agent_busy';changed.policy.maxConcurrentRuns=32;expect(controller.Snapshot().waiting[0].reason).toBe('workspace_conflict');expect(controller.Snapshot().policy.maxConcurrentRuns).toBe(4);expect(local.CanAcquire).not.toHaveBeenCalled();expect(local.IsCurrent).not.toHaveBeenCalled();expect(local.Acquire).not.toHaveBeenCalled();
  expect(JSON.stringify(controller.Snapshot())).not.toMatch(/canAcquire|onReady|isCurrent|function/);expect(new GlobalRunAdmission().Snapshot().waiting).toEqual([]);expect(notice).toHaveBeenCalledTimes(1);
});

it('同步重入及acquire内的关闭不能多发许可；释放异常仍只释放一次全局并通知等待者',async()=>{
  const controller=new GlobalRunAdmission(),nested=port();nested.Acquire.mockImplementation(()=>{controller.Attempt(request('nested'),port());return ()=>{}});
  expect(controller.Attempt(request('outer'),nested)).toEqual({kind:'denied',reason:'local_acquire_failed'});expect(controller.Snapshot().occupied).toEqual([]);
  const closing=port();closing.Acquire.mockImplementation(()=>{controller.RetireOwner('workspace',1);return closing.release});expect(controller.Attempt(request('closing'),closing)).toEqual({kind:'denied',reason:'stale_request'});expect(closing.release).toHaveBeenCalledTimes(1);expect(controller.Snapshot().occupied).toEqual([]);
  const alive=request('active',{workspaceId:'other'}),releaseThrows=port();releaseThrows.release.mockImplementation(()=>{throw Error('release failed')});const lease=granted(controller.Attempt(alive,releaseThrows));expect(()=>lease.release()).toThrow('release failed');expect(()=>lease.release()).not.toThrow();expect(controller.Snapshot().occupied).toEqual([]);await tick();
});

it('传输输入严格且restore仅启动前一次，不接受路径身份、额外字段或无效版本',()=>{
  const controller=new GlobalRunAdmission();for(const bad of [{...request('x'),requestId:'../x'},{...request('x'),ownerEpoch:0},{...request('x'),secret:'no'}])expect(()=>controller.Attempt(bad as AdmissionRequest,port())).toThrowError(expect.objectContaining({code:'ADMISSION_INPUT_INVALID'}));
  expect(()=>controller.RestorePolicy({revision:1,maxConcurrentRuns:4})).toThrowError(expect.objectContaining({code:'ADMISSION_RESTORE_FORBIDDEN'}));
  const fresh=new GlobalRunAdmission();fresh.RestorePolicy({revision:2,maxConcurrentRuns:1});expect(()=>fresh.RestorePolicy({revision:1,maxConcurrentRuns:2})).toThrowError(expect.objectContaining({code:'ADMISSION_RESTORE_FORBIDDEN'}));
  expect(()=>fresh.Read({streamId:'x',revision:-1})).toThrowError(expect.objectContaining({code:'ADMISSION_CURSOR_INVALID'}));
});
