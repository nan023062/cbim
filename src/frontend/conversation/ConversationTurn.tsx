/**
 * 作用定位：按真实事件顺序组合一轮主对话的来源、流式文字与内联工具，系统交接不冒充用户或模型调用。
 * 设计原因：长历史的正文排版与逐键更新的草稿变化频率不同；以完整 props 比较隔离两者，避免重算 Markdown 和消息时间。
 * 更新边界：运行快照不可原地修改；终态缺少正文时显示明确标注的记录摘要或缺失提示，保留原日志，不追加模型调用。
 */
import {memo,useMemo} from 'react';
import type {RunSummary} from '../../bridge/contracts/execution';
import type {ExecutionRecoveryContext} from '../tasks/useExecutionRecovery';
import {Icon} from '../components/Icon';
import {transcript,completionFeedback} from '../execution-view/transcript';
import {MarkdownMessage} from '../execution-view/MarkdownMessage';
import {MessageCard} from './MessageCard';
import {WorkStatus} from '../execution-view/WorkStatus';
import {ConversationToolCall} from './ConversationToolCall';
import {inlineHandoffTasks} from './inline-task-state';
import './inline-conversation.css';

/** 不省略恢复依赖、不裁剪历史或保存第二份正文；流式文本仍由原事件投影替换。 */
export const ConversationTurn=memo(function ConversationTurn({run,workspaceId,now,recovery,active,onSelectTask}:{run:RunSummary;workspaceId:string;now:number;recovery:ExecutionRecoveryContext;active:boolean;onSelectTask:(id:string)=>void}){
  const items=useMemo(()=>transcript(run),[run]);
  const completion=useMemo(()=>completionFeedback(run,items),[run,items]);
  const handoffs=useMemo(()=>inlineHandoffTasks(run,recovery.state.error?undefined:recovery.state.graph),[run,recovery.state.graph,recovery.state.error]);
  return <section className="chat-turn" aria-label="对话轮次">
    {items.map(item=>{
      if(item.kind==='tool')return item.toolCallId?<ConversationToolCall key={item.id} run={run} toolCallId={item.toolCallId} recovery={recovery} active={active} onSelectTask={onSelectTask}/>:<details key={item.id} className="chat-tool"><summary>旧工具记录 · 缺少调用标识</summary><pre>{item.text}</pre></details>;
      if(item.kind==='system')return <details key={item.id} className="chat-tool inline-handoff" data-source-kind="system"><summary><b>{handoffs.length?handoffs.map(t=>t.assignee.name).join('、')+' → 主 Agent':'系统接续'}</b><span>已接收</span></summary><p className="chat-model-notice">{item.text}</p>{handoffs.map(task=><p key={task.taskId}>{task.goal}<button onClick={()=>onSelectTask(task.taskId)}>查看任务详情</button></p>)}</details>;
      return <MessageCard key={item.id} speaker={item.kind==='user'?'user':item.kind==='assistant'?'assistant':'error'} text={item.text} time={item.time??run.events.at(-1)?.time}>{item.kind==='user'?<><div className="chat-text">{item.text}</div>{item.attachments&&<div className="chat-attachments">{item.attachments.map((a,i)=><span key={i} title={a.source}><Icon name="knowledge" size={13}/>{a.name}</span>)}</div>}</>:<MarkdownMessage text={item.text} streaming={item.pending} workspaceId={workspaceId}/>}</MessageCard>;
    })}
    {completion&&<div className="chat-message" role="status" aria-label="本轮反馈（运行记录）"><MarkdownMessage text={completion} workspaceId={workspaceId}/></div>}
    <WorkStatus run={run} now={now} inline/>
  </section>;
});
