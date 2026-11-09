/**
 * 作用定位：展示成员任务与公开执行动态，并提供派发工具旁的紧凑内联形式及原任务详情入口。
 * 设计原因：执行成员输出保持原岗位署名和冻结模型，默认只展开最近一段公开回复；检查点显式放弃与普通取消分开标记，旧绑定缺省不猜岗位，调度审计不冒充业务完成。
 */
import {useState} from 'react';
import type {TaskNode} from '../../bridge/contracts/dispatch';
import {Icon} from '../components/Icon';
import {useMemberRun} from './useMemberRun';
import {MemberRunTranscript} from './MemberRunTranscript';
import {MemberHelpNotice} from './MemberHelpNotice';
import {committedMemberHelp} from './member-help-state';
import {MemberCancellationNotice} from './MemberCancellationNotice';
import {MemberDependencyNotice} from './MemberDependencyNotice';
import {MemberCheckpointNotice} from './MemberCheckpointNotice';
import {MemberOwnerNotice} from './OwnerExecutionDetails';
import {memberCheckpointView,checkpointPhaseLabels} from './member-checkpoint-state';
import {committedMemberCancellation,memberCancellationLabel} from './member-cancellation-state';
import './member-activity.css';

export const memberTaskLabels:Record<TaskNode['status'],string>={planned:'待安排',queued:'待执行',running:'正在执行',waiting:'等待前置任务',checkpointed:'已保存检查点',result_ready:'交付待审阅',blocked:'需要处理',failed:'执行失败',cancelled:'已停止',interrupted:'执行中断'};
/** 求助与未启动撤销必须有可信记录；普通 cancelled 仍只表示已停止，已领取 queued 只表示启动中。 */
export function memberTaskLabel(task:TaskNode){const checkpoint=memberCheckpointView(task);return committedMemberCancellation(task)?memberCancellationLabel:committedMemberHelp(task)?'需要主调度协助':checkpoint.phase==='abandoned'?checkpointPhaseLabels.abandoned:checkpoint.phase==='queued'?checkpointPhaseLabels.queued:task.status==='queued'&&task.activeRunId?'正在启动':memberTaskLabels[task.status]}

/** 内联形式折叠时不读取成员日志；展开只观察公开过程，不重放派发或改变任务。 */
export function MemberActivityCard({workspaceId,rootSessionId,task,onSelectTask,active,inline=false}:{workspaceId:string;rootSessionId:string;task:TaskNode;onSelectTask:(id:string)=>void;active:boolean;inline?:boolean}){
  const [expanded,setExpanded]=useState(false),latest=task.runIds.at(-1),cancellation=committedMemberCancellation(task);
  const {run,loading,error,refresh}=useMemberRun(workspaceId,rootSessionId,task.taskId,latest,!inline||expanded,active);
  const body=<>
    <MemberOwnerNotice task={task} compact/>
    <MemberHelpNotice task={task} runId={latest} compact/>
    <MemberCancellationNotice task={task} compact/>
    <MemberDependencyNotice task={task} compact/>
    <MemberCheckpointNotice task={task} compact/>
    {run?<div className={'member-card-stream'+(expanded?' expanded':'')}><MemberRunTranscript run={run} workspaceId={workspaceId} memberName={task.assignee.name} compact={!expanded} active={active}/></div>:!cancellation&&<p className="member-muted">{loading?'正在读取成员动态…':latest?'尚未读取该轮公开执行记录。':task.status==='cancelled'?'没有登记的执行轮次，取消状态本身不能证明未执行。':task.waitReason||'任务已派发，尚未开始执行。'}</p>}
    {error&&<p className="member-error" role="alert">{error}<button onClick={()=>void refresh()}>重试读取</button></p>}
  </>;
  if(inline)return <div className="inline-member" data-member-task-id={task.taskId}>
    <div className="inline-member-heading"><span>{task.assignee.name} · </span><span className={'member-state '+task.status}>{memberTaskLabel(task)}{task.status==='result_ready'?' · 尚未验收':''}</span><button onClick={()=>onSelectTask(task.taskId)}>查看任务详情</button></div>
    <p className="inline-member-goal">{task.goal}</p>
    {task.waitReason&&<p className="inline-member-note">{task.waitReason}</p>}
    {task.result&&task.status==='result_ready'&&<p className="inline-member-note">{task.result.summary} · 证据引用 {task.result.evidenceRefs.length} 项</p>}
    <button className="inline-member-toggle" aria-expanded={expanded} onClick={()=>setExpanded(value=>!value)}>{expanded?'收起成员过程':'展开成员过程'}</button>
    {expanded&&<div className="inline-member-body">{body}</div>}
  </div>;
  return <article className="member-activity-card" aria-label={'成员任务 · '+task.assignee.name}>
    <header><span className="member-avatar"><Icon name="team" size={17}/></span><div><strong>{task.assignee.name}</strong><span className="member-role-caption">执行 Agent</span></div><span className={'member-state '+task.status}>{task.status==='running'&&<span className="work-spinner"/>}{memberTaskLabel(task)}</span></header>
    <p className="member-task-goal">{task.goal}</p>{body}
    <footer>{run&&<button aria-expanded={expanded} onClick={()=>setExpanded(value=>!value)}>{expanded?'收起过程':'展开过程'}</button>}<button onClick={()=>onSelectTask(task.taskId)}>查看任务详情 <Icon name="chevron" size={13}/></button></footer>
  </article>;
}
/** 限制同时观察的卡片数量；其余任务由图视图按需打开，避免每个任务各起一个常驻轮询。 */
export function MemberActivity({workspaceId,rootSessionId,tasks,onSelectTask,onViewAll,active=true}:{workspaceId:string;rootSessionId:string;tasks:TaskNode[];onSelectTask:(id:string)=>void;onViewAll?:()=>void;active?:boolean}){
  const local=tasks.filter(task=>task.identity.workspaceId===workspaceId&&task.identity.rootSessionId===rootSessionId);
  if(!local.length)return null;
  const latest=[...local].sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||b.taskId.localeCompare(a.taskId)).slice(0,3);
  return <section className="member-activity" aria-label="团队成员执行动态"><div className="member-activity-heading"><span><Icon name="team" size={16}/>成员动态 · {local.length} 项任务</span><button onClick={()=>onViewAll?onViewAll():onSelectTask(latest[0].taskId)}>查看全部任务</button></div>{latest.map(task=><MemberActivityCard key={[workspaceId,rootSessionId,task.taskId].join(':')} workspaceId={workspaceId} rootSessionId={rootSessionId} task={task} onSelectTask={onSelectTask} active={active}/>)}</section>;
}
