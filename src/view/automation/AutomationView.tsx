/**
 * 作用定位：对话内固定工作区自动化页签，展示任务列表、配置和真实运行历史。
 * 设计原因：实例隔离异步回包；后台只读轮询不重试写操作。新定义固定 ID 供未知保存核实；历史打开原会话，执行结束不冒称业务验收。
 */
import {useCallback,useEffect,useRef,useState} from 'react';
import type {Snapshot,WorkspaceView} from '../../bridge/contracts/workspace';
import type {AutomationCatalog,AutomationDefinition,AutomationJob,AutomationRunStatus,AutomationState} from '../../bridge/contracts/automation';
import {AutomationEditor} from './AutomationEditor';
import './automation.css';
const api=window.cbim;
const labels:Record<AutomationRunStatus,string>={starting:'正在准备',running:'执行中',waiting:'等待处理',completed:'执行已结束',failed:'执行失败',cancelled:'已取消',interrupted:'已中断',unknown:'待核实',skipped:'已跳过'};
const time=(value?:string)=>value?new Date(value).toLocaleString():'—';
function scheduleLabel(job:AutomationJob){const s=job.definition.schedule;return s.kind==='manual'?'手动运行':s.kind==='interval'?`每 ${s.minutes} 分钟`:s.kind==='daily'?`每天 ${s.time}（${s.timezone}）`:'指定时间一次'}
const newDefinition=():AutomationDefinition=>({name:'',enabled:true,executor:{kind:'main'},moduleIds:[],workflowSelections:[],skillIds:[],prompt:'',permission:'read',schedule:{kind:'manual'}});

