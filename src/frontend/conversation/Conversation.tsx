/**
 * 作用定位：会话双页签入口（对话/本会话任务），默认主 Agent 普通对话、启动与继续大脑、展示流式 Markdown 正文和按生命周期合并的工具证据，移植 Cindy 输入组件并适配上下文附件、权限审批及本次运行全部通过、结构化选项提问、持久化消息队列及任务用时、生成速度、价值和上下文计量。
 * 设计原因：队列嵌入输入卡片，支持 Ctrl+Enter 插入，按事件顺序展示用户补充；页签只保存草稿和 taskId，主进程日志是对话事实；所有异步请求绑定工作区，卸载页面不停止任务。
 */
import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import type {WorkspaceView} from '../../bridge/contracts/workspace';
import type {RunSummary} from '../../bridge/contracts/execution';
import type {LlmSettings} from '../../bridge/contracts/models';
import type {ViewTab,TabKind} from '../shell/tabs';
import {transcript} from './transcript';
import {MarkdownMessage} from './MarkdownMessage';
import {WorkStatus} from './WorkStatus';
import {SessionTaskView} from '../tasks/SessionTaskView';
import './session-tabs.css';
import {MessageQueue} from './MessageQueue';
import {useMessageQueue} from './useMessageQueue';
import {QuestionCard} from './QuestionCard';
import type {PendingQuestion} from '../../bridge/contracts/execution';
import {UsageStatus} from './UsageStatus';
import {MessageCard} from './MessageCard';
import {Icon} from '../components/Icon';
import './conversation.css';
import {ComposerCard,COMPOSER_CONTENT_CLASS} from './ComposerCard';
import {SendButton} from './SendButton';
import {AttachmentMenu} from './AttachmentMenu';
import {ComposerPicker} from './ComposerPicker';
import {ComposerAttachments} from './ComposerAttachments';
import type {ChatAttachment,ChatApproval,ChatPermission} from '../../bridge/contracts/chat';
const api=window.cbim;
interface HistoryItem {task?:{taskId:string;goal:string};runId:string;status:string;error?:string}
/** 请求使用本组件工作区身份；请求锁阻止双击，轮询只在当前组件存活时写入状态。 */
export function Conversation({tab,workspace,onDraft,openView,onBind,openSettings,onAttachments}:{tab:ViewTab;workspace:WorkspaceView;onDraft:(draft:string)=>void;openView:(kind:TabKind)=>void;onBind:(taskId?:string)=>void;openSettings:()=>void;onAttachments:(items:ChatAttachment[])=>void}){
  const [section,setSection]=useState<'chat'|'tasks'>('chat');
  const [models,setModels]=useState<LlmSettings>(),[runs,setRuns]=useState<RunSummary[]>([]),[history,setHistory]=useState<HistoryItem[]>([]);
  // 默认权限以手掌标识，业务文件与知识提交共用本轮审批；模式变化仅作用于下次发送。
  const preferenceKey='cbim.composer.'+workspace.id+'.'+tab.id;
  const readPreference=()=>{try{const value=JSON.parse(localStorage.getItem(preferenceKey)||'{}');return value&&typeof value==='object'?value:{}}catch{return {}}};
  const [selection,setSelection]=useState<string>(()=>typeof readPreference().selection==='string'?readPreference().selection:''),[permission,setPermission]=useState<ChatPermission>(()=>['read','ask','execute'].includes(readPreference().permission)?readPreference().permission:'ask');
  useEffect(()=>{try{localStorage.setItem(preferenceKey,JSON.stringify({selection,permission}))}catch{}},[preferenceKey,selection,permission]);
  const [attachmentBusy,setAttachmentBusy]=useState(false),[dragActive,setDragActive]=useState(false);
  const dragDepth=useRef(0),importing=useRef(false);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[pollError,setPollError]=useState(''),[loaded,setLoaded]=useState(false),[confirmed,setConfirmed]=useState<string[]>([]);
  const {items:queued,error:queueError,refresh:refreshQueue,invalidate:invalidateQueue}=useMessageQueue(workspace.id,tab.taskId);
  const [nextTip,setNextTip]=useState(0);
  useEffect(()=>{if(!nextTip)return;const timer=setTimeout(()=>setNextTip(0),5000);return()=>clearTimeout(timer)},[nextTip]);
  const [questions,setQuestions]=useState<PendingQuestion[]>([]);
  const [now,setNow]=useState(Date.now()),[approvals,setApprovals]=useState<ChatApproval[]>([]);
  const attachments=tab.attachments||[];
  const attachmentRef=useRef(attachments);attachmentRef.current=attachments;
  function addAttachments(items:ChatAttachment[]){const combined=[...attachmentRef.current];for(const item of items)if(!combined.some(a=>a.kind===item.kind&&a.source===item.source))combined.push(item);if(combined.length>12){setError('最多可添加 12 项附件，请移除部分附件后重试');return}onAttachments(combined);if(running)setNextTip(Date.now())}
  async function importFiles(files:File[]){if(importing.current||attachmentBusy||busy)return;if(files.length+attachmentRef.current.length>12){setError('最多可添加 12 项附件');return}importing.current=true;setAttachmentBusy(true);setError('');try{addAttachments(await api.importFiles(workspace.id,files))}catch(e:any){setError(e.message)}finally{importing.current=false;setAttachmentBusy(false)}}
  const input=useRef<HTMLTextAreaElement>(null);
  const lock=useRef(false),alive=useRef(true),scroll=useRef<HTMLDivElement>(null),follow=useRef(true);
  const latest=runs.at(-1),running=latest?.status==='running';
  useEffect(()=>{if(!running)return;const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer)},[running]);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false}},[]);
  useEffect(()=>{let cancelled=false;void api.call('models.list').then(x=>{if(!cancelled)setModels(x)}).catch((e:Error)=>{if(!cancelled)setError(e.message)});return()=>{cancelled=true}},[workspace.id]);
  // 历史/审批串行轮询，队列由独立增量 Hook 同步，不再等待日志读取。
  useEffect(()=>{let cancelled=false,timer:ReturnType<typeof setTimeout>;setRuns([]);setLoaded(false);setConfirmed([]);
    async function poll(){try{const list:HistoryItem[]=await api.call('loop.list',{id:workspace.id});const data:RunSummary[]=tab.taskId?await api.call('loop.thread',{id:workspace.id,taskId:tab.taskId}):[];
      const approvals:ChatApproval[]=tab.taskId?await api.call('loop.approvals',{id:workspace.id,taskId:tab.taskId}):[];
      const questions:PendingQuestion[]=tab.taskId?await api.call('loop.questions',{id:workspace.id,taskId:tab.taskId}):[];
      if(!cancelled){setQuestions(old=>JSON.stringify(old)===JSON.stringify(questions)?old:questions);setApprovals(old=>JSON.stringify(old)===JSON.stringify(approvals)?old:approvals);setHistory(old=>JSON.stringify(old)===JSON.stringify(list)?old:list);
        // 日志仅追加；版本未变时不替换数组、不触发正文跟随滚动。
        setRuns(old=>old.length===data.length&&old.every((r,i)=>r.runId===data[i].runId&&r.status===data[i].status&&r.events.at(-1)?.seq===data[i].events.at(-1)?.seq)?old:data);setLoaded(true);setPollError('')}
    }catch(e:any){if(!cancelled){setPollError(e.message);setLoaded(false)}}finally{if(!cancelled)timer=setTimeout(()=>void poll(),1000)}}
    void poll();return()=>{cancelled=true;clearTimeout(timer)};
  },[workspace.id,tab.taskId]);
  useEffect(()=>{setConfirmed([])},[latest?.runId]);
  // 正文排版后、浏览器绘制前跟随末尾，避免 Markdown 高度变化误判为用户向上滚动。
  useLayoutEffect(()=>{if(section==='chat'&&follow.current&&scroll.current)scroll.current.scrollTop=scroll.current.scrollHeight},[runs,questions,section]);
  // 跟随文字增高，输入区达到上限后内部滚动，消息列与输入框保持同宽。
  useEffect(()=>{const node=input.current;if(node){node.style.height='auto';node.style.height=Math.min(186,Math.max(32,node.scrollHeight))+'px'}},[tab.draft]);
  async function operate(work:()=>Promise<void>){if(lock.current)return;lock.current=true;invalidateQueue();setBusy(true);setError('');try{await work()}catch(e:any){if(alive.current)setError(e.message)}finally{await refreshQueue();lock.current=false;if(alive.current)setBusy(false)}}
  async function send(insert=false){const message=(tab.draft||'').trim()||(attachments.length?'请查看附加的资料。':'');if(!message)return;
    await operate(async()=>{const [profileId,model]=selection?JSON.parse(selection):[];const options={...(profileId?{profileId,model}:{}),permission};
      const result=tab.taskId&&(running||queued.length)?await api.call('loop.enqueue',{id:workspace.id,taskId:tab.taskId,message,attachments:attachments.map(a=>a.id),options}):tab.taskId?await api.call('loop.resume',{id:workspace.id,taskId:tab.taskId,runId:latest?.runId,message,attachments:attachments.map(a=>a.id),options,reconciledToolIds:confirmed}):await api.call('loop.chat',{id:workspace.id,message,attachments:attachments.map(a=>a.id),options});
      // 即使离开页面，旧回调也只更新原工作区页签；历史可找回已启动任务。
      onBind(result.taskId);onDraft('');onAttachments([]);
      if(insert&&running&&result.id)await api.call('loop.queueInsert',{id:workspace.id,taskId:result.taskId,queueId:result.id});
      if(alive.current){const data=await api.call('loop.thread',{id:workspace.id,taskId:result.taskId});if(alive.current){setRuns(data);setLoaded(true);follow.current=true}}
    });
  }
  const selectedPair=(()=>{try{const value=JSON.parse(selection||'[]');return Array.isArray(value)?value:[]}catch{return []}})();
  const selectedProfile=models?.profiles.find(p=>p.id===(selectedPair[0]||models?.selectedId));
  const selectedModel=selectedProfile?.models.find(m=>m.id===(selectedPair[1]||selectedProfile.defaultModel));
  const modelAvailable=!!models?.profiles.length&&(!selection||models.profiles.some(p=>p.models.some(m=>m.enabled&&JSON.stringify([p.id,m.id])===selection)));
  const canSend=loaded&&!pollError&&!busy&&!attachmentBusy&&modelAvailable&&(!!tab.draft?.trim()||attachments.length>0)&&(tab.taskId?!!latest?.sessionFile&&(running||latest.unresolvedTools.every(id=>confirmed.includes(id))):true);
  // 标题只展示用户首行目标，避免把附加参考资料和内部标记放进导航。
  const taskHistory=[...new Map(history.filter(h=>h.task).map(h=>[h.task!.taskId,h])).values()];
  const queueOperation=async(action:string,args:Record<string,unknown>)=>{let saved=false;await operate(async()=>{await api.call(action,{id:workspace.id,taskId:tab.taskId,...args});saved=true});return saved};
  const queueChange=(queueId:string,action:string)=>void queueOperation('loop.queueChange',{queueId,action});
  const queueContinue=()=>void operate(async()=>{await api.call('loop.queueContinue',{id:workspace.id,taskId:tab.taskId})});
  return <div className="chat-page"><nav className="session-tabs" role="tablist" aria-label="会话内容"><button id={'session-chat-'+tab.id} role="tab" aria-selected={section==='chat'} aria-controls={'session-dialog-'+tab.id} onClick={()=>setSection('chat')}>对话</button><button id={'session-tasks-'+tab.id} role="tab" aria-selected={section==='tasks'} aria-controls={'session-task-panel-'+tab.id} onClick={()=>setSection('tasks')}>任务视图</button></nav>
    {section==='tasks'&&<section className="session-task-panel" role="tabpanel" id={'session-task-panel-'+tab.id} aria-labelledby={'session-tasks-'+tab.id}><SessionTaskView workspaceId={workspace.id} taskId={tab.taskId} runs={runs} queued={queued} now={now} busy={busy} onQueueChange={queueChange} onQueueContinue={queueContinue} onChat={()=>setSection('chat')} onStop={()=>void operate(async()=>{await api.call('loop.stop',{id:workspace.id,taskId:tab.taskId})})}/>{pollError&&<p role="alert">{pollError}</p>}</section>}
    <div className="conversation-dialog" hidden={section!=='chat'} role="tabpanel" id={'session-dialog-'+tab.id} aria-labelledby={'session-chat-'+tab.id}>
    <div className="chat-toolbar"><Icon name="chat" size={15}/><span className="chat-title">{latest?.task.goal.split('\n')[0]||'新对话'}</span><details className="chat-menu chat-header-menu" onKeyDown={e=>{if(e.key==='Escape')e.currentTarget.removeAttribute('open')}}><summary aria-label="对话菜单" title="对话菜单">···</summary><div className="chat-menu-content"><button disabled={busy} onClick={()=>{onBind(undefined);setRuns([]);setError('')}}><Icon name="plus" size={15}/>新对话</button><label>历史对话<select aria-label="对话历史" disabled={busy} value={tab.taskId||''} onChange={e=>{onBind(e.target.value||undefined);setError('')}}><option value="">新对话</option>{taskHistory.map(h=><option key={h.task!.taskId} value={h.task!.taskId}>{h.task!.goal.split('\n')[0].slice(0,60)}</option>)}</select></label><button onClick={()=>openView('knowledge')}>项目架构</button><button onClick={()=>openView('team')}>团队能力</button><button onClick={openSettings}>模型设置</button></div></details></div>
    {(error||pollError||queueError)&&<div className="shell-alert" role="alert">{error||pollError||queueError}</div>}
    {history.some(h=>h.status==='unreadable')&&<p role="alert">部分执行记录无法读取，请检查本机任务日志。</p>}
    <div className="chat-scroll" ref={scroll} onScroll={()=>{const e=scroll.current!;follow.current=e.scrollHeight-e.scrollTop-e.clientHeight<80}}>
      {!tab.taskId&&<div className="chat-welcome"><span className="overline">CBIM · 主 Agent</span><h2>有什么可以帮你？</h2><p>聊聊想法，提出问题，或告诉我你想完成的工作。</p></div>}
      {tab.taskId&&!loaded&&!runs.length&&<p role="status">正在读取对话记录…</p>}
      {latest?.task.workflowContext&&<details className="chat-context"><summary>任务上下文 · {latest.task.goal.slice(0,80)}</summary><p>模块：{latest.task.moduleIds.join('、')}<br/>Agent：{latest.task.agentId}<br/>Workflow：{latest.task.workflowContext?.workflowId}<br/>责任人：{latest.task.responsiblePerson||'未指定'}</p><ul>{latest.task.acceptance.map((a,i)=><li key={i}>{a}</li>)}</ul></details>}
      {runs.map(run=>{const items=transcript(run);return <section key={run.runId} className="chat-turn" aria-label="对话轮次">
        {items.filter((i,index)=>index===0&&i.kind==='user').map(item=><MessageCard key={item.id} speaker="user" text={item.text} time={run.events[0]?.time}><div className="chat-text">{item.text}</div>{item.attachments&&<div className="chat-attachments">{item.attachments.map((a,i)=><span key={i} title={a.source}><Icon name="knowledge" size={13}/>{a.name}</span>)}</div>}</MessageCard>)}
        <WorkStatus run={run} now={now}/>
        {items.slice(1).filter(i=>i.kind==='assistant'||i.kind==='error'||i.kind==='user').map(item=><MessageCard key={item.id} speaker={item.kind==='user'?'user':item.kind==='assistant'?'assistant':'error'} text={item.text} time={run.events.at(-1)?.time}>{item.kind==='user'?<div className="chat-text">{item.text}</div>:<MarkdownMessage text={item.text} streaming={item.pending} workspaceId={workspace.id}/>}</MessageCard>)}
      </section>})}
      {questions.map(q=><QuestionCard key={q.id} request={q} onAnswer={async answers=>{await api.call('loop.answerQuestion',{id:workspace.id,taskId:q.taskId,questionId:q.id,answers})}}/>)}
      {latest&&!running&&latest.unresolvedTools.length>0&&<div className="chat-reconcile"><h3>继续前核实未确认操作</h3><p>展开上方工具证据，核实实际产物后逐项勾选。系统不会自动重放。</p>{latest.unresolvedTools.map(id=><label key={id}><input type="checkbox" checked={confirmed.includes(id)} onChange={e=>setConfirmed(x=>e.target.checked?[...x,id]:x.filter(v=>v!==id))}/>已核实操作 {id}</label>)}</div>}
      {latest&&!running&&!latest.sessionFile&&<p role="alert">本次运行没有建立可恢复会话，请新建对话；原记录已保留。</p>}
    </div>
    <div className="chat-composer">
      {running&&!!nextTip&&<p className="composer-next-tip" role="status">附件随下次发送；模型和权限修改在下一轮执行生效。插入当前任务仍沿用当前运行设置。</p>}
      {approvals.map(a=><div className="chat-approval" key={a.id}><b>允许本次 {a.name} 操作？</b><pre>{JSON.stringify(a.input,null,2)}</pre><button disabled={busy} onClick={()=>void operate(async()=>{await api.call('loop.approve',{id:workspace.id,taskId:tab.taskId,approvalId:a.id,allow:true})})}>允许一次</button><button disabled={busy} title="仅允许当前这次执行中的后续操作；结束或停止后自动恢复确认，知识库保护不变" onClick={()=>void operate(async()=>{await api.call('loop.approve',{id:workspace.id,taskId:tab.taskId,approvalId:a.id,allow:true,allowAll:true})})}>本次任务全部通过</button><button disabled={busy} onClick={()=>void operate(async()=>{await api.call('loop.approve',{id:workspace.id,taskId:tab.taskId,approvalId:a.id,allow:false})})}>拒绝</button></div>)}

      <UsageStatus runs={runs} now={now} placement="above" waitingApproval={approvals.length>0||questions.length>0}/>
      {!modelAvailable&&models&&<p className="chat-model-notice">{models.profiles.length?'所选模型已不可用，请重新选择。':'尚未配置模型。'}<button onClick={openSettings}>前往模型设置</button></p>}
      <ComposerCard className={COMPOSER_CONTENT_CLASS+(dragActive?' drag-active':'')} aria-busy={attachmentBusy}
        onDragEnter={e=>{if(e.dataTransfer.types.includes('Files')){e.preventDefault();dragDepth.current++;setDragActive(true)}}}
        onDragOver={e=>{if(e.dataTransfer.types.includes('Files')){e.preventDefault();e.dataTransfer.dropEffect=busy||attachmentBusy?'none':'copy'}}}
        onDragLeave={()=>{dragDepth.current=Math.max(0,dragDepth.current-1);if(!dragDepth.current)setDragActive(false)}}
        onDrop={e=>{e.preventDefault();dragDepth.current=0;setDragActive(false);if(e.dataTransfer.files.length)void importFiles(Array.from(e.dataTransfer.files))}}
        onPaste={e=>{if(e.clipboardData.files.length){e.preventDefault();void importFiles(Array.from(e.clipboardData.files))}}}>
        <MessageQueue embedded items={queued} busy={busy} onChange={queueChange} onContinue={queueContinue}
          onEdit={(queueId,message,expected)=>queueOperation('loop.queueEdit',{queueId,message,expected})}
          onMove={(queueId,beforeId)=>void queueOperation('loop.queueMove',{queueId,beforeId})}
          onInsert={running?(queueId)=>void queueOperation('loop.queueInsert',{queueId}):undefined}/>
        {dragActive&&<div className="composer-drop-target"><Icon name="folder" size={24}/><b>松开以添加到对话</b><small>文件和文件夹会保存在本机附件快照中</small></div>}
        {attachmentBusy&&<div className="composer-upload-state" role="status"><span className="work-spinner"/>正在准备附件…</div>}
        <ComposerAttachments items={attachments} workspaceId={workspace.id} disabled={busy||attachmentBusy} onRemove={id=>onAttachments(attachments.filter(a=>a.id!==id))}/>
        <textarea ref={input} aria-label="对话草稿" disabled={busy} value={tab.draft||''} onChange={e=>onDraft(e.target.value)} placeholder="继续聊一聊…" title="Enter 发送或排队，Shift+Enter 换行；Ctrl+Enter 插入当前任务，沿用当前模型与权限" onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){if(canSend){e.preventDefault();void send(running&&(e.ctrlKey||e.metaKey))}else if(running&&!busy&&(e.ctrlKey||e.metaKey)&&queued[0]){e.preventDefault();void queueOperation('loop.queueInsert',{queueId:queued[0].id})}}}}/>
        <div className="chat-controls"><div className="chat-controls-left"><AttachmentMenu workspaceId={workspace.id} disabled={busy||attachmentBusy||attachments.length>=12} onBusy={setAttachmentBusy} onAdd={addAttachments}/><ComposerPicker label="执行权限" value={permission} onChange={v=>{setPermission(v as ChatPermission);if(running)setNextTip(Date.now())}} disabled={busy} warning={permission==='execute'} options={[
          {value:'read',label:'只读访问',icon:'knowledge',description:'只查看、分析和预览，不修改业务文件或正式知识，不执行命令'},
          {value:'ask',label:'默认权限',icon:'hand',description:'修改业务文件、提交知识和运行命令前逐次确认'},
          {value:'execute',label:'完全访问',icon:'warning',description:'自动执行业务文件、知识提交和命令操作；仍检查工作区边界及知识版本'},
        ]}/></div>
        <div className="chat-controls-right"><ComposerPicker label="对话模型" value={selection} onChange={value=>{setSelection(value);if(running)setNextTip(Date.now())}} disabled={busy||!models} fallbackLabel={models?'所选模型不可用':'正在加载模型…'} searchable align="right" options={[
          {value:'',label:models?.profiles.find(p=>p.id===models.selectedId)?.defaultModel||'选择模型',description:'使用设置中的默认供应商和模型',group:'默认'},
          ...(models?.profiles.flatMap(p=>p.models.filter(m=>m.enabled).map(m=>({value:JSON.stringify([p.id,m.id]),label:m.name||m.id,description:p.name+' / '+m.id,group:p.name})))||[]),
        ]}/>{running&&<SendButton disabled={busy} isStreaming onClick={()=>void operate(async()=>{await api.call('loop.stop',{id:workspace.id,taskId:tab.taskId})})}/>} {(!running||!!tab.draft?.trim()||attachments.length>0)&&<SendButton disabled={!canSend} queued={running||queued.length>0} onClick={()=>void send()}/>}</div></div>
      </ComposerCard>
      <div className="chat-footer"><span><Icon name="folder" size={13}/>{workspace.name}</span><UsageStatus runs={runs} now={now} placement="footer" capacity={selectedModel?.contextWindow}/></div>
    </div>
    </div>
  </div>
}
