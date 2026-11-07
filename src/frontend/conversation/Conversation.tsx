/**
 * 作用定位：会话双页签入口（对话/本会话任务），默认主 Agent 普通对话、启动与继续大脑、展示流式 Markdown 正文和按生命周期合并的工具证据，移植 Cindy 输入组件并适配上下文附件、权限审批及本次运行全部通过、结构化选项提问、持久化消息队列及任务用时、生成速度、价值和上下文计量。
 * 设计原因：主运行、开放周期和准入等待分开。配额不足保留首轮草稿，已受理协作使用只读票据提示；无实际占用时停止工作动画和等待期间计时。目标补充、核实与业务重规划仍使用各自可靠意图，不因容量等待重放旧任务。 人工决定草稿和未知请求在两处目标卡共享，记录与任务恢复分离。 人工决定接续与文本补充分开，共享意图但不共享自动启动权。
 * 导航边界：全局运行页只传一次性原会话定位请求；核对实例、图与周期后选节点，消费后不反复覆盖用户选择，不修改输入、附件或运行状态。
 * 插入边界：两处操作在点击时冻结主 runId；先入队成功再清草稿，插入失败只刷新真实队列，不跨轮重发或误删消息。
 * 资料边界：切到其他会话时本组件可能只被隐藏；必须把 active 传给补充控制器，撤销未完成的资料导入并隔离迟到回包。
 */
