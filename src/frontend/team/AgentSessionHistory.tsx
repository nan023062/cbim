/**
 * 作用定位：在静态 Agent 下浏览长期 Session 履历，按独立会话和运行展示公开消息、工具过程与计划证据。
 * 设计原因：角色可被复用、改名或删除，历史必须保留原身份与配置版本；此页面只读归档，不把多实例历史拼成模型上下文，不提供恢复、审批或执行按钮。
 */
import {useEffect,useRef,useState} from 'react';
import type {AgentHistoryRole,AgentHistoryRun,AgentHistorySession,AgentHistoryRoles} from '../../bridge/contracts/agent-history';
import type {RunSummary} from '../../bridge/contracts/execution';
import {MemberRunTranscript} from '../tasks/MemberRunTranscript';
import {transcript} from '../execution-view/transcript';
import {MarkdownMessage} from '../execution-view/MarkdownMessage';
import {historyRunKey} from './agent-history-state';
import {useHistoryEvents,useHistoryPage} from './useAgentHistory';
import './agent-history.css';
import '../tasks/member-activity.css';

const statusNames={starting:'正在准备',running:'执行中',completed:'本轮结束',cancelled:'已停止',failed:'执行失败',interrupted:'执行中断'};
const time=(value:string)=>Number.isNaN(Date.parse(value))?'时间未记录':new Date(value).toLocaleString();
type Definitions=Record<string,string>;
/** currentDefinitions 只用于对照当前静态定义；历史仍以服务端记录的名称、配置版本和身份为准。 */
export interface AgentSessionHistoryProps {workspaceId:string;initialAgentId?:string;currentDefinitions:Definitions;knowledgeReady:boolean;onClose:()=>void}
function rolePresence(id:string,definitions:Definitions,ready:boolean){return definitions[id]?'当前定义存在':ready?'当前定义已删除或不再登记':'当前定义尚未读取'}
function Diagnostics({items}:{items:string[]}){return items.length?<div className="agent-history-diagnostics" role="status"><strong>部分历史需要核实</strong><ul>{items.map((item,index)=><li key={index}>{item}</li>)}</ul></div>:null}

/** 未提供 initialAgentId 时先浏览历史角色索引；已删除角色只在此索引出现，不回填静态团队树。 */
export function AgentSessionHistory({workspaceId,initialAgentId,currentDefinitions,knowledgeReady,onClose}:AgentSessionHistoryProps){
  const [selected,setSelected]=useState(initialAgentId??''),[roles,setRoles]=useState<AgentHistoryRole[]>([]),[diagnostics,setDiagnostics]=useState<string[]>([]),[error,setError]=useState(''),[loading,setLoading]=useState(false);
  const [filter,setFilter]=useState(''),[revision,setRevision]=useState(0),request=useRef(0);
  useEffect(()=>{
    const token=++request.current;let stopped=false;setLoading(true);setError('');
    void window.cbim.call('agentHistory.roles',{workspaceId}).then((reply:AgentHistoryRoles)=>{
      if(stopped||request.current!==token)return;
      if(reply.roles.some(role=>role.workspaceId!==workspaceId))throw Error('历史角色工作区不一致，请重新读取');
      setRoles(reply.roles);setDiagnostics(reply.diagnostics);
    }).catch(cause=>{if(!stopped&&request.current===token)setError(cause instanceof Error?cause.message:'历史角色读取失败，请重试')}).finally(()=>{if(!stopped&&request.current===token)setLoading(false)});
    return()=>{stopped=true};
  },[workspaceId,revision]);
  const archived=roles.find(role=>role.agentId===selected),name=archived?.name??currentDefinitions[selected]??selected;
  const needle=filter.trim().toLocaleLowerCase(),shown=roles.filter(role=>(role.name+' '+role.agentId).toLocaleLowerCase().includes(needle));
  return <section className="agent-session-history" aria-label="Agent 执行历史" data-testid="agent-session-history">
    <header className="agent-history-heading"><div><p className="overline">只读履历</p><h2>{selected?name+' · 执行历史':'历史角色'}</h2></div><button data-testid="history-back" onClick={onClose}>返回团队定义</button></header>
    <p className="agent-history-note">按静态角色检索独立 Session，不合并模型上下文。历史不会因执行实例释放或角色删除而消失；运行结束不等于业务验收。</p>
    <div className="agent-history-toolbar"><button onClick={()=>setSelected('')}>浏览历史角色</button><button disabled={loading} onClick={()=>setRevision(value=>value+1)}>刷新角色索引</button></div>
    {error&&<p role="alert">{error}</p>}<Diagnostics items={diagnostics}/>
    {!selected?<><label className="agent-history-search">搜索历史角色<input value={filter} onChange={event=>setFilter(event.target.value)} placeholder="角色名称或 ID"/></label>
      {loading&&<p role="status">正在读取历史角色…</p>}
      <div className="agent-history-roles">{shown.map(role=><button key={role.agentId} onClick={()=>setSelected(role.agentId)} data-testid="agent-history-role" data-agent-id={role.agentId}><strong>{role.name}</strong><small>{rolePresence(role.agentId,currentDefinitions,knowledgeReady)}</small><span>{role.sessionCount} 个 Session · {role.runCount} 次运行</span><code>{role.agentId}</code><small>最近记录：{time(role.updatedAt)}</small></button>)}</div>
      {!loading&&!error&&!shown.length&&<p>暂无匹配的历史角色。</p>}</>:<>
      <p className="agent-history-note"><code>{selected}</code> · {rolePresence(selected,currentDefinitions,knowledgeReady)}{currentDefinitions[selected]&&<> · 当前静态名称：{currentDefinitions[selected]}</>}</p>
      <AgentSessions key={JSON.stringify([workspaceId,selected])} workspaceId={workspaceId} agentId={selected}/>
    </>}
  </section>;
}

