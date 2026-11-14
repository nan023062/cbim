/**
 * 作用定位：根据原频道状态呈现补充、续接或关联后续任务；草稿归频道，执行仍归主 Agent。
 * 设计原因：复用可靠中断/续接控制器，不因分屏创建并行会话；未知结果展示冻结请求，关闭视图不重试或取消任务。
 */
import {useEffect,useRef,useState} from 'react';
import type {PublicDispatchScope,ScopeSummary,TopicInterruptionRequest} from '../../bridge/contracts/dispatch';
import type {ScopeContinuationView} from '../tasks/useScopeContinuation';
import {ScopeContinuationForm} from '../tasks/ScopeContinuationForm';
import {TopicInterruptionForm} from './TopicInterruptionForm';
import {ChannelDraftInput} from './ChannelDraftInput';
import {useChannelDraft} from './useChannelDraft';
import type {ChannelDraft,ChannelDraftIdentity} from './channel-draft';

export function ChannelComposer({identity,summary,scope,continuation,options,active,blocked=false,onRefresh,onFollowup}:{identity:ChannelDraftIdentity;summary:ScopeSummary;scope?:PublicDispatchScope;continuation:ScopeContinuationView;options?:TopicInterruptionRequest['options'];active:boolean;blocked?:boolean;onRefresh:()=>void;onFollowup:(scopeId:string,draft:ChannelDraft)=>Promise<boolean>}){
 const draft=useChannelDraft(identity,active),[sending,setSending]=useState(false),[error,setError]=useState('');
 const submitted=useRef<number|undefined>(undefined);
 const waiting=scope?.status==='waiting'&&!scope.wait?.interruptionId;
 const original=continuation.scopeId===identity.scopeId?continuation:undefined;
 // 办公室曾编辑的等待补充仍可接入首次打开的频道；不覆盖频道已有编辑或清空记录。
 useEffect(()=>{if(waiting&&original?.record&&!original.record.attempt&&draft.value.revision===0&&(original.text||original.attachments.length)){try{draft.store.edit({text:original.text,attachments:original.attachments})}catch(e){setError(String(e))}}},[waiting,original?.record,draft.store]);
 // 冻结请求已接管正文与附件后才清除原草稿；未知回执由原控制器持久保留。
 useEffect(()=>{if(original?.record?.attempt&&original.record.attempt.phase!=='rejected'&&submitted.current!==undefined){draft.clear(submitted.current);submitted.current=undefined}},[original?.record?.attempt,draft.store]);
 const submit=async()=>{if(sending||!active||blocked||!scope||!options)return;setSending(true);setError('');const value=draft.value;try{if(scope.status==='closed'){if(await onFollowup(scope.scopeId,value))draft.clear(value.revision)}else if(waiting&&original?.editable){submitted.current=value.revision;await original.submitInput(value.text,value.attachments);onRefresh()}}catch(e){setError(String(e))}finally{setSending(false)}};
 const pendingInterruption=scope?.topicInterruptions?.some(item=>!scope.continuations?.some(value=>value.continuationId===item.request.commandId));
 if(scope&&(scope.status==='active'||pendingInterruption))return <TopicInterruptionForm key={scope.goal?.inputRevision??1} scope={scope} draft={draft} options={options} active={active&&!blocked&&!sending} onRefresh={onRefresh}/>;
 if(waiting&&original?.record?.attempt&&original.record.attempt.phase!=='rejected')return <ScopeContinuationForm state={original}/>;
 const editable=active&&!blocked&&!sending&&draft.store.writable&&(summary.status==='closed'||!!waiting&&!!original?.editable);
 return <section className="channel-composer" aria-label="频道输入">
  <p>{summary.status==='closed'?'此频道已结束。发送会创建关联后续任务，保留原频道。':waiting?'补充交给主 Agent，继续原频道；不会排成新的无关任务。':'正在核实原频道状态，草稿保留。'}</p>
  <ChannelDraftInput draft={draft} editable={editable}/>
  {(error||original?.error)&&<p role="alert">{error||original?.error}</p>}
  <button disabled={!editable||!!draft.error||!scope||!options||draft.busy||!draft.value.text.trim()} onClick={()=>void submit()}>{sending?'正在提交…':summary.status==='closed'?'发送关联后续任务':'补充并继续'}</button>
 </section>;
}
