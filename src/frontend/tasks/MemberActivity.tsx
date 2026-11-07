/**
 * 作用定位：在主对话中展示最近的成员任务与公开执行动态，并链接到对应任务节点详情。
 * 设计原因：执行成员输出保持原岗位署名和冻结模型，默认只展开最近一段公开回复；旧绑定缺省不猜岗位，检查点、求助和调度审计只读真实记录，停泊不显示成完成。
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
export function memberTaskLabel(task:TaskNode){const checkpoint=memberCheckpointView(task);return committedMemberCancellation(task)?memberCancellationLabel:committedMemberHelp(task)?'需要主调度协助':checkpoint.phase==='queued'?checkpointPhaseLabels.queued:task.status==='queued'&&task.activeRunId?'正在启动':memberTaskLabels[task.status]}

function MemberActivityCard({workspaceId,rootSessionId,task,onSelectTask,active}:{workspaceId:string;rootSessionId:string;task:TaskNode;onSelectTask:(id:string)=>void;active:boolean}){
  const [expanded,setExpanded]=useState(false),latest=task.runIds.at(-1),cancellation=committedMemberCancellation(task);
  const {run,loading,error,refresh}=useMemberRun(workspaceId,rootSessionId,task.taskId,latest,true,active);
  return <article className="member-activity-card" aria-label={'成员任务 · '+task.assignee.name}>
    <header><span className="member-avatar"><Icon name="team" size={17}/></span><div><strong>{task.assignee.name}</strong><span className="member-role-caption">执行 Agent</span></div><span className={'member-state '+task.status}>{task.status==='running'&&<span className="work-spinner"/>}{memberTaskLabel(task)}</span></header>
    <p className="member-task-goal">{task.goal}</p>
    <MemberOwnerNotice task={task} compact/>
    <MemberHelpNotice task={task} runId={latest} compact/>
    <MemberCancellationNotice task={task} compact/>
    <MemberDependencyNotice task={task} compact/>
    <MemberCheckpointNotice task={task} compact/>
    {run?<div className={'member-card-stream'+(expanded?' expanded':'')}><MemberRunTranscript run={run} workspaceId={workspaceId} memberName={task.assignee.name} compact={!expanded} active={active}/></div>:!cancellation&&<p className="member-muted">{loading?'正在读取成员动态…':latest?'尚未读取该轮公开执行记录。':task.status==='cancelled'?'没有登记的执行轮次，取消状态本身不能证明未执行。':task.waitReason||'任务已派发，尚未开始执行。'}</p>}
    {error&&<p className="member-error" role="alert">{error}<button onClick={()=>void refresh()}>重试读取</button></p>}
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