/** Session 与运行选择分层保存；切换角色/会话由 key 重建下层，不能沿用另一角色的日志游标。 */
function AgentSessions({workspaceId,agentId}:{workspaceId:string;agentId:string}){
  const sessions=useHistoryPage<AgentHistorySession>('agentHistory.sessions',{workspaceId,agentId},true),[chosen,setChosen]=useState('');
  const selected=sessions.page?.items.find(session=>session.sessionId===chosen);
  return <><div className="agent-history-toolbar"><h3>Session 记录</h3><button disabled={sessions.loading} onClick={()=>void sessions.refresh()}>刷新 Session</button></div>
    {sessions.error&&<p role="alert">{sessions.error}</p>}<Diagnostics items={sessions.page?.diagnostics??[]}/>
    <div className="agent-history-layout"><aside className="agent-history-sessions" aria-label="Agent Session 列表">
      {sessions.page?.items.map(session=><button className={chosen===session.sessionId?'selected':''} key={session.sessionId} aria-pressed={chosen===session.sessionId} onClick={()=>setChosen(session.sessionId)} data-testid="agent-history-session" data-session-id={session.sessionId}><strong>{session.title}</strong><small>{session.kind==='conversation'?'主对话通道':session.kind==='task'?'业务任务通道':'旧记录分组 · 未绑定通道'} · {session.runCount} 次运行</small><span>{statusNames[session.status]}</span><small>{time(session.updatedAt)}</small></button>)}
      {sessions.loading&&<p role="status">正在读取 Session…</p>}{!sessions.loading&&!sessions.error&&!sessions.page?.items.length&&<p>该角色尚无执行历史。</p>}
      {sessions.page?.nextCursor&&<button disabled={sessions.loading} onClick={()=>void sessions.more()}>加载更多 Session</button>}
    </aside><div className="agent-history-session-content">{selected?<SessionRuns key={selected.sessionId} session={selected}/>:<p className="agent-history-empty">选择一个 Session 查看独立运行记录。</p>}</div></div>
  </>;
}

function SessionRuns({session}:{session:AgentHistorySession}){
  const runs=useHistoryPage<AgentHistoryRun>('agentHistory.runs',{workspaceId:session.workspaceId,agentId:session.agentId,sessionId:session.sessionId},true),[chosen,setChosen]=useState('');
  const selected=runs.page?.items.find(run=>historyRunKey(run)===chosen);
  return <section aria-label="Session 执行轮次"><h3>{session.title}</h3><p className="agent-history-note">记录时角色：{session.agentName} · {time(session.startedAt)} 起</p>
    <details className="agent-history-identity"><summary>Session 归属</summary><dl><dt>历史分组 ID</dt><dd><code>{session.sessionId}</code></dd><dt>实例 ID</dt><dd>{session.agentInstanceId??'未绑定'}</dd><dt>运行通道 ID</dt><dd>{session.agentSessionId??'未绑定；旧记录分组不是运行通道'}</dd><dt>所属主会话</dt><dd>{session.rootSessionId??'未记录'}</dd></dl></details>
    <div className="agent-history-toolbar"><h4>运行轮次</h4><button disabled={runs.loading} onClick={()=>void runs.refresh()}>刷新轮次</button></div>
    {runs.error&&<p role="alert">{runs.error}</p>}<Diagnostics items={runs.page?.diagnostics??[]}/>
    <div className="agent-history-runs">{runs.page?.items.map(run=><button key={historyRunKey(run)} className={chosen===historyRunKey(run)?'selected':''} aria-pressed={chosen===historyRunKey(run)} onClick={()=>setChosen(historyRunKey(run))} data-testid="agent-history-run" data-run-id={run.runId} data-task-id={run.taskId}><strong>{run.goal}</strong><span>{statusNames[run.status]}</span><small>{time(run.startedAt)} · {run.moduleIds.length} 个模块</small><code>{run.runId}</code></button>)}</div>
    {runs.loading&&<p role="status">正在读取运行轮次…</p>}{!runs.loading&&!runs.error&&!runs.page?.items.length&&<p>此 Session 尚无可读取的运行。</p>}
    {runs.page?.nextCursor&&<button disabled={runs.loading} onClick={()=>void runs.more()}>加载更多轮次</button>}
    {selected?<SelectedRun key={historyRunKey(selected)} record={selected}/>:<p className="agent-history-empty">选择一个轮次后读取公开消息、工具与计划证据。</p>}
  </section>;
}

