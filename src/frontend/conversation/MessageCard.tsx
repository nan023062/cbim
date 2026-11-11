/**
 * 作用定位：复用 Cindy ChatBubble 的用户气泡/助手裸正文布局，承载消息时间和复制操作。
 * 设计原因：普通助手答复不做卡片底色；操作栏只在悬停或键盘聚焦时显现，避免干扰阅读。
 * 来源：Cindy ChatBubble.tsx / chatChrome.ts，Apache-2.0；许可见 legal。
 */
import {useState,type ReactNode} from 'react';
export function MessageCard({speaker,text,time,children}:{speaker:'user'|'assistant'|'error';text:string;time?:string;children:ReactNode}){
  const [copied,setCopied]=useState('');const date=time?new Date(time):undefined;
  return <div className={'chat-message '+speaker} aria-label={speaker==='user'?'你的消息':speaker==='assistant'?'主 Agent 回复':'执行错误'}>
    <div className={'chat-bubble '+(speaker==='user'?'user-bubble':'bare-bubble')}>{children}</div>
    <div className="message-actions">{date&&!Number.isNaN(date.getTime())&&<time dateTime={time} title={date.toLocaleString()}>{date.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</time>}<button aria-label={speaker==='user'?'复制你的消息':'复制回复'} onClick={()=>void navigator.clipboard.writeText(text).then(()=>setCopied('已复制')).catch(()=>setCopied('复制失败'))}>{copied||'复制'}</button><span role="status" className="message-copy-status">{copied}</span></div>
  </div>;
}
