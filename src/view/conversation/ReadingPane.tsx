/**
 * 作用定位：每个聊天/成员审阅窗独立持有滚动位置与跟随末尾状态。
 * 设计原因：频道和主对话更新频率不同；隐藏时不测量或覆盖位置，返回后仅在原本跟随末尾时跟随新消息。
 */
import {useLayoutEffect,useRef,type ReactNode} from 'react';
export function ReadingPane({active,children,label}:{active:boolean;children:ReactNode;label:string}){
 const scroll=useRef<HTMLDivElement>(null),content=useRef<HTMLDivElement>(null),follow=useRef(true),position=useRef(0);
 useLayoutEffect(()=>{const node=scroll.current,body=content.current;if(!active||!node||!body)return;node.scrollTop=follow.current?node.scrollHeight:position.current;const observer=new ResizeObserver(()=>{if(follow.current)node.scrollTop=node.scrollHeight});observer.observe(body);return()=>observer.disconnect()},[active]);
 return <div className="chat-scroll" aria-label={label} ref={scroll} onScroll={()=>{const node=scroll.current;if(active&&node){position.current=node.scrollTop;follow.current=node.scrollHeight-node.scrollTop-node.clientHeight<80}}}><div ref={content}>{children}</div></div>;
}
