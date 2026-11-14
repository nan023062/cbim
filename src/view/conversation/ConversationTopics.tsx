/**
 * 作用定位：主 Session 的纯聊天与频道入口列表，以及独立的频道正文投影。
 * 设计原因：主列表显示聊天正文、频道入口及待启动队列；同 ID 的已启动话题覆盖过渡队列项。频道正文独立呈现，完成/撤销折叠，阅读不改执行。
 */
import type {ReactNode} from 'react';
import type {RunSummary,QueuedMessage} from '../../bridge/contracts/execution';
import type {ConversationTopic} from './conversation-topics';
import './conversation-topics.css';

function status(topic:ConversationTopic){const scope=topic.scope;return scope.status!=='closed'&&scope.interruption?(scope.interruption.phase==='paused'?'已暂停 · 等待重新分析':'正在暂停 · 等待退出确认'):scope.status==='active'?'进行中':scope.status==='waiting'?'等待补充':scope.outcome==='completed'?'已完成':scope.outcome==='cancelled'?'已撤销':scope.outcome==='failed'?'需要处理':'已中断'}
export function ConversationTopics({topics,unassigned,conflicts,queued=[],onSelect,renderRun}:{queued?:QueuedMessage[];topics:ConversationTopic[];unassigned:RunSummary[];conflicts:string[];onSelect:(id?:string)=>void;renderRun:(run:RunSummary,scopeId?:string)=>ReactNode}){
  const current=topics.filter(topic=>!topic.archived),history=topics.filter(topic=>topic.archived);
  const card=(topic:ConversationTopic)=><article key={topic.scope.scopeId} className="main-channel-entry">{topic.runs.map(run=>renderRun(run,topic.scope.scopeId))}<button className="conversation-topic-card" onClick={()=>onSelect(topic.scope.scopeId)} data-topic-id={topic.scope.scopeId}><span className="conversation-topic-title">{topic.scope.objective??topic.scope.inputPreview??'历史任务话题'}</span><span className="conversation-topic-meta">{status(topic)} · {topic.tasks.length} 项派发 · {topic.runs.length} 轮对话</span><span className="conversation-topic-people">{['主 Agent',...new Set(topic.tasks.map(task=>task.assignee.name))].join(' · ')}</span></button></article>;
  return <div className="conversation-topics" aria-label="任务话题">
    {conflicts.length>0&&<p role="alert">{conflicts.length} 轮记录的话题归属冲突，已保留在未分类历史中，请核实记录。</p>}
    <><div className="conversation-topic-heading"><strong>任务话题</strong><span>新任务依次排队</span></div>{current.map(card)}{queued.filter(item=>!topics.some(topic=>topic.scope.scopeId===item.id)).map((item,index)=><article key={item.id} className="conversation-topic-card" data-topic-id={item.id}><strong>{item.message.split('\n')[0].slice(0,240)}</strong><span className="conversation-topic-meta">排队话题 {index+1}{item.followupOf?' · 关联历史话题':''} · {item.status==='paused'?'暂停排队':item.status==='starting'?'正在建立话题':'等待前一话题完成'}</span></article>)}{!current.length&&!queued.length&&<p className="conversation-topic-empty">当前没有进行中的话题。发送新任务后在这里开始。</p>}
      {!!history.length&&<details className="conversation-topic-history"><summary>历史任务 · {history.length}</summary>{history.map(card)}</details>}
      {!!unassigned.length&&<details className="conversation-topic-legacy"><summary>未分类历史 · {unassigned.length} 轮</summary><p>记录尚未同步到话题或旧记录没有明确归属；未按时间推测。</p>{unassigned.map(run=>renderRun(run))}</details>}
    </>
  </div>;
}

/** 频道内容只读；关闭或选择原频道只改变本地浏览状态。 */
export function ConversationChannel({topic:selected,onClose,onSelect,renderRun}:{topic:ConversationTopic;onClose:()=>void;onSelect:(id?:string)=>void;renderRun:(run:RunSummary)=>ReactNode}){return <section className="conversation-topic-thread" aria-label="话题内容"><header><button onClick={onClose} aria-label="关闭频道">关闭频道</button><span>{status(selected)}</span></header><h3>{selected.scope.objective??selected.scope.inputPreview??'任务话题'}</h3>
      {selected.scope.followupOf&&<p>关联历史话题：<button onClick={()=>onSelect(selected.scope.followupOf)}>查看原话题</button></p>}
      {selected.runs.map(renderRun)}
      {!selected.runs.length&&<p role="status">话题已登记，暂无可读的主 Agent 对话记录。</p>}
    </section>;}
