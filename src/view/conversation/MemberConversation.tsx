/**
 * 作用定位：只读兼容旧长期子 Session 的任务、公开输出及工具记录。
 * 设计原因：旧记录保持原 task/run 归属；新 Agent 工具使用调用详情，不再创建频道。只挂载当前选中轮次，避免轮询全部历史。
 */
import {Icon} from '../components/Icon';
import {useEffect,useState} from 'react';
import type {GraphSnapshot,ScopeSummary} from '../../bridge/contracts/dispatch';
import {useMemberRun} from '../tasks/useMemberRun';
import {MemberRunTranscript} from '../tasks/MemberRunTranscript';
import {memberTaskLabel} from '../tasks/MemberActivity';
import {memberConversationTasks,type TeamConversation} from '../execution-view/team-conversations';
import './conversation-topics.css';

/** 选择仅决定读取哪个原运行；切换时 useMemberRun 丢弃上一身份的迟到响应。 */
export function MemberConversation({member,graph,scopes,active,onSelectTask,selectedTopicId,onSelectTopic}:{member:TeamConversation;graph?:GraphSnapshot;scopes:readonly ScopeSummary[];active:boolean;onSelectTask:(id:string)=>void;selectedTopicId?:string;onSelectTopic?:(id?:string)=>void}){
  const tasks=memberConversationTasks(member.session,graph),topics=scopes.filter(scope=>tasks.some(task=>task.scopeId===scope.scopeId));
  const [choice,setChoice]=useState<string>(),[taskChoice,setTaskChoice]=useState<string>(),[runChoice,setRunChoice]=useState<string>();
  const selected=topics.find(scope=>scope.scopeId===(selectedTopicId??choice))??topics.find(scope=>scope.status!=='closed')??topics.at(-1);
  useEffect(()=>{onSelectTopic?.(selected?.scopeId)},[selected?.scopeId,onSelectTopic]);
  const selectedTasks=tasks.filter(task=>selected?task.scopeId===selected.scopeId:!task.scopeId);
  const task=selectedTasks.find(task=>task.taskId===taskChoice)??selectedTasks.find(task=>task.activeRunId)??selectedTasks.at(-1);
  const runId=task?.runIds.includes(runChoice??'')?runChoice:task?.runIds.at(-1);
  const {run,loading,error,refresh}=useMemberRun(member.session.workspaceId,member.session.rootSessionId,task?.taskId??'',runId,!!task&&active,active);
  return <section className="member-conversation" aria-label={member.name+' 的对话'}>
    <header><h3>{member.name}</h3><p>执行 Agent 对话为只读，指令来自调用方 Agent，结果返回调用方。以下保留旧任务的真实记录。</p></header>
    {!!topics.length&&<label>话题<select value={selected?.scopeId??''} onChange={event=>{setChoice(event.target.value);onSelectTopic?.(event.target.value);setTaskChoice(undefined);setRunChoice(undefined)}}>{topics.map(scope=><option key={scope.scopeId} value={scope.scopeId}>{scope.status==='closed'?'历史 · ':''}{scope.objective??scope.inputPreview??scope.scopeId}</option>)}</select></label>}
    {!!selectedTasks.length&&<label>派发任务<select value={task?.taskId??''} onChange={event=>{setTaskChoice(event.target.value);setRunChoice(undefined)}}>{selectedTasks.map(task=><option key={task.taskId} value={task.taskId}>{memberTaskLabel(task)} · {task.goal}</option>)}</select></label>}
    {task?<><article className="member-assignment"><strong>{task.requester.name} → {member.name}</strong><p>{task.goal}</p>{!!task.acceptance.length&&<ul>{task.acceptance.map(item=><li key={item.id}>{item.text}</li>)}</ul>}<small>{memberTaskLabel(task)}</small><button onClick={()=>onSelectTask(task.taskId)}><Icon name="inspect" size={16}/>查看任务详情</button></article>
      {task.runIds.length>1&&<label>执行轮次<select value={runId} onChange={event=>setRunChoice(event.target.value)}>{task.runIds.map((id,index)=><option key={id} value={id}>第 {index+1} 轮{id===task.activeRunId?' · 正在执行':''}</option>)}</select></label>}
      {run?<MemberRunTranscript run={run} workspaceId={member.session.workspaceId} memberName={member.name} active={active}/>:<p role="status">{loading?'正在读取成员对话…':task.runIds.length?'选择对话后读取执行记录。':'主 Agent 已派发，等待执行。'}</p>}
      {task.result&&<article className="member-result"><strong>{member.name} → 主 Agent · 交付候选</strong><p>{task.result.summary}</p></article>}
    </>:<p>此成员尚未收到任务。</p>}
    {error&&<p role="alert">{error}<button onClick={()=>void refresh()}><Icon name="retry" size={16}/>重试读取</button></p>}
  </section>;
}
