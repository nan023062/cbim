/**
 * 作用定位：交互区的用户/主 Agent 聊天正文；只投影公开消息和发送失败，不挂载执行审阅控件。
 * 设计原因：聊天与工作详情变化频率和阅读目的不同；保留原事件身份/流式替换语义，工具、系统交接与计量在办公室审阅。
 */
import {memo,useMemo} from 'react';
import type {RunSummary} from '../../bridge/contracts/execution';
import {transcript,completionFeedback} from '../execution-view/transcript';
import {MarkdownMessage} from '../execution-view/MarkdownMessage';
import {MessageCard} from './MessageCard';

/** 不复制日志、不补造模型回复；无最终回复只显示明确标注的记录提示。 */
export const ChatMessages=memo(function ChatMessages({run,workspaceId}:{run:RunSummary;workspaceId:string}){
 const items=useMemo(()=>transcript(run),[run]);
 const completion=useMemo(()=>completionFeedback(run,items),[run,items]);
 return <section className="chat-turn" aria-label="聊天消息">
  {items.filter(item=>item.kind==='user'||item.kind==='assistant'||item.kind==='error').map(item=><MessageCard key={item.id} speaker={item.kind==='user'?'user':item.kind==='assistant'?'assistant':'error'} text={item.text} time={item.time??run.events.at(-1)?.time}>
   {item.kind==='user'?<><div className="chat-text">{item.text}</div>{!!item.attachments?.length&&<div className="chat-attachments">{item.attachments.map((attachment,index)=><span key={index} title={attachment.source}>{attachment.name}</span>)}</div>}</>:<MarkdownMessage text={item.text} streaming={item.pending} workspaceId={workspaceId}/>}
  </MessageCard>)}
  {completion&&<p role="status" aria-label="运行记录提示">{completion}</p>}
 </section>;
});