import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import type {WorkspaceView} from '../../bridge/contracts/workspace';
import type {RunSummary,ConversationThreadView} from '../../bridge/contracts/execution';
import type {LlmSettings} from '../../bridge/contracts/models';
import type {ViewTab,TabKind} from '../shell/tabs';
import {runtimeTaskSelection,type RuntimeNavigationRequest} from '../shell/runtime-navigation';
import {transcript} from './transcript';
import {MarkdownMessage} from './MarkdownMessage';
import {WorkStatus} from './WorkStatus';
import {SessionTaskView} from '../tasks/SessionTaskView';
import {useSessionGraph} from '../tasks/useSessionGraph';
import {MemberActivity} from '../tasks/MemberActivity';
import {ScopeGoalPanel} from '../tasks/ScopeGoalPanel';
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
import {conversationExecutionState} from './conversation-state';
import {captureQueueInsertTarget,enqueueConversationMessage,insertQueuedMessage} from './queue-insertion';
import {ConversationStopGate} from './conversation-stop';
import {useScopeContinuation} from '../tasks/useScopeContinuation';
import {useScopeReplan} from '../tasks/useScopeReplan';
import {useHumanDecisions} from '../tasks/useHumanDecisions';
import {useHumanContinuation} from '../tasks/useHumanContinuation';
import {ThreadHistoryNotice,threadResumeRun} from './ThreadHistoryNotice';
import {useAdmission} from '../tasks/useAdmission';
import {sessionAdmission} from '../tasks/admission-state';
import {AdmissionNotice} from '../tasks/AdmissionNotice';
const api=window.cbim;
interface HistoryItem {task?:{taskId:string;goal:string};runId:string;status:string;error?:string}
/** 请求使用本组件工作区身份；请求锁阻止双击，轮询只在当前组件存活时写入状态。 */
export function Conversation({tab,workspace,onDraft,openView,onBind,openSettings,onAttachments,active=true,navigation,onNavigationHandled}:{tab:ViewTab;workspace:WorkspaceView;onDraft:(draft:string)=>void;openView:(kind:TabKind)=>void;onBind:(taskId?:string)=>void;openSettings:()=>void;onAttachments:(items:ChatAttachment[])=>void;active?:boolean;navigation?:RuntimeNavigationRequest;onNavigationHandled?:(requestId:number)=>void}){
  const [section,setSection]=useState<'chat'|'tasks'>('chat');
  const graph=useSessionGraph(workspace.id,tab.taskId,active);
  const admission=useAdmission(active),admissionState=sessionAdmission(admission.error?undefined:admission.data,workspace.id,tab.taskId);
  const [selectedTaskId,setSelectedTaskId]=useState<string>();
  const [navigationError,setNavigationError]=useState('');
  const handledNavigation=useRef<number|undefined>(undefined);
  function consumeNavigation(){if(navigation){handledNavigation.current=navigation.requestId;onNavigationHandled?.(navigation.requestId)}}
  function selectSection(value:'chat'|'tasks'){consumeNavigation();setSection(value)}
  function selectTask(id?:string){consumeNavigation();setSelectedTaskId(id)}
  useEffect(()=>{setSelectedTaskId(undefined)},[workspace.id,tab.taskId]);
  function viewMember(taskId:string){selectTask(taskId);setSection('tasks')}
  useEffect(()=>{
    if(!active||!navigation||handledNavigation.current===navigation.requestId)return;
    setSection('tasks');setNavigationError('');
    // 任务图的首次读取完成后才能证明节点不存在；不从全局摘要补造节点或周期。
    if(graph.loading)return;
    try{
      if(workspace.state!=='running'||workspace.instanceId!==navigation.instanceId)throw Error('工作区实例已变化，请从运行管理重新定位。');
      if(graph.error)throw Error(graph.error);
      const selection=runtimeTaskSelection(navigation,{workspaceId:workspace.id,rootSessionId:tab.taskId},graph.graph,graph.scopes);
      graph.selectScope(selection.scopeId);setSelectedTaskId(selection.taskId);
    }catch(error){setNavigationError(error instanceof Error?error.message:'原任务定位失败。')}
    handledNavigation.current=navigation.requestId;onNavigationHandled?.(navigation.requestId);
  },[active,navigation,workspace.id,workspace.instanceId,tab.taskId,graph.loading,graph.error,graph.graph,graph.scopes,graph.selectScope,onNavigationHandled]);
  const [models,setModels]=useState<LlmSettings>(),[runs,setRuns]=useState<RunSummary[]>([]),[history,setHistory]=useState<HistoryItem[]>([]);
  // 坏旧日志只作为只读问题占位；可续接头由后端确认，不能从过滤后的 runs 猜测。
  const [threadIssues,setThreadIssues]=useState<ConversationThreadView['issues']>([]),[resumeRunId,setResumeRunId]=useState<string>();
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
  function addAttachments(items:ChatAttachment[]){const combined=[...attachmentRef.current];for(const item of items)if(!combined.some(a=>a.kind===item.kind&&a.source===item.source))combined.push(item);if(combined.length>12){setError('最多可添加 12 项附件，请移除部分附件后重试');return}onAttachments(combined);if(taskOpen)setNextTip(Date.now())}
  async function importFiles(files:File[]){if(importing.current||attachmentBusy||busy)return;if(files.length+attachmentRef.current.length>12){setError('最多可添加 12 项附件');return}importing.current=true;setAttachmentBusy(true);setError('');try{addAttachments(await api.importFiles(workspace.id,files))}catch(e:any){setError(e.message)}finally{importing.current=false;setAttachmentBusy(false)}}
  const input=useRef<HTMLTextAreaElement>(null);
  const lock=useRef(false),alive=useRef(true),scroll=useRef<HTMLDivElement>(null),follow=useRef(true),memberContent=useRef<HTMLDivElement>(null);
  const stopGate=useRef(new ConversationStopGate()),[,renderStop]=useState(0);
  stopGate.current.observe(tab.taskId?{id:workspace.id,taskId:tab.taskId}:undefined);
  const stopping=!!tab.taskId&&stopGate.current.pending({id:workspace.id,taskId:tab.taskId});
  // 当前开放目标和正在执行分开；持久等待不能通过旧 running 日志或历史选择恢复插入/队列。
  const currentRun=threadResumeRun(runs,resumeRunId),latest=currentRun??runs.at(-1),{mainRunning,executing,taskOpen,waiting,canInsert,canContinueQueue,shouldQueue}=conversationExecutionState(currentRun,graph.openScope,queued.length);
  useEffect(()=>{if(!executing||admissionState.waitingOnly)return;const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer)},[executing,admissionState.waitingOnly]);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false}},[]);
  useEffect(()=>{let cancelled=false;void api.call('models.list').then(x=>{if(!cancelled)setModels(x)}).catch((e:Error)=>{if(!cancelled)setError(e.message)});return()=>{cancelled=true}},[workspace.id]);
  // 历史/审批串行轮询，队列由独立增量 Hook 同步，不再等待日志读取。
  useEffect(()=>{let cancelled=false,timer:ReturnType<typeof setTimeout>;setRuns([]);setThreadIssues([]);setResumeRunId(undefined);setLoaded(false);setConfirmed([]);
    async function poll(){try{const list:HistoryItem[]=await api.call('loop.list',{id:workspace.id});const view:ConversationThreadView=tab.taskId?await api.call('loop.threadView',{id:workspace.id,taskId:tab.taskId}):{runs:[],issues:[]};const data=view.runs;
      const approvals:ChatApproval[]=tab.taskId?await api.call('loop.approvals',{id:workspace.id,taskId:tab.taskId}):[];
      const questions:PendingQuestion[]=tab.taskId?await api.call('loop.questions',{id:workspace.id,taskId:tab.taskId}):[];
      if(!cancelled){setQuestions(old=>JSON.stringify(old)===JSON.stringify(questions)?old:questions);setApprovals(old=>JSON.stringify(old)===JSON.stringify(approvals)?old:approvals);setHistory(old=>JSON.stringify(old)===JSON.stringify(list)?old:list);setThreadIssues(old=>JSON.stringify(old)===JSON.stringify(view.issues)?old:view.issues);setResumeRunId(view.resumeRunId);
        // 日志仅追加；版本未变时不替换数组、不触发正文跟随滚动。
        setRuns(old=>old.length===data.length&&old.every((r,i)=>r.runId===data[i].runId&&r.status===data[i].status&&r.events.at(-1)?.seq===data[i].events.at(-1)?.seq)?old:data);setLoaded(true);setPollError('')}
    }catch(e:any){if(!cancelled){setPollError(e.message);setLoaded(false)}}finally{if(!cancelled)timer=setTimeout(()=>void poll(),1000)}}
    void poll();return()=>{cancelled=true;clearTimeout(timer)};
  },[workspace.id,tab.taskId]);
  useEffect(()=>{setConfirmed([])},[currentRun?.runId]);
  // 正文排版后、浏览器绘制前跟随末尾，避免 Markdown 高度变化误判为用户向上滚动。
  useLayoutEffect(()=>{if(section==='chat'&&follow.current&&scroll.current)scroll.current.scrollTop=scroll.current.scrollHeight},[runs,questions,section]);
  // 成员输出在自己的 Hook 中更新；只在用户仍跟随底部时跟随高度，避免抢走查看旧消息的位置。
  useEffect(()=>{const node=memberContent.current;if(!node||typeof ResizeObserver==='undefined')return;const observer=new ResizeObserver(()=>{if(section==='chat'&&follow.current&&scroll.current)scroll.current.scrollTop=scroll.current.scrollHeight});observer.observe(node);return()=>observer.disconnect()},[section,tab.taskId]);
  // 跟随文字增高，输入区达到上限后内部滚动，消息列与输入框保持同宽。
  useEffect(()=>{const node=input.current;if(node){node.style.height='auto';node.style.height=Math.min(186,Math.max(32,node.scrollHeight))+'px'}},[tab.draft]);
  async function operate(work:()=>Promise<void>){if(lock.current)return;lock.current=true;invalidateQueue();setBusy(true);setError('');try{await work()}catch(e:any){if(alive.current)setError(e.message)}finally{await refreshQueue();graph.refresh();lock.current=false;if(alive.current)setBusy(false)}}
  // 停止不能排在插入的共享锁后；完成只释放自身标记，不修改仍在途的发送 busy。
  async function stopCurrent(){
    if(!tab.taskId)return;const token=stopGate.current.begin({id:workspace.id,taskId:tab.taskId});if(!token)return;
    const current=()=>alive.current&&stopGate.current.isCurrent(token);
    renderStop(value=>value+1);setError('');
    try{await api.call('loop.stop',{id:token.id,taskId:token.taskId})}catch(e:any){if(current())setError(e.message)}finally{stopGate.current.finish(token);if(alive.current)renderStop(value=>value+1);if(current()){invalidateQueue();void refreshQueue();graph.refresh()}}
  }
  async function send(insert=false){const message=(tab.draft||'').trim()||(attachments.length?'请查看附加的资料。':'');if(!message)return;
    if(tab.taskId&&stopGate.current.pending({id:workspace.id,taskId:tab.taskId}))return;
    const insertion=insert?captureQueueInsertTarget(workspace.id,tab.taskId,currentRun,canInsert):undefined;
    if(insert&&!insertion)return;
    await operate(async()=>{const [profileId,model]=selection?JSON.parse(selection):[];const options={...(profileId?{profileId,model}:{}),permission};
      if(tab.taskId&&!shouldQueue&&!resumeRunId)throw Error('当前执行记录不可安全续接，请先核实任务记录。');
      // 即使离开页面，旧回调也只更新原工作区页签；历史可找回已启动任务。
      const accepted=(result:{taskId:string})=>{onBind(result.taskId);onDraft('');onAttachments([])};
      const queued=!!tab.taskId&&shouldQueue;
      const result=queued?await enqueueConversationMessage({enqueue:()=>api.call('loop.enqueue',{id:workspace.id,taskId:tab.taskId,message,attachments:attachments.map(a=>a.id),options}),accepted,insert:request=>api.call('loop.queueInsert',request)},insertion):tab.taskId?await api.call('loop.resume',{id:workspace.id,taskId:tab.taskId,runId:resumeRunId,message,attachments:attachments.map(a=>a.id),options,reconciledToolIds:confirmed}):await api.call('loop.chat',{id:workspace.id,message,attachments:attachments.map(a=>a.id),options});
      if(!queued)accepted(result);
      if(alive.current){const view:ConversationThreadView=await api.call('loop.threadView',{id:workspace.id,taskId:result.taskId});if(alive.current){setRuns(view.runs);setThreadIssues(view.issues);setResumeRunId(view.resumeRunId);setLoaded(true);follow.current=true}}
    });
  }
  const selectedPair=(()=>{try{const value=JSON.parse(selection||'[]');return Array.isArray(value)?value:[]}catch{return []}})();
  const selectedProfile=models?.profiles.find(p=>p.id===(selectedPair[0]||models?.selectedId));
  const selectedModel=selectedProfile?.models.find(m=>m.id===(selectedPair[1]||selectedProfile.defaultModel));
  const modelAvailable=!!models?.profiles.length&&(!selection||models.profiles.some(p=>p.models.some(m=>m.enabled&&JSON.stringify([p.id,m.id])===selection)));
  // 两处目标卡共享同一控制器。明确冻结实际模型与权限，补充不引用、不清空聊天草稿和附件。
  const continuationConfig=modelAvailable&&selectedProfile&&selectedModel?.enabled?{options:{provider:'cbim-'+selectedProfile.id,profileId:selectedProfile.id,model:selectedModel.id,permission},label:(selectedModel.name||selectedModel.id)+' · '+{read:'只读访问',ask:'默认权限',execute:'完全访问'}[permission]}:undefined;
  const continuation=useScopeContinuation(workspace.id,tab.taskId,graph,continuationConfig,graph.refresh,active);
  const humanContinuation=useHumanContinuation(workspace.id,tab.taskId,graph,continuationConfig,graph.refresh);
  // 业务重规划仅共享实际模型身份，权限在独立表单默认 ask 并由用户明确选择；两处卡片共用一份请求。
  const replan=useScopeReplan(workspace.id,tab.taskId,graph,modelAvailable&&selectedProfile&&selectedModel?.enabled?{options:{provider:'cbim-'+selectedProfile.id,profileId:selectedProfile.id,model:selectedModel.id},label:selectedModel.name||selectedModel.id}:undefined,graph.refresh,id=>{graph.selectScope(id);setSelectedTaskId(graph.graph?.root.nodeId);setSection('tasks')});
  // 人工决定只有一份本机会话控制器，保存不改普通草稿、权限或当前等待状态。
  const humanDecisions=useHumanDecisions(workspace.id,tab.taskId,graph,graph.refresh);
  // 初次周期读取尚未完成时不能凭运行日志猜测 resume；等待信息就绪后再决定发送或排队。
  const resumeRun=currentRun;
  const canSend=loaded&&!pollError&&!graph.loading&&!busy&&!stopping&&!attachmentBusy&&modelAvailable&&(!!tab.draft?.trim()||attachments.length>0)&&(tab.taskId?taskOpen||!!resumeRun?.sessionFile&&resumeRun.unresolvedTools.every(id=>confirmed.includes(id)):true);
  // 标题只展示用户首行目标，避免把附加参考资料和内部标记放进导航。
  const taskHistory=[...new Map(history.filter(h=>h.task).map(h=>[h.task!.taskId,h])).values()];
  const queueOperation=async(action:string,args:Record<string,unknown>)=>{const stopPending=!!tab.taskId&&stopGate.current.pending({id:workspace.id,taskId:tab.taskId});const insertion=action==='loop.queueInsert'?captureQueueInsertTarget(workspace.id,tab.taskId,currentRun,canInsert&&!stopPending):undefined;if(action==='loop.queueInsert'&&!insertion)return false;let saved=false;await operate(async()=>{if(insertion)await insertQueuedMessage(insertion,args.queueId as string,request=>api.call('loop.queueInsert',request));else await api.call(action,{id:workspace.id,taskId:tab.taskId,...args});saved=true});return saved};
  const queueChange=(queueId:string,action:string)=>void queueOperation('loop.queueChange',{queueId,action});
  const queueContinue=()=>{if(canContinueQueue&&!graph.loading&&tab.taskId&&!stopGate.current.pending({id:workspace.id,taskId:tab.taskId}))void operate(async()=>{await api.call('loop.queueContinue',{id:workspace.id,taskId:tab.taskId})})};
  return <div className="chat-page"><nav className="session-tabs" role="tablist" aria-label="会话内容"><button id={'session-chat-'+tab.id} role="tab" aria-selected={section==='chat'} aria-controls={'session-dialog-'+tab.id} onClick={()=>selectSection('chat')}>对话</button><button id={'session-tasks-'+tab.id} role="tab" aria-selected={section==='tasks'} aria-controls={'session-task-panel-'+tab.id} onClick={()=>selectSection('tasks')}>任务视图</button></nav>
    <>{navigationError&&<p role="alert" className="shell-alert" data-testid="runtime-navigation-error">{navigationError}</p>}</><AdmissionNotice tickets={admissionState.waiting} error={tab.taskId?admission.error:undefined}/>
    {section==='tasks'&&<section className="session-task-panel" role="tabpanel" id={'session-task-panel-'+tab.id} aria-labelledby={'session-tasks-'+tab.id}><SessionTaskView active={active} workspaceId={workspace.id} taskId={tab.taskId} runs={runs} historyIssueCount={threadIssues.length} queued={queued} now={now} busy={busy} stopping={stopping} graph={graph.graph} scopeState={graph} continuation={continuation} replan={replan} humanDecisions={humanDecisions} humanContinuation={humanContinuation} recovery={{state:graph,refresh:graph.refresh,model:modelAvailable&&selectedProfile&&selectedModel?.enabled?{options:{provider:'cbim-'+selectedProfile.id,profileId:selectedProfile.id,model:selectedModel.id},label:selectedModel.name||selectedModel.id}:undefined,showScope:id=>{graph.selectScope(id);setSelectedTaskId(graph.graph?.root.nodeId);setSection('tasks')}}} graphLoading={graph.loading} graphError={graph.error} onRefreshGraph={graph.refresh} selectedTaskId={selectedTaskId} onSelectTask={selectTask} onQueueChange={queueChange} onQueueContinue={queueContinue} onChat={()=>selectSection('chat')} onStop={()=>void stopCurrent()}/><ThreadHistoryNotice issues={threadIssues}/>{pollError&&<p role="alert">{pollError}</p>}</section>}
    <div className="conversation-dialog" hidden={section!=='chat'} role="tabpanel" id={'session-dialog-'+tab.id} aria-labelledby={'session-chat-'+tab.id}>
    <div className="chat-toolbar"><Icon name="chat" size={15}/><span className="chat-title">{latest?.task.goal.split('\n')[0]||'新对话'}</span><details className="chat-menu chat-header-menu" onKeyDown={e=>{if(e.key==='Escape')e.currentTarget.removeAttribute('open')}}><summary aria-label="对话菜单" title="对话菜单">···</summary><div className="chat-menu-content"><button disabled={busy} onClick={()=>{onBind(undefined);setRuns([]);setError('')}}><Icon name="plus" size={15}/>新对话</button><label>历史对话<select aria-label="对话历史" disabled={busy} value={tab.taskId||''} onChange={e=>{onBind(e.target.value||undefined);setError('')}}><option value="">新对话</option>{taskHistory.map(h=><option key={h.task!.taskId} value={h.task!.taskId}>{h.task!.goal.split('\n')[0].slice(0,60)}</option>)}</select></label><button onClick={()=>openView('knowledge')}>项目架构</button><button onClick={()=>openView('team')}>团队能力</button><button onClick={openSettings}>模型设置</button></div></details></div>
    {(error||pollError||queueError)&&<div className="shell-alert" role="alert">{error||pollError||queueError}</div>}
    {history.some(h=>h.status==='unreadable')&&<p role="alert">部分执行记录无法读取，请检查本机任务日志。</p>}
    <div className="chat-scroll" ref={scroll} onScroll={()=>{const e=scroll.current!;follow.current=e.scrollHeight-e.scrollTop-e.clientHeight<80}}>
      {!tab.taskId&&<div className="chat-welcome"><span className="overline">CBIM · 主 Agent</span><h2>有什么可以帮你？</h2><p>聊聊想法，提出问题，或告诉我你想完成的工作。</p></div>}
      {tab.taskId&&!loaded&&!runs.length&&<p role="status">正在读取对话记录…</p>}
      <ThreadHistoryNotice issues={threadIssues}/>
      {tab.taskId&&<ScopeGoalPanel state={graph} compact testId="conversation-goal-summary" continuation={continuation} replan={replan} humanDecisions={humanDecisions} humanContinuation={humanContinuation}/>}
      {latest?.task.workflowContext&&<details className="chat-context"><summary>任务上下文 · {latest.task.goal.slice(0,80)}</summary><p>模块：{latest.task.moduleIds.join('、')}<br/>Agent：{latest.task.agentId}<br/>Workflow：{latest.task.workflowContext?.workflowId}<br/>责任人：{latest.task.responsiblePerson||'未指定'}</p><ul>{latest.task.acceptance.map((a,i)=><li key={i}>{a}</li>)}</ul></details>}
      {runs.map(run=>{const items=transcript(run);return <section key={run.runId} className="chat-turn" aria-label="对话轮次">
        {items[0]?.kind==='system'&&<p className="chat-model-notice" role="status">{items[0].text}</p>}
        {items.filter((i,index)=>index===0&&i.kind==='user').map(item=><MessageCard key={item.id} speaker="user" text={item.text} time={run.events[0]?.time}><div className="chat-text">{item.text}</div>{item.attachments&&<div className="chat-attachments">{item.attachments.map((a,i)=><span key={i} title={a.source}><Icon name="knowledge" size={13}/>{a.name}</span>)}</div>}</MessageCard>)}
        <WorkStatus run={run} now={now}/>
        {items.slice(1).filter(i=>i.kind==='assistant'||i.kind==='error'||i.kind==='user').map(item=><MessageCard key={item.id} speaker={item.kind==='user'?'user':item.kind==='assistant'?'assistant':'error'} text={item.text} time={run.events.at(-1)?.time}>{item.kind==='user'?<div className="chat-text">{item.text}</div>:<MarkdownMessage text={item.text} streaming={item.pending} workspaceId={workspace.id}/>}</MessageCard>)}
      </section>})}
      <div ref={memberContent}>{tab.taskId&&graph.graph?.tasks.length?<MemberActivity workspaceId={workspace.id} rootSessionId={tab.taskId} tasks={graph.graph.tasks} active={active&&section==='chat'} onSelectTask={viewMember} onViewAll={()=>setSection('tasks')}/>:null}</div>
      {graph.error&&<p role="alert">{graph.error} <button onClick={graph.refresh}>重新同步成员动态</button></p>}
      {questions.map(q=><QuestionCard key={q.id} request={q} onAnswer={async answers=>{await api.call('loop.answerQuestion',{id:workspace.id,taskId:q.taskId,questionId:q.id,answers})}}/>)}
      {currentRun&&!mainRunning&&currentRun.unresolvedTools.length>0&&<div className="chat-reconcile"><h3>继续前核实未确认操作</h3><p>展开上方工具证据，核实实际产物后逐项勾选。系统不会自动重放。</p>{currentRun.unresolvedTools.map(id=><label key={id}><input type="checkbox" checked={confirmed.includes(id)} onChange={e=>setConfirmed(x=>e.target.checked?[...x,id]:x.filter(v=>v!==id))}/>已核实操作 {id}</label>)}</div>}
      {tab.taskId&&loaded&&!taskOpen&&!resumeRunId&&<p role="alert" data-testid="thread-resume-unavailable">当前会话没有可安全续接的执行记录；请先在任务视图核实，或新建对话。原记录已保留。</p>}
    </div>
    <div className="chat-composer">
      {taskOpen&&!!nextTip&&<p className="composer-next-tip" role="status">附件随下次发送；模型和权限修改在下一轮执行生效。{canInsert?'插入当前任务仍沿用当前运行设置。':''}</p>}
      {waiting&&<p className="composer-next-tip" role="status" data-testid="conversation-waiting">当前目标等待补充；新消息会排队为下个任务。</p>}
      {approvals.map(a=><div className="chat-approval" key={a.id}><b>允许本次 {a.name} 操作？</b><pre>{JSON.stringify(a.input,null,2)}</pre><button disabled={busy} onClick={()=>void operate(async()=>{await api.call('loop.approve',{id:workspace.id,taskId:tab.taskId,approvalId:a.id,allow:true})})}>允许一次</button><button disabled={busy} title="仅允许当前这次执行中的后续操作；结束或停止后自动恢复确认，知识库保护不变" onClick={()=>void operate(async()=>{await api.call('loop.approve',{id:workspace.id,taskId:tab.taskId,approvalId:a.id,allow:true,allowAll:true})})}>本次任务全部通过</button><button disabled={busy} onClick={()=>void operate(async()=>{await api.call('loop.approve',{id:workspace.id,taskId:tab.taskId,approvalId:a.id,allow:false})})}>拒绝</button></div>)}

      <UsageStatus runs={runs} currentRun={currentRun??null} historyIncomplete={threadIssues.length>0} now={now} placement="above" waitingApproval={approvals.length>0||questions.length>0} activity={admissionState.waitingOnly?{label:'正在等待执行资格',active:false,tone:'neutral',waitingSince:admissionState.waitingSince}:graph.currentGoalView.phase!=='none'?{...graph.currentGoalView,active:executing,waitingSince:graph.waitingScope?.wait?.createdAt}:undefined}/>
      {!modelAvailable&&models&&<p className="chat-model-notice">{models.profiles.length?'所选模型已不可用，请重新选择。':'尚未配置模型。'}<button onClick={openSettings}>前往模型设置</button></p>}
      <ComposerCard className={COMPOSER_CONTENT_CLASS+(dragActive?' drag-active':'')} aria-busy={attachmentBusy}
        onDragEnter={e=>{if(e.dataTransfer.types.includes('Files')){e.preventDefault();dragDepth.current++;setDragActive(true)}}}
        onDragOver={e=>{if(e.dataTransfer.types.includes('Files')){e.preventDefault();e.dataTransfer.dropEffect=busy||attachmentBusy?'none':'copy'}}}
        onDragLeave={()=>{dragDepth.current=Math.max(0,dragDepth.current-1);if(!dragDepth.current)setDragActive(false)}}
        onDrop={e=>{e.preventDefault();dragDepth.current=0;setDragActive(false);if(e.dataTransfer.files.length)void importFiles(Array.from(e.dataTransfer.files))}}
        onPaste={e=>{if(e.clipboardData.files.length){e.preventDefault();void importFiles(Array.from(e.clipboardData.files))}}}>
        <MessageQueue embedded items={queued} busy={busy} continueDisabled={stopping||waiting||graph.loading} onChange={queueChange} onContinue={queueContinue}
          onEdit={(queueId,message,expected)=>queueOperation('loop.queueEdit',{queueId,message,expected})}
          onMove={(queueId,beforeId)=>void queueOperation('loop.queueMove',{queueId,beforeId})}
          onInsert={canInsert&&!stopping?(queueId)=>void queueOperation('loop.queueInsert',{queueId}):undefined}/>
        {dragActive&&<div className="composer-drop-target"><Icon name="folder" size={24}/><b>松开以添加到对话</b><small>文件和文件夹会保存在本机附件快照中</small></div>}
        {attachmentBusy&&<div className="composer-upload-state" role="status"><span className="work-spinner"/>正在准备附件…</div>}
        <ComposerAttachments items={attachments} workspaceId={workspace.id} disabled={busy||attachmentBusy} onRemove={id=>onAttachments(attachments.filter(a=>a.id!==id))}/>
        <textarea ref={input} aria-label="对话草稿" disabled={busy} value={tab.draft||''} onChange={e=>onDraft(e.target.value)} placeholder="继续聊一聊…" title="Enter 发送或排队，Shift+Enter 换行；Ctrl+Enter 插入正在运行的主 Agent，沿用当前模型与权限" onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){if(canSend){e.preventDefault();void send(canInsert&&(e.ctrlKey||e.metaKey))}else if(canInsert&&!busy&&(e.ctrlKey||e.metaKey)&&queued[0]){e.preventDefault();void queueOperation('loop.queueInsert',{queueId:queued[0].id})}}}}/>
        <div className="chat-controls"><div className="chat-controls-left"><AttachmentMenu workspaceId={workspace.id} disabled={busy||attachmentBusy||attachments.length>=12} onBusy={setAttachmentBusy} onAdd={addAttachments}/><ComposerPicker label="执行权限" value={permission} onChange={v=>{setPermission(v as ChatPermission);if(taskOpen)setNextTip(Date.now())}} disabled={busy} warning={permission==='execute'} options={[
          {value:'read',label:'只读访问',icon:'knowledge',description:'只查看、分析和预览，不修改业务文件或正式知识，不执行命令'},
          {value:'ask',label:'默认权限',icon:'hand',description:'修改业务文件、提交知识和运行命令前逐次确认'},
          {value:'execute',label:'完全访问',icon:'warning',description:'自动执行业务文件、知识提交和命令操作；仍检查工作区边界及知识版本'},
        ]}/></div>
        <div className="chat-controls-right"><ComposerPicker label="对话模型" value={selection} onChange={value=>{setSelection(value);if(taskOpen)setNextTip(Date.now())}} disabled={busy||!models} fallbackLabel={models?'所选模型不可用':'正在加载模型…'} searchable align="right" options={[
          {value:'',label:models?.profiles.find(p=>p.id===models.selectedId)?.defaultModel||'选择模型',description:'使用设置中的默认供应商和模型',group:'默认'},
          ...(models?.profiles.flatMap(p=>p.models.filter(m=>m.enabled).map(m=>({value:JSON.stringify([p.id,m.id]),label:m.name||m.id,description:p.name+' / '+m.id,group:p.name})))||[]),
        ]}/>{taskOpen&&<SendButton disabled={stopping} isStreaming stopLabel={waiting?'取消当前任务':undefined} onClick={()=>void stopCurrent()}/>} {(!taskOpen||!!tab.draft?.trim()||attachments.length>0)&&<SendButton disabled={!canSend} queued={shouldQueue} onClick={()=>void send()}/>}</div></div>
      </ComposerCard>
      <div className="chat-footer"><span><Icon name="folder" size={13}/>{workspace.name}</span><UsageStatus runs={runs} currentRun={currentRun??null} historyIncomplete={threadIssues.length>0} now={now} placement="footer" capacity={selectedModel?.contextWindow}/></div>
    </div>
    </div>
  </div>
}