export function AutomationView({workspace,active=true,onOpenRun}:{workspace:WorkspaceView;snapshot?:Snapshot;active?:boolean;onOpenRun?:(taskId:string,title:string)=>void}){
 const [state,setState]=useState<AutomationState>(),[catalog,setCatalog]=useState<AutomationCatalog>(),[selected,setSelected]=useState(''),[editing,setEditing]=useState<{id:string;revision:number;definition:AutomationDefinition}>(),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const mounted=useRef(true),gate=useRef(false);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false}},[]);
 const load=useCallback(async()=>{
  if(workspace.state!=='running'||!workspace.instanceId)return;
  const identity={workspaceId:workspace.id,instanceId:workspace.instanceId};
  const [next,choices]=await Promise.all([api.call('automation.list',identity),api.call('automation.catalog',identity)]);
  if(mounted.current){setState(next);setCatalog(choices)}
 },[workspace.id,workspace.instanceId,workspace.state]);
 useEffect(()=>{if(!active)return;let cancelled=false,reading=false;const poll=async()=>{if(reading)return;reading=true;try{await load()}catch(e){if(!cancelled&&mounted.current)setError(String(e))}finally{reading=false}};void poll();const timer=setInterval(()=>void poll(),5000);return()=>{cancelled=true;clearInterval(timer)}},[active,load]);
 async function act(work:()=>Promise<unknown>){
  if(gate.current)return;gate.current=true;setBusy(true);setError('');
  try{await work();await load()}catch(e){if(mounted.current)setError(String(e)+'。请刷新核实原记录；系统未自动重试。')}finally{gate.current=false;if(mounted.current)setBusy(false)}
 }
 const identity={workspaceId:workspace.id,instanceId:workspace.instanceId!};
 const job=state?.jobs.find(j=>j.id===selected),runs=(state?.runs??[]).filter(r=>!selected||r.automationId===selected).slice().reverse();
 function choose(id:string){if(editing&&!confirm('放弃尚未保存的自动化设置？'))return;setEditing(undefined);setSelected(id)}
 function edit(){if(job)setEditing({id:job.id,revision:job.revision,definition:structuredClone(job.definition)})}
 function create(){if(editing&&!confirm('放弃尚未保存的自动化设置？'))return;setSelected('');setEditing({id:crypto.randomUUID(),revision:0,definition:newDefinition()})}
 return <div className="view-page workspace-automation" data-workspace-id={workspace.id}>
  <div className="view-heading"><div><p className="overline">{workspace.name} / 团队</p><h1>自动化</h1><p>配置任务、查看计划和运行结果。</p></div><button disabled={busy||!catalog} onClick={create}>新建自动化</button></div>
  <p className="inline-note">仅在 CBIM 运行且当前工作区打开时触发，关闭期间错过的时间不补跑，同一任务不重叠运行。暂停或删除会停止该自动化当前的执行。</p>
  {error&&<p role="alert">{error}</p>}{workspace.state!=='running'?<p>打开工作区后可管理自动化。</p>:!state?<p>正在加载…</p>:<div className="automation-layout">
   <nav className="automation-list" aria-label="自动化任务"><button className={!selected?'selected':''} onClick={()=>choose('')}>全部运行记录</button>{state.jobs.map(item=><button key={item.id} className={selected===item.id?'selected':''} onClick={()=>choose(item.id)}><strong>{item.definition.name}</strong><small>{item.definition.enabled?'已启用':'已暂停'} · {scheduleLabel(item)}</small></button>)}{!state.jobs.length&&<p>还没有自动化任务。</p>}</nav>
   <div className="automation-detail">{editing&&catalog?<AutomationEditor key={editing.id} initial={editing.definition} catalog={catalog} busy={busy} onCancel={()=>setEditing(undefined)} onSave={definition=>void act(async()=>{const saved=await api.call('automation.save',{...identity,id:editing.id,expectedRevision:editing.revision,definition});if(mounted.current){setEditing(undefined);setSelected(saved.id)}})}/>:<>
    {job&&<section><h2>{job.definition.name}</h2><p>{scheduleLabel(job)} · 下次执行：{time(job.nextRunAt)}</p><p>{job.definition.executor.kind==='main'?'默认 Agent（主 Agent）':catalog?.agents.find(a=>job.definition.executor.kind==='member'&&a.memberId===job.definition.executor.memberId)?.name??'原团队岗位（请核实配置）'} · {job.definition.permission==='read'?'只读':job.definition.permission==='ask'?'写入前请求批准':'允许执行和写入'}</p><p className="automation-prompt">{job.definition.prompt}</p><div className="automation-actions">
     <button disabled={busy||runs.some(r=>['starting','running','waiting','unknown'].includes(r.status))} onClick={()=>void act(()=>api.call('automation.run',{...identity,id:job.id,expectedRevision:job.revision}))}>立即运行</button><button disabled={busy} onClick={edit}>编辑</button><button disabled={busy} onClick={()=>void act(()=>api.call('automation.toggle',{...identity,id:job.id,expectedRevision:job.revision,enabled:!job.definition.enabled}))}>{job.definition.enabled?'暂停':'启用'}</button><button disabled={busy} onClick={()=>{if(confirm('删除此自动化并停止当前运行？历史记录仍保留。'))void act(async()=>{await api.call('automation.remove',{...identity,id:job.id,expectedRevision:job.revision});setSelected('')})}}>删除</button>
    </div></section>}
    <section><h2>运行历史</h2><p>执行结束不代表业务验收通过，请查看对应会话的目标和证据。</p><button disabled={busy} onClick={()=>void act(load)}>刷新记录</button>{runs.map(run=><article className="automation-run" key={run.id}><div><strong>{labels[run.status]}</strong><span>{run.definition.name}</span></div><p>{time(run.startedAt)} · {run.trigger==='manual'?'手动':'计划触发'}{run.finishedAt?' · 结束于 '+time(run.finishedAt):''}</p>{run.message&&<p>{run.message}</p>}{run.taskId&&onOpenRun&&<button onClick={()=>onOpenRun(run.taskId!,run.definition.name)}>打开对应会话</button>}</article>)}{!runs.length&&<p>暂无运行记录。</p>}</section>
   </>}</div>
  </div>}
 </div>;
}