function SelectedRun({record}:{record:AgentHistoryRun}){
  const events=useHistoryEvents(record);
  return <section className="agent-history-run-detail" aria-label="历史运行详情" data-testid="agent-history-events"><div className="agent-history-toolbar"><h4>公开执行记录</h4><button disabled={events.loading} onClick={()=>void events.refresh()}>{events.projection.hasMore?'继续加载记录':'刷新本轮记录'}</button></div>
    {events.error&&<p role="alert">{events.error}</p>}{events.loading&&<p role="status">正在读取公开记录…</p>}
    <HistoryRunContent record={record} run={events.projection.run}/>
  </section>;
}

/** 只展示后端公开投影；输入和成员回注分别标识，计划证据仅展示引用，不以历史按钮执行任何操作。 */
export function HistoryRunContent({record,run}:{record:AgentHistoryRun;run?:RunSummary}){
  const inputs=run?transcript(run).filter(item=>item.kind==='user'||item.kind==='system'):[];
  return <><p>{record.goal}</p><p className="agent-history-note">记录时角色：{record.agentName} · {statusNames[record.status]} · 状态截至本次读取</p>
    <details className="agent-history-identity" open={record.binding==='legacy'}><summary>执行身份与历史配置</summary><dl><dt>静态角色 ID</dt><dd>{record.agentId}</dd><dt>任务 ID</dt><dd>{record.taskId}</dd><dt>运行 ID</dt><dd>{record.runId}</dd><dt>所属主会话</dt><dd>{record.rootSessionId??'未记录'}</dd><dt>执行实例</dt><dd>{record.agentInstanceId??'未绑定'}</dd><dt>运行通道</dt><dd>{record.agentSessionId??'未绑定'}</dd><dt>执行时配置版本</dt><dd>{record.configurationRevision??'未记录；不以当前配置代替'}</dd></dl>{record.binding==='legacy'&&<p>这是未绑定实例或通道的旧记录。历史分组键不是模型 Session，不按角色名称补造身份。</p>}</details>
    {record.moduleIds.length>0&&<details><summary>目标模块（{record.moduleIds.length}）</summary><ul>{record.moduleIds.map(id=><li key={id}><code>{id}</code></li>)}</ul></details>}
    {run&&<>{inputs.map(item=><section className="agent-history-input" key={item.id}><h5>{item.kind==='system'?'回注来源':record.source==='main'?'主会话输入':'任务输入'}</h5><MarkdownMessage text={item.text} workspaceId={record.workspaceId}/></section>)}<MemberRunTranscript run={run} workspaceId={record.workspaceId} memberName={record.agentName} active={false}/>
      {run.taskProgress&&<section className="agent-history-progress">
        <h4>计划与验收证据 · 版本 {run.taskProgress.version}</h4><p>{run.taskProgress.goal}</p>
        <ul>{run.taskProgress.acceptance.map((criterion,index)=><li key={index}>{criterion}</li>)}</ul>
        <ol>{run.taskProgress.steps.map(step=><li key={step.id}><strong>{step.title}</strong><p>{step.owner} · {step.state==='reported_done'?'已报告完成，待核验':step.state==='working'?'执行中':'待处理'}</p>{step.evidence.length>0&&<details><summary>{step.evidence.length} 条证据引用</summary>{step.evidence.map(id=><code key={id}>{id}</code>)}</details>}</li>)}</ol>
        {run.taskProgress.delivery&&<><h4>交付候选 · 尚未验收</h4><p>{run.taskProgress.delivery.summary}</p><ul>{run.taskProgress.delivery.limitations.map((item,index)=><li key={index}>{item}</li>)}</ul></>}
      </section>}
      {run.unresolvedTools.length>0&&<p role="status">有 {run.unresolvedTools.length} 项工具结果尚需核实；本页不恢复执行。</p>}
    </>}
  </>;
}
