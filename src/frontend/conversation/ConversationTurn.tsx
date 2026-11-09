/**
 * 作用定位：呈现一轮主对话的来源、消息和工具记录，供 Conversation 组合历史列表。
 * 设计原因：长历史的正文排版与逐键更新的草稿变化频率不同；以完整 props 比较隔离两者，避免重算 Markdown 和消息时间。
 * 更新边界：运行快照不可原地修改；日志替换、恢复上下文或运行计时变化仍更新。终态用时由日志决定，不订阅墙钟。
 */
import {memo,useMemo} from 'react';
import type {RunSummary} from '../../bridge/contracts/execution';
import type {ExecutionRecoveryContext} from '../tasks/useExecutionRecovery';
import {Icon} from '../components/Icon';
import {transcript} from './transcript';
import {MarkdownMessage} from './MarkdownMessage';
import {MessageCard} from './MessageCard';
import {WorkStatus} from './WorkStatus';

/** 不省略恢复依赖、不裁剪历史或保存第二份正文；流式文本仍由原事件投影替换。 */
export const ConversationTurn=memo(function ConversationTurn({run,workspaceId,now,recovery}:{run:RunSummary;workspaceId:string;now:number;recovery:ExecutionRecoveryContext}){
  const items=useMemo(()=>transcript(run),[run]);
  return <section className="chat-turn" aria-label="对话轮次">
    {items[0]?.kind==='system'&&<p className="chat-model-notice" role="status">{items[0].text}</p>}
    {items.filter((item,index)=>index===0&&item.kind==='user').map(item=><MessageCard key={item.id} speaker="user" text={item.text} time={run.events[0]?.time}><div className="chat-text">{item.text}</div>{item.attachments&&<div className="chat-attachments">{item.attachments.map((a,i)=><span key={i} title={a.source}><Icon name="knowledge" size={13}/>{a.name}</span>)}</div>}</MessageCard>)}
    <WorkStatus run={run} now={now} recovery={recovery}/>
    {items.slice(1).filter(item=>item.kind==='assistant'||item.kind==='error'||item.kind==='user').map(item=><MessageCard key={item.id} speaker={item.kind==='user'?'user':item.kind==='assistant'?'assistant':'error'} text={item.text} time={run.events.at(-1)?.time}>{item.kind==='user'?<div className="chat-text">{item.text}</div>:<MarkdownMessage text={item.text} streaming={item.pending} workspaceId={workspaceId}/>}</MessageCard>)}
  </section>;
});
