/**
 * 作用定位：从 Cindy SendButton 移植发送/停止的固定 28px 按钮和按下动作身份保护。
 * 设计原因：复用上游实际 SVG 和按下/释放逻辑；发送与停止可同时呈现，活动目标的发送进入队列，持久等待显示补充并继续与取消目标；删除尚未支持的语音与创建 Agent 分支，替换样式与国际化依赖。
 * 来源：makecindy/cindy，Apache-2.0；Copyright 2026 XD Inc.；已为 CBIM 修改，见 legal/cindy-NOTICE。
 */
import {forwardRef,useRef} from 'react';
interface SendButtonProps {disabled:boolean;onClick:()=>void;isStreaming?:boolean;queued?:boolean;/** 补充是独立提交意图，按下后状态切换不能误发为普通聊天。 */continuing?:boolean;/** 持久等待没有运行可停止，明确显示取消开放目标。 */stopLabel?:string}
export const SendButton=forwardRef<HTMLButtonElement,SendButtonProps>(function SendButton({disabled,onClick,isStreaming=false,queued=false,continuing=false,stopLabel},ref){
  const currentAction=isStreaming?'stop':continuing?'continue':queued?'queue':'send',pressedAction=useRef<string|null>(null);
  return <button ref={ref} type="button" disabled={disabled} className="chat-send" aria-label={isStreaming?stopLabel??'停止执行':continuing?'补充并继续':queued?'加入队列':'发送消息'} title={isStreaming?stopLabel??'暂停对话（停止本轮，保留会话）':continuing?'补充并继续原目标':queued?'加入队列（当前执行不受影响）':'发送消息'}
    onPointerDown={()=>{pressedAction.current=currentAction}} onPointerCancel={()=>{pressedAction.current=null}} onBlur={()=>{pressedAction.current=null}}
    onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){if(event.repeat){event.preventDefault();return}pressedAction.current=currentAction}}}
    onClick={()=>{const initialAction=pressedAction.current;pressedAction.current=null;if(initialAction!==null&&initialAction!==currentAction)return;onClick()}}>
    {isStreaming?<span className="chat-stop-square"/>:<svg aria-hidden="true" viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M2.6 3.35a1 1 0 0 1 1.08-.13l17.2 8a.88.88 0 0 1 0 1.56l-17.2 8A1 1 0 0 1 2.3 19.6l2.04-6.44L13 12 4.34 10.84 2.3 4.4a1 1 0 0 1 .3-1.05Z"/></svg>}
  </button>;
});
