/**
 * 作用定位：展示一个长期子 Session 在各话题中的派发、公开输出及工具记录。
 * 设计原因：正文仍使用原 task/run 增量流；只观察每位已访问成员的选中轮次，隐藏后降频并保留正文/阅读位置，防止轮询全部历史。本视图只读；补充需求显式导航所属主频道，绝不挂载隐式转发输入框。
 */
import {useEffect,useRef,useState} from 'react';
import type {GraphSnapshot,ScopeSummary} from '../../bridge/contracts/dispatch';
import {useMemberRun} from '../tasks/useMemberRun';
import {MemberRunTranscript} from '../tasks/MemberRunTranscript';
import {memberTaskLabel} from '../tasks/MemberActivity';
import {ToolTimeline} from '../execution-view/ToolTimeline';
import {memberConversationTasks,type TeamConversation} from '../execution-view/team-conversations';
import './conversation-topics.css';

/** 选择仅决定读取哪个原运行；切换时 useMemberRun 丢弃上一身份的迟到响应。 */
export function MemberConversation({member,graph,scopes,active,onSelectTask,selectedTopicId,onOpenChannel}:{member:TeamConversation;graph?:GraphSnapshot;scopes:readonly ScopeSummary[];active:boolean;onSelectTask:(id:string)=>void;selectedTopicId?:string;onOpenChannel?:(id?:string)=>void}){
  const tasks=memberConversationTasks(member.session,graph),topics=scopes.filter(scope=>tasks.some(task=>task.scopeId===scope.scopeId));
  const [choice,setChoice]=useState<string>(),[taskChoice,setTaskChoice]=useState<string>(),[runChoice,setRunChoice]=useState<string>();
  const selected=topics.find(scope=>scope.scopeId===(choice??selectedTopicId))??topics.find(scope=>scope.status!=='closed')??topics.at(-1);
  const visited=useRef(false);if(active)visited.current=true;
  // 首次查看确定自己的频道选择；之后主聊天切换频道不能改写成员正在审阅的位置。
  useEffect(()=>{if(active&&choice===undefined&&selected)setChoice(selected.scopeId)},[active,choice,selected?.scopeId]);
  const selectedTasks=tasks.filter(task=>selected?task.scopeId===selected.scopeId:!task.scopeId);
  const task=selectedTasks.find(task=>task.taskId===taskChoice)??selectedTasks.find(task=>task.activeRunId)??selectedTasks.at(-1);
  const runId=task?.runIds.includes(runChoice??'')?runChoice:task?.runIds.at(-1);
  const {run,loading,error,refresh}=useMemberRun(member.session.workspaceId,member.session.rootSessionId,task?.taskId??'',runId,!!task&&visited.current,active);
  return <section className="member-conversation" aria-label={member.name+' 的工作审阅'}>
    <header><h3>{member.name}</h3><p>只读工作审阅 · 按所属频道查看任务、工具与公开执行记录。</p>{onOpenChannel&&<button onClick={()=>onOpenChannel(selected?.scopeId)}>返回所属主频道补充需求</button>}</header>
    {!!topics.length&&<label>话题<select value={selected?.scopeId??''} onChange={event=>{setChoice(event.target.value);setTaskChoice(undefined);setRunChoice(undefined)}}>{topics.map(scope=><option key={scope.scopeId} value={scope.scopeId}>{scope.status==='closed'?'历史 · ':''}{scope.objective??scope.inputPreview??scope.scopeId}</option>)}</select></label>}
    {!!selectedTasks.length&&<label>派发任务<select value={task?.taskId??''} onChange={event=>{setTaskChoice(event.target.value);setRunChoice(undefined)}}>{selectedTasks.map(task=><option key={task.taskId} value={task.taskId}>{memberTaskLabel(task)} · {task.goal}</option>)}</select></label>}
    {task?<><article className="member-assignment"><strong>{task.requester.name} → {member.name}</strong><p>{task.goal}</p>{!!task.acceptance.length&&<ul>{task.acceptance.map(item=><li key={item.id}>{item.text}</li>)}</ul>}<small>{memberTaskLabel(task)}</small><button onClick={()=>onSelectTask(task.taskId)}>查看任务详情</button></article>
      {task.runIds.length>1&&<label>执行轮次<select value={runId} onChange={event=>setRunChoice(event.target.value)}>{task.runIds.map((id,index)=><option key={id} value={id}>第 {index+1} 轮{id===task.activeRunId?' · 正在执行':''}</option>)}</select></label>}
      {run?<><MemberRunTranscript run={run} workspaceId={member.session.workspaceId} memberName={member.name} active={active}/><details className="member-reasoning"><summary>思考与执行说明（公开记录）</summary><p>{run.taskProgress?.reason??'本轮未提供公开思考说明；私有推理不在运行记录中展示。'}</p></details><details className="member-tools"><summary>工具与公开执行记录</summary><ToolTimeline run={run}/></details></>:<p role="status">{loading?'正在读取成员工作记录…':task.runIds.length?'选择轮次后读取执行记录。':'主 Agent 已派发，等待执行。'}</p>}
      {task.result&&<article className="member-result"><strong>{member.name} → 主 Agent · 交付候选</strong><p>{task.result.summary}</p></article>}
    </>:<p>此成员尚未收到任务。</p>}
    {error&&<p role="alert">{error}<button onClick={()=>void refresh()}>重试读取</button></p>}
  </section>;
}
