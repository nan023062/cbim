/**
 * 作用定位：当前话题内的显式补充入口，展示冻结原文、全员暂停含义和原请求查询。
 * 设计原因：阅读成员对话不会中断工作；只有按钮提交执行。此表单不消费普通聊天草稿，所有请求指向原主 Session。
 */
import {useEffect,useMemo,useState} from 'react';
import {pendingTopicInterruption} from '../../bridge/contracts/dispatch';
import type {PublicDispatchScope,TopicInterruptionRequest} from '../../bridge/contracts/dispatch';
import {TopicInterruptionController} from './topic-interruption-state';

/** 外层以工作区实例、话题和输入版本作 key；隐藏会话不允许新提交，已在途请求仍保留回执。 */
export function TopicInterruptionForm({scope,options,active,onRefresh}:{scope:PublicDispatchScope;options?:TopicInterruptionRequest['options'];active:boolean;onRefresh:()=>void}){
  const [text,setText]=useState(''),[,render]=useState(0);
  const controller=useMemo(()=>new TopicInterruptionController({workspaceId:scope.workspaceId,rootSessionId:scope.rootSessionId,scopeId:scope.scopeId,expectedInputRevision:scope.goal?.inputRevision??1},{storage:window.localStorage,uuid:()=>crypto.randomUUID(),submit:request=>window.cbim.call('loop.topicInterrupt',request),lookup:request=>window.cbim.call('loop.goalContinuation',request)}),[scope.workspaceId,scope.rootSessionId,scope.scopeId,scope.goal?.inputRevision]);
  const saved=pendingTopicInterruption(scope),state=controller.snapshot;
  useEffect(()=>{const unsubscribe=controller.subscribe(()=>render(value=>value+1));void controller.restore(saved?.request);return unsubscribe},[controller,saved?.request.commandId]);
  const canWrite=active&&scope.status==='active'&&!!scope.goal&&!scope.goal.blocked&&!state.pending&&state.ready&&!state.request&&!saved;
  const selected=scope.recovery&&options?{...options,permission:'read' as const}:options;
  const execute=async(work:()=>Promise<void>)=>{await work();onRefresh()};
  return <details className="scope-continuation topic-interruption" data-testid="topic-interruption" open={!!saved||!!state.request||!!state.error}>
    <summary>向主 Agent 补充此话题</summary>
    <p>提交后，本话题的主 Agent 和全部执行成员将暂停。确认退出后，主 Agent 会重新分析和调度；其他办公室不受影响。</p>
    <p><strong>{scope.goal?.plan?.objective??scope.goal?.input.message.slice(0,160)??'原话题'}</strong></p>
    <textarea aria-label="话题补充" value={state.request?.input.message??text} readOnly={!canWrite} maxLength={64000} placeholder="只补充这个话题需要调整的要求…" onChange={event=>setText(event.target.value)}/>
    <p className="scope-goal-muted">{state.request?.options.model??selected?.model??'请先选择可用模型'} · 接收者：主 Agent</p>
    {state.pending&&<p role="status">正在确认原请求和话题参与者状态…</p>}
    {state.request&&!state.receipt&&!state.pending&&<p role="status">补充原文已保留，尚未确认主 Agent 接收。请查询状态，或明确重试同一请求。</p>}
    {state.receipt&&<p role="status">补充已受理，后续进展见本话题对话。</p>}
    {state.error&&<p role="alert">{state.error}</p>}
    {canWrite&&<button disabled={!selected||!text.trim()} onClick={()=>void execute(()=>controller.submit(text,selected!))}>暂停话题并提交补充</button>}
    {state.request&&<><button disabled={state.pending} onClick={()=>void execute(()=>controller.query())}>查询原请求</button>{!state.receipt&&scope.status!=='closed'&&<button disabled={!active||state.pending} onClick={()=>void execute(()=>controller.retry())}>原请求重试</button>}<details><summary>提交标识</summary><code>{state.request.commandId}</code></details></>}
  </details>;
}
