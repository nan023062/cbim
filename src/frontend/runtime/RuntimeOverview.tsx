/**
 * 作用定位：全局只读运行总览，集中显示周期、人员、任务、准入等待及已报告消耗。
 * 设计原因：应用统计和列表筛选分开，缺失计量不冒充零；原会话操作交由外壳按真实身份核实。
 * 职责边界：这里只读内存游标，不读业务正文、不启动模型，也没有恢复或修改权限入口。
 */
import {useCallback,useMemo,useRef,useState,type ReactNode} from 'react';
import type {RuntimeMember,RuntimeSnapshot} from '../../bridge/contracts/runtime';
import {tokenCount} from '../../bridge/contracts/usage';
import {useAdmission} from '../tasks/useAdmission';
import {refreshRuntime,useRuntime,useRuntimeVisibility} from './useRuntime';
import {runtimeScopeMatches,runtimeTaskMatches,runtimeMemberMatches,runtimeTaskTarget,runtimeTaskKey,runtimeRunKey,type RuntimeFilter,type RuntimeNavigationTarget} from './runtime-view-state';
import {RuntimeScopeRow,RuntimeTaskRow,RuntimeMemberRow,RuntimeRunRow,RuntimeAdmissionRow,runtimePrice,runtimeAvailability,type RuntimeOpen} from './RuntimeRows';
import './runtime-overview.css';

