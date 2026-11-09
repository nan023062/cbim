/**
 * 作用定位：在对话正文中展示主 Agent 的计划、成员派发／依赖、候选证据与审阅。
 * 设计原因：最近关键节点默认可见，较早节点和长说明可展开；展示复用真实图和周期状态，不把候选或完成申请当作目标完成。
 */
import type {GraphIdentity,GraphSnapshot,PublicDispatchScope,ScopeSummary} from '../../bridge/contracts/dispatch';
import {conversationProgress,type ConversationProgressItem} from './conversation-progress';
import {scopeGoalView} from '../tasks/scope-state';
import './conversation-progress.css';

function ProgressItem({item,onSelectTask}:{item:ConversationProgressItem;onSelectTask:(id:string)=>void}){
  const lines=item.lines.filter(Boolean),preview=lines.slice(0,3);
  return <li className={'conversation-progress-item '+item.tone} data-progress-id={item.id}>
    <strong>{item.title}</strong>{preview.map((line,index)=><div className="progress-line" key={index}>{line.length>300?<><span>{line.slice(0,300)}…</span><details><summary>展开完整说明</summary><p>{line}</p></details></>:line}</div>)}
    {lines.length>3&&<details><summary>展开另外 {lines.length-3} 条说明</summary>{lines.slice(3).map((line,index)=><p key={index}>{line}</p>)}</details>}
    {item.taskId&&<button className="progress-task-link" onClick={()=>onSelectTask(item.taskId!)}>查看任务详情</button>}
  </li>;
}
/** scope 与 summary 是原 Hook 同步的选中目标；历史选择明确标记，不影响当前发送与运行状态。 */
export function ConversationProgress({identity,graph,summary,scope,historical=false,onSelectTask}:{identity:GraphIdentity;graph?:GraphSnapshot;summary?:ScopeSummary;scope?:PublicDispatchScope;historical?:boolean;onSelectTask:(id:string)=>void}){
  const items=conversationProgress(identity,graph,summary,scope);if(!items.length)return null;
  const state=scopeGoalView(summary,graph),older=items.slice(0,-6),recent=items.slice(-6);
  return <section className="conversation-progress" aria-label="任务执行进展">
    <header><strong>主 Agent · {historical?'历史目标进展':'执行进展'}</strong><span role="status" className={'progress-phase '+state.tone}>{state.label}</span></header>
    {older.length>0&&<details className="progress-earlier"><summary>查看较早的 {older.length} 个节点（含目标与分工）</summary><ol>{older.map(item=><ProgressItem key={item.id} item={item} onSelectTask={onSelectTask}/>)}</ol></details>}
    <ol>{recent.map(item=><ProgressItem key={item.id} item={item} onSelectTask={onSelectTask}/>)}</ol>
  </section>;
}
