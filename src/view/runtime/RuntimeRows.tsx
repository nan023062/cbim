/**
 * 作用定位：全局监管中的独立只读行，分别呈现周期、任务、成员和运行，不混淆各自终态。
 * 设计原因：memo 配合未变行引用避免流式状态刷新重建整表；打开原会话只传可信标识，不创建执行请求。
 */
import {memo} from 'react';
import type {RuntimeScope,RuntimeMember,RuntimeTask,RuntimeRun} from '../../bridge/contracts/runtime';
import type {AdmissionTicket} from '../../bridge/contracts/admission';
import {tokenCount} from '../../bridge/contracts/usage';
import {runtimeScopeLabel,runtimeTaskTarget,runtimeRunTarget,runtimeRunLabels,runtimeTaskLabels,runtimeMemberLabels,runtimeAdmissionLabels,type RuntimeNavigationTarget} from './runtime-view-state';
export type RuntimeOpen=(target:RuntimeNavigationTarget)=>void;
export const shortRuntimeId=(value:string)=>value.length>24?value.slice(0,8)+'…'+value.slice(-6):value;
export const runtimePrice=(value:number|undefined)=>value===undefined?'未计价':'$'+value.toFixed(4);
export const runtimeAvailability={ready:'已连接',loading:'正在载入',closed:'已关闭',unavailable:'不可用'};
const budget={token_limit:'Token 软限额',cost_limit:'费用软限额',usage_unverifiable:'用量无法核实'};
const time=(value:string)=>new Date(value).toLocaleString();
function Identity({workspace,root}:{workspace:string;root?:string}){return <span className="runtime-identity">{workspace}{root&&<> · 会话 <span title={root}>{shortRuntimeId(root)}</span></>}</span>}
interface RowProps {workspace:string;canOpen:boolean;onOpen:RuntimeOpen}
export const RuntimeScopeRow=memo(function RuntimeScopeRow({value,workspace,canOpen,onOpen}:RowProps&{value:RuntimeScope}){return <article className="runtime-row" data-testid="runtime-scope-row" data-workspace-id={value.workspaceId} data-root-session-id={value.rootSessionId} data-scope-id={value.scopeId}>
  <div className="runtime-row-top"><strong>{runtimeScopeLabel(value)}</strong><button disabled={!canOpen} onClick={()=>onOpen({workspaceId:value.workspaceId,rootSessionId:value.rootSessionId,scopeId:value.scopeId})}>打开原会话</button></div><Identity workspace={workspace} root={value.rootSessionId}/><p className="runtime-secondary">周期 <span title={value.scopeId}>{shortRuntimeId(value.scopeId)}</span> · {value.hasGoal?'目标记录版本 '+(value.goalRevision??'未报告'):'未保存结构化目标'} · {time(value.createdAt)}</p>
  {value.wait&&value.status==='waiting'&&<p>{value.wait.reason}</p>}{value.goalBlocked&&<p>目标阻塞：{value.goalBlocked.reason}</p>}{value.budgetBlocked&&<p>{budget[value.budgetBlocked.reason]}</p>}
</article>});
export const RuntimeTaskRow=memo(function RuntimeTaskRow({value,workspace,canOpen,onOpen}:RowProps&{value:RuntimeTask}){const target=runtimeTaskTarget(value);return <article className="runtime-row" data-testid={value.source==='dispatch'?'runtime-task-row':'runtime-loop-row'} data-workspace-id={value.workspaceId} data-root-session-id={target.rootSessionId} data-task-id={value.taskId}>
  <div className="runtime-row-top"><strong>{value.source==='dispatch'?runtimeTaskLabels[value.status]:'模型轮次 · '+runtimeRunLabels[value.status]}</strong><button disabled={!canOpen} onClick={()=>onOpen(target)}>{value.source==='dispatch'?'打开任务节点':'打开原会话'}</button></div><Identity workspace={workspace} root={target.rootSessionId}/><p>{value.agentId||'旧记录未绑定角色'} · {value.moduleIds.length?value.moduleIds.join('、'):'无业务模块'}</p><p className="runtime-secondary">任务 <span title={value.taskId}>{shortRuntimeId(value.taskId)}</span> · 已登记 {value.runIds.length} 轮{value.source==='dispatch'&&value.status==='result_ready'?' · 候选不代表已验收':''}</p>
</article>});
export const RuntimeMemberRow=memo(function RuntimeMemberRow({value,workspace,target,canOpen,onOpen}:RowProps&{value:RuntimeMember;target?:RuntimeNavigationTarget}){return <article className="runtime-row" data-testid="runtime-member-row" data-workspace-id={value.workspaceId} data-agent-instance-id={value.agentInstanceId}>
  <div className="runtime-row-top"><strong>{value.agentId} · {value.lifecycle==='released'?'实例已释放':!value.activityCurrent?'活动状态未核实':runtimeMemberLabels[value.activity]}</strong>{target&&<button disabled={!canOpen} onClick={()=>onOpen(target)}>打开原会话</button>}</div><Identity workspace={workspace} root={target?.rootSessionId}/><p className="runtime-secondary">实例 <span title={value.agentInstanceId}>{shortRuntimeId(value.agentInstanceId)}</span> · {value.sessionCount} 个通道 · {runtimeAvailability[value.availability]}</p>{!target&&<p className="runtime-secondary">没有可核实的主会话绑定</p>}
</article>});
export const RuntimeRunRow=memo(function RuntimeRunRow({value,workspace,canOpen,onOpen}:RowProps&{value:RuntimeRun}){const target=runtimeRunTarget(value);return <article className="runtime-row" data-testid="runtime-run-row" data-workspace-id={value.workspaceId} data-run-id={value.runId}>
  <div className="runtime-row-top"><strong>{value.memberBinding?'执行成员':'主会话/旧运行'} · {runtimeRunLabels[value.status]}</strong>{target&&<button disabled={!canOpen} onClick={()=>onOpen(target)}>打开原会话</button>}</div><Identity workspace={workspace} root={target?.rootSessionId}/><p>{value.usage.usageReported?tokenCount(value.usage.total)+' 已报告 Token':'用量尚未报告'} · {runtimePrice(value.usage.cost)}{value.usage.costPartial&&value.usage.cost!==undefined?'（已知部分）':''}</p><p className="runtime-secondary">运行 <span title={value.runId}>{shortRuntimeId(value.runId)}</span></p>
</article>});
export const RuntimeAdmissionRow=memo(function RuntimeAdmissionRow({value,workspace,canOpen,onOpen}:RowProps&{value:AdmissionTicket}){return <article className="runtime-row" data-testid="runtime-admission-row" data-request-id={value.requestId} data-workspace-id={value.workspaceId} data-root-session-id={value.rootSessionId}>
  <div className="runtime-row-top"><strong>{runtimeAdmissionLabels[value.reason]}</strong><button disabled={!canOpen} onClick={()=>onOpen({workspaceId:value.workspaceId,rootSessionId:value.rootSessionId,taskId:value.source==='member'?value.taskId:undefined,scopeId:value.scopeId})}>打开原会话</button></div><Identity workspace={workspace} root={value.rootSessionId}/><p className="runtime-secondary">排票 {value.order} · {time(value.requestedAt)} · 尚未启动，不计工作时长</p>
</article>});
