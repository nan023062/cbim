/**
 * 作用定位：当前会话的任务视图，展示持久化目标、步骤责任、证据引用、交付候选和执行轮次。
 * 设计原因：复用对话已经读取的记录，不查询项目全量任务；双重身份过滤防止切换会话时展示旧响应。
 * 边界：完成声明与待审阅不代表业务验收通过；普通问答没有计划时不虚构步骤。
 */
import type {RunSummary} from '../../bridge/contracts/execution';
import type {QueuedMessage} from '../../bridge/contracts/execution';
import {WorkStatus} from '../conversation/WorkStatus';
import {MessageQueue} from '../conversation/MessageQueue';
/** 只接收当前工作区、当前会话的记录；草稿会话没有 taskId，因此没有运行历史。 */
export function sessionRuns(runs:RunSummary[],workspaceId:string,taskId?:string){return taskId?runs.filter(r=>r.task.workspaceId===workspaceId&&r.task.taskId===taskId):[]}
export function SessionTaskView({workspaceId,taskId,runs,queued,now,busy,onQueueChange,onQueueContinue,onChat,onStop}:{workspaceId:string;taskId?:string;runs:RunSummary[];queued:QueuedMessage[];now:number;busy:boolean;onQueueChange:(id:string,action:string)=>void;onQueueContinue:()=>void;onChat:()=>void;onStop:()=>void}){
 const history=sessionRuns(runs,workspaceId,taskId),pending=taskId?queued.filter(q=>q.taskId===taskId):[];
 const progress=history.at(-1)?.taskProgress;
 return <div className="session-task-view"><header><div><h2>任务视图</h2><p>仅显示当前会话 · {history.length} 次执行 · {pending.length} 条待执行</p></div><button onClick={onChat}>返回对话</button></header>
 {!taskId&&<p>发送第一条消息后，在这里查看本会话的执行进度。</p>}
 {progress&&<article className="session-run" aria-label="执行计划"><h3>{progress.goal}</h3><p>计划版本 {progress.version} · {progress.state==='awaiting_review'?'交付待审阅':'执行与验证中'} · 尚未业务验收</p><p>{progress.reason}</p><ol>{progress.steps.map(step=><li key={step.id}><strong>{step.title}</strong> · {step.owner} · {{pending:'待处理',working:'进行中',reported_done:'已报告完成，待核验'}[step.state]}{step.evidence.length>0&&<details><summary>{step.evidence.length} 条工具回执</summary>{step.evidence.map(id=><p key={id}><code>{id}</code></p>)}</details>}</li>)}</ol><h4>验收要求</h4><ul>{progress.acceptance.map((item,i)=><li key={i}>{item}</li>)}</ul>{progress.delivery&&<><h4>交付候选</h4><p>{progress.delivery.summary}</p><ul>{progress.delivery.limitations.map((item,i)=><li key={i}>{item}</li>)}</ul></>}<details><summary>计划修订记录</summary>{history.flatMap(run=>run.events.filter(e=>e.type==='task.updated').map(e=><p key={run.runId+':'+e.seq}>{e.time} · {String((e.data.progress as {reason?:string})?.reason??'计划更新')}</p>))}</details></article>}
 <MessageQueue items={pending} busy={busy} onChange={onQueueChange} onContinue={onQueueContinue}/>
 {[...history].reverse().map((run,i)=><article className="session-run" key={run.runId}><h3>{String(run.events.find(e=>e.type==='run.started')?.data.message||run.task.goal).split('\n')[0]}</h3><small>第 {history.length-i} 次执行 · {run.events[0]?.time?new Date(run.events[0].time).toLocaleString():''}</small><WorkStatus run={run} now={now}/>{run.status==='running'&&<button disabled={busy} onClick={onStop}>停止本次执行</button>}{run.unresolvedTools.length>0&&<p role="alert">有 {run.unresolvedTools.length} 项操作尚需在对话中核实。</p>}<details><summary>执行标识</summary><code>{run.runId}</code></details></article>)}
 {taskId&&!history.length&&<p>当前会话暂无可显示的执行记录。</p>}
 </div>;
}
