/**
 * 作用定位：中央交互区内的频道子窗，独立滚动与草稿，主会话仍只装配一个执行控制器。
 * 设计原因：已访问频道保持挂载以保留展开和阅读位置；隐藏仅停用输入与观察，不取消已提交请求。缓存详情仅供隐藏展示，恢复可见必须重新核对当前详情。
 */
import {useRef,type ComponentProps} from 'react';
import type {ConversationTopic} from './conversation-topics';
import {ConversationChannel} from './ConversationTopics';
import {ChatMessages} from './ChatMessages';
import {ChannelComposer} from './ChannelComposer';
import {ReadingPane} from './ReadingPane';
export function ChannelPane({topic,visible,onSelect,onClose,...composer}:ComponentProps<typeof ChannelComposer>&{topic:ConversationTopic;visible:boolean;onSelect:(id?:string)=>void;onClose:()=>void}){
 const last=useRef(composer.scope);if(composer.scope)last.current=composer.scope;
 return <section className="channel-pane" aria-label="频道子对话" data-channel-id={topic.scope.scopeId} hidden={!visible}>
  <ReadingPane active={composer.active} label="频道消息"><ConversationChannel topic={topic} onClose={onClose} onSelect={onSelect} renderRun={run=><ChatMessages key={run.runId} run={run} workspaceId={composer.identity.workspaceId}/>}/></ReadingPane>
  <div className="channel-input-area"><ChannelComposer {...composer} scope={composer.active?composer.scope:last.current}/></div>
 </section>;
}
