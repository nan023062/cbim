/**
 * 作用定位：展示任务图选中成员的公开运行正文、工具过程、计划与候选，并处理该成员的独立审批、问题和停止请求。
 * 设计原因：按工作区/主会话/任务/轮次隔离独立执行成员的观察；实例与通道可核实，显式操作不混入主调度会话，也不把审批解释成业务验收。
 */
import {useEffect,useRef,useState} from 'react';
import type {TaskNode} from '../../bridge/contracts/dispatch';
import type {PendingQuestion} from '../../bridge/contracts/execution';
import type {ChatApproval} from '../../bridge/contracts/chat';
import {QuestionCard} from '../conversation/QuestionCard';
import {useMemberRun} from './useMemberRun';
import {MemberRunTranscript} from './MemberRunTranscript';
import {memberTaskLabel} from './MemberActivity';
import './member-activity.css';

/** 轮次切换在内部重建操作状态，保证晚到审批结果不能修改后来选中的成员界面。 */
export function MemberTaskDetail({workspaceId,rootSessionId,task,onBack,active=true}:{workspaceId:string;rootSessionId:string;task:TaskNode;onBack?:()=>void;active?:boolean}){
  const [selected,setSelected]=useState('');
  const runId=task.runIds.includes(selected)?selected:task.runIds.at(-1);
  const valid=task.identity.workspaceId===workspaceId&&task.identity.rootSessionId===rootSessionId;
  return <section className="member-task-detail" aria-label={'成员任务详情 · '+task.assignee.name}>
    <header className="member-detail-heading"><div><span className="member-role-caption">执行 Agent</span><h3>{task.assignee.name}</h3></div>{onBack&&<button onClick={onBack}>返回任务图</button>}</header>
    {!valid?<p className="member-error" role="alert">所选任务不属于当前会话，请返回任务图重新选择。</p>:<>
      <span className={'member-state '+task.status}>{memberTaskLabel(task)}</span><h4>任务目标</h4><p className="member-detail-goal">{task.goal}</p>
      <details className="member-scope"><summary>实例与执行通道</summary><p>执行实例 <code>{task.assignee.agentInstanceId}</code></p><p>业务任务通道 <code>{task.assignee.agentSessionId}</code></p></details>
      {task.waitReason&&<p className="member-warning">{task.waitReason}</p>}
      <details className="member-scope"><summary>涉及 {task.modules.length} 个模块 · 计划版本 {task.planRevision}</summary><ul>{task.modules.map(module=><li key={module.moduleId}><strong>{module.name}</strong><code>{module.moduleId}</code><small>{module.workflow.kind==='general'?'通用流程':module.workflow.id}</small></li>)}</ul></details>
      <details className="member-scope"><summary>验收要求</summary><ul>{task.acceptance.map(item=><li key={item.id}>{item.text}</li>)}</ul></details>
      {!!task.runIds.length&&<label className="member-run-selector">执行轮次<select aria-label="成员执行轮次" value={runId} onChange={event=>setSelected(event.target.value)}>{task.runIds.map((id,index)=><option key={id} value={id}>第 {index+1} 次 · {id.slice(0,8)}{id===task.activeRunId?' · 当前执行':''}</option>)}</select></label>}
      {runId?<MemberRunDetail key={JSON.stringify([workspaceId,rootSessionId,task.taskId,runId])} workspaceId={workspaceId} rootSessionId={rootSessionId} task={task} runId={runId} active={active}/>:<p className="member-muted">该任务尚未产生执行轮次。</p>}
      {task.result&&<section className="member-result"><h4>交付候选 · 尚未验收</h4><p>{task.result.summary}</p>{!!task.result.limitations.length&&<><h5>未验证限制</h5><ul>{task.result.limitations.map((item,index)=><li key={index}>{item}</li>)}</ul></>}<details><summary>{task.result.evidenceRefs.length} 条证据引用</summary>{task.result.evidenceRefs.map(id=><code key={id}>{id}</code>)}</details></section>}
    </>}
  </section>;
}