/** 默认只挂载前 50 行；查看更多只展开已读快照，不回读日志或创建任务。 */
function RowSection<T>({title,items,render}:{title:string;items:T[];render:(item:T)=>ReactNode}){const [limit,setLimit]=useState(50);return <section className="runtime-section"><h2>{title}<span>{items.length}</span></h2>{items.length?<div className="runtime-rows">{items.slice(0,limit).map(render)}</div>:<p className="runtime-secondary">当前筛选下没有记录。</p>}{items.length>limit&&<button onClick={()=>setLimit(n=>n+50)}>再显示 50 项（还有 {items.length-limit} 项）</button>}</section>}
/** 成员无根绑定时只沿真实派发节点找根；同名角色和最近时间均不能作为依据。 */
function memberTarget(value:RuntimeMember,data:RuntimeSnapshot):RuntimeNavigationTarget|undefined{
  if(value.mainRootSessionId)return {workspaceId:value.workspaceId,rootSessionId:value.mainRootSessionId};
  const task=data.tasks.find(t=>t.source==='dispatch'&&t.workspaceId===value.workspaceId&&t.taskId===value.executionTaskId&&t.agentInstanceId===value.agentInstanceId);
  return task?runtimeTaskTarget(task):undefined;
}
/** 统计保持全局口径；监管 complete 仅表示来源可用，不代表计量完整或业务验收。 */
export function RuntimeMetrics({data}:{data:RuntimeSnapshot}){return <>
  {!data.complete&&<p role="status">部分工作区或日志尚不可用；以下是已观察到的数据，缺失不表示零压力。</p>}
  <div className="runtime-metrics" data-testid="runtime-pressure"><div><span>活动运行</span><strong>{data.pressure.activeRuns}</strong></div><div><span>当前成员实例</span><strong>{data.pressure.memberInstances}</strong></div><div><span>待执行任务</span><strong>{data.pressure.queuedDispatchTasks}</strong></div><div><span>依赖等待 / 受阻</span><strong>{data.pressure.waitingDispatchTasks} / {data.pressure.blockedDispatchTasks}</strong></div></div>
  <div className="runtime-usage" data-testid="runtime-usage"><strong>全局已报告消耗</strong><span>{data.usage.usageReported?tokenCount(data.usage.total)+' Token':'尚无用量报告'}</span><span>估算费用 {runtimePrice(data.usage.cost)}{data.usage.cost!==undefined&&(data.usage.costPartial||data.usage.unreportedRuns>0)?'（已知部分）':''}</span><p>登记 {data.usage.runCount} 轮 · 已报告 {data.usage.reportedRuns} 轮 · 用量缺失 {data.usage.unreportedRuns} 轮 · 未计价 {data.usage.unpricedRuns} 轮</p><small>累计消耗不是上下文占用；估算不等于供应商账单。推理已计入输出，不重复相加。</small></div>
</>}
/** 组件卸载即退订；文档隐藏时连共享准入订阅也暂停，保留最近已确认数据。 */
export function RuntimeOverview({onOpen}:{onOpen:RuntimeOpen}){
  const visible=useRuntimeVisibility(),state=useRuntime(visible),admission=useAdmission(visible),[workspaceId,setWorkspaceId]=useState(''),[filter,setFilter]=useState<RuntimeFilter>('all'),data=state.data;
  // 外壳仍会刷新工作区列表；稳定回调和定位对象让未变行无需随父层重新渲染。
  const latestOpen=useRef(onOpen);latestOpen.current=onOpen;
  const openTarget=useCallback((target:RuntimeNavigationTarget)=>latestOpen.current(target),[]);
  const memberTargets=useMemo(()=>new Map(data?.members.map(m=>[m,memberTarget(m,data)])??[]),[data?.members,data?.tasks]);
  const includes=(value:{workspaceId:string})=>!workspaceId||value.workspaceId===workspaceId;
  const workspace=(key:string)=>data?.workspaces.find(w=>w.workspaceId===key)?.name??key;
  const canOpen=(key:string)=>data?.workspaces.some(w=>w.workspaceId===key&&w.availability==='ready')??false;
  return <section className="runtime-overview" data-testid="runtime-overview" data-runtime-revision={data?.cursor.revision} data-runtime-stream={data?.cursor.streamId}>
    <header className="runtime-header"><div><h1>运行管理</h1><p>查看整个应用的人员活动与任务压力，返回原会话处理。</p></div><button onClick={()=>void refreshRuntime()}>刷新运行状态</button></header>
    {state.error&&<p role="alert">{state.error}{data?'；保留上次快照，可能已过期。':''}</p>}{!visible&&<p role="status">页面隐藏，读取已暂停。</p>}
    {!data?<p role="status">{state.error?'暂未取得可信运行数据。':'正在读取运行状态…'}</p>:<>
      <RuntimeMetrics data={data}/>
      <div className="runtime-filters"><label>工作区<select aria-label="筛选运行工作区" value={workspaceId} onChange={e=>setWorkspaceId(e.target.value)}><option value="">全部工作区</option>{data.workspaces.map(w=><option key={w.workspaceId} value={w.workspaceId}>{w.name}</option>)}{workspaceId&&!data.workspaces.some(w=>w.workspaceId===workspaceId)&&<option value={workspaceId}>原工作区已不可用</option>}</select></label><label>状态<select aria-label="筛选运行状态" value={filter} onChange={e=>setFilter(e.target.value as RuntimeFilter)}><option value="all">全部记录</option><option value="current">当前活动与待办</option><option value="attention">等待或需要处理</option></select></label><small>筛选下方列表；上方统计始终为全局。准入是另一份当前进程快照。</small></div>
      <RowSection title="调度周期" items={data.scopes.filter(s=>includes(s)&&runtimeScopeMatches(s,filter))} render={s=><RuntimeScopeRow key={s.workspaceId+':'+s.scopeId} value={s} workspace={workspace(s.workspaceId)} canOpen={canOpen(s.workspaceId)} onOpen={openTarget}/>}/>
      <RowSection title="执行任务" items={data.tasks.filter(t=>t.source==='dispatch'&&includes(t)&&runtimeTaskMatches(t,filter))} render={t=><RuntimeTaskRow key={runtimeTaskKey(t)} value={t} workspace={workspace(t.workspaceId)} canOpen={canOpen(t.workspaceId)} onOpen={openTarget}/>}/>
      <section className="runtime-section"><h2>准入等待</h2>{admission.error&&<p role="alert">{admission.error}；准入数据可能已过期。</p>}{admission.data?<><p>名额已占 {admission.data.occupied.length} / {admission.data.policy.maxConcurrentRuns} · 等待 {admission.data.waiting.length}。票据不是已启动运行。</p>{admission.data.waiting.filter(includes).map(t=><RuntimeAdmissionRow key={t.ticketId} value={t} workspace={workspace(t.workspaceId)} canOpen={canOpen(t.workspaceId)} onOpen={openTarget}/>)}</>:<p>准入数据尚未读取，不代表没有排队。</p>}</section>
      <RowSection title="成员实例" items={data.members.filter(m=>includes(m)&&runtimeMemberMatches(m,filter))} render={m=><RuntimeMemberRow key={m.workspaceId+':'+m.agentInstanceId} value={m} workspace={workspace(m.workspaceId)} target={memberTargets.get(m)} canOpen={canOpen(m.workspaceId)} onOpen={openTarget}/>}/>
      <RowSection title="主会话轮次" items={data.tasks.filter(t=>t.source==='loop'&&includes(t)&&runtimeTaskMatches(t,filter))} render={t=><RuntimeTaskRow key={runtimeTaskKey(t)} value={t} workspace={workspace(t.workspaceId)} canOpen={canOpen(t.workspaceId)} onOpen={openTarget}/>}/>
      <RowSection title="逐运行消耗" items={data.runs.filter(r=>includes(r)&&(filter==='all'||(filter==='current'?r.status==='running':r.status==='failed'||r.status==='interrupted')))} render={r=><RuntimeRunRow key={runtimeRunKey(r)} value={r} workspace={workspace(r.workspaceId)} canOpen={canOpen(r.workspaceId)} onOpen={openTarget}/>}/>
      <section className="runtime-section"><h2>工作区与用户消息队列</h2><p className="runtime-secondary">消息队列与执行任务、准入等待分别统计，不相加为任务数。待发送信封 {data.pressure.pendingOutbox}。</p>{data.workspaces.filter(includes).map(w=><article key={w.workspaceId} className="runtime-row" data-testid="runtime-workspace-row" data-workspace-id={w.workspaceId}><strong>{w.name} · {runtimeAvailability[w.availability]}</strong><p>排队消息 {w.queue.pending} · 暂停消息 {w.queue.paused} · 已领取/插入中 {w.queue.inserting}</p>{w.issues.map(issue=><p key={issue.source} role="status">{issue.message} <small>({issue.source})</small></p>)}</article>)}</section>
    </>}
  </section>;
}