/** 外层以四层身份作为 React key；历史轮次只读，审批和停止只作用于当前活动轮次。 */
function MemberRunDetail({workspaceId,rootSessionId,task,runId,active}:{workspaceId:string;rootSessionId:string;task:TaskNode;runId:string;active:boolean}){
  const identity={workspaceId,rootSessionId,taskId:task.taskId},current=task.activeRunId===runId;
  const {run,loading,hasMore,error,refresh}=useMemberRun(workspaceId,rootSessionId,task.taskId,runId,true,active);
  const [approvals,setApprovals]=useState<ChatApproval[]>([]),[questions,setQuestions]=useState<PendingQuestion[]>([]),[interactionError,setInteractionError]=useState(''),[operationError,setOperationError]=useState(''),[busy,setBusy]=useState(false);
  const lock=useRef(false),alive=useRef(true),refreshInteractions=useRef<()=>Promise<void>>(async()=>{});
  // 页签隐藏只改变下一次读取间隔，保留用户尚未提交的问题答案与审批上下文。
  const activeRef=useRef(active);activeRef.current=active;
  useEffect(()=>{alive.current=true;return()=>{alive.current=false}},[]);
  useEffect(()=>{
    let stopped=false,timer:ReturnType<typeof setTimeout>|undefined,inFlight:Promise<void>|undefined;
    setApprovals([]);setQuestions([]);setInteractionError('');
    async function poll(){
      if(stopped||!current)return;if(inFlight)return inFlight;clearTimeout(timer);
      inFlight=(async()=>{
        try{
          const [nextApprovals,nextQuestions]=await Promise.all([window.cbim.call('dispatch.approvals',identity),window.cbim.call('dispatch.questions',identity)]);
          if(stopped)return;
          setApprovals(old=>JSON.stringify(old)===JSON.stringify(nextApprovals)?old:nextApprovals);setQuestions(old=>JSON.stringify(old)===JSON.stringify(nextQuestions)?old:nextQuestions);setInteractionError('');
        }catch(cause){if(!stopped)setInteractionError(cause instanceof Error?cause.message:'成员交互读取失败，请重试')}
        finally{inFlight=undefined;if(!stopped)timer=setTimeout(()=>void poll(),!activeRef.current||document.visibilityState==='hidden'?5000:1000)}
      })();return inFlight;
    }
    refreshInteractions.current=poll;if(current)void poll();
    return()=>{stopped=true;clearTimeout(timer);refreshInteractions.current=async()=>{}};
  },[workspaceId,rootSessionId,task.taskId,runId,current]);
  useEffect(()=>{if(active)void refreshInteractions.current()},[active]);
  /** 串行提交本成员操作并刷新观察；失败继续抛给问题卡，卸载不会撤销已提交的后端操作。 */
  async function operate(action:string,args:Record<string,unknown>){
    if(lock.current)throw Error('正在处理另一项成员操作，请稍后重试');lock.current=true;setBusy(true);setOperationError('');
    try{await window.cbim.call(action,{...identity,...args});await refreshInteractions.current();await refresh()}
    catch(cause){if(alive.current)setOperationError(cause instanceof Error?cause.message:'成员操作失败，请重试');throw cause}
    finally{lock.current=false;if(alive.current)setBusy(false)}
  }
  return <div className="member-run-detail">
    {current&&<div className="member-run-actions"><button disabled={busy} onClick={()=>void operate('dispatch.executionStop',{}).catch(()=>{})}>停止成员执行</button><small>仅停止此任务，不回滚已完成操作</small></div>}
    {(error||interactionError||operationError)&&<div className="member-error" role="alert">{operationError||error||interactionError}<button onClick={()=>{setOperationError('');void refresh();void refreshInteractions.current()}}>重新读取</button></div>}
    {loading&&<p role="status" className="member-muted">正在读取成员执行记录…</p>}
    {hasMore&&<p role="status" className="member-muted">正在加载后续记录…</p>}
    {current&&approvals.map(approval=><section className="member-approval" key={approval.id} aria-label="成员操作确认"><strong>允许 {task.assignee.name} 执行 {approval.name}？</strong><pre>{JSON.stringify(approval.input,null,2)}</pre><div><button disabled={busy} onClick={()=>void operate('dispatch.approve',{approvalId:approval.id,allow:true}).catch(()=>{})}>允许一次</button><button disabled={busy} title="仅当前成员的本次运行有效，不影响主会话或其它成员" onClick={()=>void operate('dispatch.approve',{approvalId:approval.id,allow:true,allowAll:true}).catch(()=>{})}>本次任务全部通过</button><button disabled={busy} onClick={()=>void operate('dispatch.approve',{approvalId:approval.id,allow:false}).catch(()=>{})}>拒绝</button></div></section>)}
    {current&&questions.map(question=><QuestionCard key={question.id} request={question} onAnswer={answers=>operate('dispatch.answerQuestion',{questionId:question.id,answers})}/>)}
    {run&&<>
      <MemberRunTranscript run={run} workspaceId={workspaceId} memberName={task.assignee.name} active={active}/>
      {run.taskProgress&&<details className="member-progress"><summary>本轮计划与步骤 · 版本 {run.taskProgress.version}</summary><ol>{run.taskProgress.steps.map(step=><li key={step.id}><strong>{step.title}</strong><span>{step.owner} · {step.state==='reported_done'?'已报告完成，待核验':step.state==='working'?'执行中':'待执行'}</span>{!!step.evidence.length&&<details><summary>{step.evidence.length} 条工具证据</summary>{step.evidence.map(id=><code key={id}>{id}</code>)}</details>}</li>)}</ol></details>}
      {!!run.unresolvedTools.length&&<p className="member-warning">有 {run.unresolvedTools.length} 项操作结果尚需核实。当前不自动续接异常成员通道。</p>}
    </>}
  </div>;
}
