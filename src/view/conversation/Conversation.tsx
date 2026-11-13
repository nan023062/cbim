/**
 * 粘贴仅作用输入框：图片保存有界原字节，纯绝对路径列表先校验并变为引用，失败保留原文字；不自动发送。
 * 主对话按持久归属分话题展示文字与工具，成员状态关联原派发；主列表只展示摘要，完成及撤销归入折叠历史，打开话题不改变执行。
 * 新对话默认 Auto，旧无模式偏好的历史对话保持 Team；当前目标期间禁用模式切换，下一目标仍可在同一对话改选。
 * 历史菜单与侧栏共用本机条目和运行观察，改名／移除由外壳负责，不改原任务目标或日志。
 * 文件补偿：向成员详情传递当前工作区实例，历史运行身份不替代新操作的当前实例校验。
 * 作用定位：会话固定页签入口（对话/本会话任务/当前工作区自动化），默认主 Agent 普通对话、启动与继续大脑、展示流式 Markdown 正文和按生命周期合并的工具证据，移植 Cindy 输入组件并适配上下文附件、权限审批及本次运行全部通过、结构化选项提问、持久化消息队列及任务用时、生成速度、价值和上下文计量。
 * 设计原因：主运行、开放周期和准入等待分开。配额不足保留首轮草稿，已受理协作使用只读票据提示；无实际占用时停止工作动画和等待期间计时。目标补充、核实与业务重规划仍使用各自可靠意图，不因容量等待重放旧任务。 人工决定草稿和未知请求在两处目标卡共享，记录与任务恢复分离。 人工决定接续与文本补充分开，共享意图但不共享自动启动权。
 * 导航边界：子会话只切换成员记录，发送仍持有所属主 taskId；成员登记向外壳发布只读投影，不以执行实例创建额外会话。全局运行页与目标审阅仍定位原节点。
 * 异常边界：unknown 不凭勾选调用标识续接旧 native；显式影响核实和新周期共用真实主会话上下文。
 * 输入边界：普通发送只创建新话题或排队，不因当前阅读成员/历史或持久等待而补充旧话题；队列受理后才清草稿。
 * 资料边界：切到其他会话时本组件可能只被隐藏；必须把 active 传给补充控制器，撤销未完成的资料导入并隔离迟到回包。
 * Skill 入口：加号菜单发送只需一句描述、补充自愿的独立引导请求，沿用当前模型、权限和排队规则；不发送或清空已有草稿与附件。
 * 输入边界：草稿仍即时上交外壳；历史轮次按运行、恢复上下文及实际计时变化更新，键入不重复解析未变正文。
 * 三个引擎始终存在，对话栏读写工作区主 Agent 配置，模型菜单按协议筛选统一启用目录；修改只影响下一轮，Claude Code/Codex 运行期间只支持排队而不承诺原轮插入。协作提示与主 Agent 默认执行规则保持一致。
 * 队列 IPC 入口只接收实际支持的操作名，状态、停止和回执仍由原控制器管理。
 * IPC 边界：发送前冻结原任务和运行，审批绑定审批自身任务；动态队列输入逐操作核实。
 * 中断恢复：空闲会话缺少原生文件或执行事实待核实时，在输入区解释阻断并导航恢复选项，保留旧草稿和附件。
 * 模型切换沿供应商兼容接口解析；同一型号可跨引擎保留选择，限制型号的接口不会放行目录中其他模型。
 * 补充只从话题明确入口提交；未知补充回执沿原控制器查询，不由普通输入自动重发。
 */
import {checkedIpcCall} from '../../bridge/contracts/ipc-call';
import {useCallback,useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import type {WorkspaceView} from '../../bridge/contracts/workspace';
import type {RunSummary,ConversationThreadView} from '../../bridge/contracts/execution';
import {providerSupportsEngine,engineLabel,loopEngineSchema} from '../../bridge/contracts/models';
import type {LlmSettings,LoopEngine} from '../../bridge/contracts/models';
import type {ViewTab,TabKind} from '../shell/tabs';
import {runtimeTaskSelection,type RuntimeNavigationRequest} from '../shell/runtime-navigation';
import {ConversationTurn} from './ConversationTurn';
import {ConversationTopics} from './ConversationTopics';
import {conversationTopics} from './conversation-topics';
import {MemberConversation} from './MemberConversation';
import {teamConversations,teamConversationKey,type TeamConversation} from './team-conversations';
import {AutomationView} from '../automation/AutomationView';
import {SessionTaskView} from '../tasks/SessionTaskView';
import {useSessionGraph} from '../tasks/useSessionGraph';
import {ScopeGoalPanel} from '../tasks/ScopeGoalPanel';
import './session-tabs.css';
import {MessageQueue} from '../execution-view/MessageQueue';
import {useMessageQueue} from './useMessageQueue';
import {QuestionCard} from '../execution-view/QuestionCard';
import type {PendingQuestion} from '../../bridge/contracts/execution';
import {UsageStatus} from './UsageStatus';
import {Icon} from '../components/Icon';
import './conversation.css';
import {useMainAgentSettings} from '../team/useMainAgentSettings';
import {ConversationEntries} from './ConversationEntries';
import {ComposerCard,COMPOSER_CONTENT_CLASS} from './ComposerCard';
import {SendButton} from './SendButton';
import {AttachmentMenu,type FeedbackSkillTitle} from './AttachmentMenu';
import {ComposerPicker} from './ComposerPicker';
import {ComposerAttachments} from '../execution-view/ComposerAttachments';
import {pastedLocalPaths,type ChatAttachment,type ChatApproval,type ChatPermission} from '../../bridge/contracts/chat';
import {pastedImage} from './pasted-images';
import {conversationExecutionState} from './conversation-state';
import {ConversationStopGate} from './conversation-stop';
import {useScopeContinuation} from '../tasks/useScopeContinuation';
import {ScopeContinuationForm} from '../tasks/ScopeContinuationForm';
import type {ExecutionRecoveryContext} from '../tasks/useExecutionRecovery';
import {useScopeReplan} from '../tasks/useScopeReplan';
import {useHumanDecisions} from '../tasks/useHumanDecisions';
import {useHumanContinuation} from '../tasks/useHumanContinuation';
import {ThreadHistoryNotice,ThreadRecoveryNotice,threadRecoveryReason,threadResumeRun} from './ThreadHistoryNotice';
import {useAdmission} from '../tasks/useAdmission';
import {sessionAdmission} from '../tasks/admission-state';
import {AdmissionNotice} from '../tasks/AdmissionNotice';
const api=window.cbim;
interface HistoryItem {status:string}

/** 请求使用本组件工作区身份；请求锁阻止双击，轮询只在当前组件存活时写入状态。 */
export function Conversation({selectedChild,onTeamConversations,conversations,runningTaskIds,onSelectConversation,onRenameConversation,onRemoveConversation,tab,workspace,onDraft,openView,onBind,openSettings,onAttachments,onOpenAutomationRun,active=true,navigation,onNavigationHandled}:{selectedChild?:string;onTeamConversations?:(key:string,items:TeamConversation[])=>void;conversations:ViewTab[];runningTaskIds:string[];onSelectConversation:(id:string)=>void;onRenameConversation:(id:string,title:string)=>void;onRemoveConversation:(id:string)=>void;tab:ViewTab;workspace:WorkspaceView;onDraft:(draft:string)=>void;openView:(kind:TabKind)=>void;onBind:(taskId?:string)=>void;openSettings:()=>void;onAttachments:(items:ChatAttachment[])=>void;onOpenAutomationRun?:(taskId:string,title:string)=>void;active?:boolean;navigation?:RuntimeNavigationRequest;onNavigationHandled?:(requestId:number)=>void}){
  const [section,setSection]=useState<'chat'|'tasks'|'automation'>('chat');
  const graph=useSessionGraph(workspace.id,tab.taskId,active);
  const admission=useAdmission(active),admissionState=sessionAdmission(admission.error?undefined:admission.data,workspace.id,tab.taskId);
  const [selectedTaskId,setSelectedTaskId]=useState<string>();
  const [selectedTopicId,setSelectedTopicId]=useState<string>();
  const [navigationError,setNavigationError]=useState('');
  const handledNavigation=useRef<number|undefined>(undefined);
  function consumeNavigation(){if(navigation){handledNavigation.current=navigation.requestId;onNavigationHandled?.(navigation.requestId)}}
  function selectSection(value:'chat'|'tasks'|'automation'){consumeNavigation();setSection(value)}
  function selectTask(id?:string){consumeNavigation();setSelectedTaskId(id)}
  useEffect(()=>{setSelectedTaskId(undefined);setSelectedTopicId(undefined)},[workspace.id,tab.taskId]);
  // 历史条目使用稳定导航回调，点击时再读取当前定位请求，避免逐键草稿使所有轮次失效。
  const navigationRef=useRef({navigation,onNavigationHandled});navigationRef.current={navigation,onNavigationHandled};
  const viewMember=useCallback((taskId:string)=>{const current=navigationRef.current;if(current.navigation){handledNavigation.current=current.navigation.requestId;current.onNavigationHandled?.(current.navigation.requestId)}setSelectedTaskId(taskId);setSection('tasks')},[]);
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
  const topics=useMemo(()=>conversationTopics({workspaceId:workspace.id,rootSessionId:tab.taskId??''},graph.scopes,runs,graph.graph),[workspace.id,tab.taskId,graph.scopes,runs,graph.graph]);
  const members=useMemo(()=>teamConversations(graph.teamSessions,graph.graph),[graph.teamSessions,graph.graph]);
  const member=members.find(value=>value.session.sessionId===selectedChild);
  useEffect(()=>{onTeamConversations?.(teamConversationKey(workspace.id,workspace.instanceId,tab.taskId),members)},[workspace.id,workspace.instanceId,tab.taskId,members,onTeamConversations]);
  useEffect(()=>{if(selectedChild)setSection('chat')},[selectedChild]);
  function selectTopic(id?:string){setSelectedTopicId(id);graph.selectScope(id)}
  // 坏旧日志只作为只读问题占位；可续接头由后端确认，不能从过滤后的 runs 猜测。
  const [threadIssues,setThreadIssues]=useState<ConversationThreadView['issues']>([]),[resumeRunId,setResumeRunId]=useState<string>();
  // 默认权限以手掌标识，业务文件与知识提交共用本轮审批；模式变化仅作用于下次发送。
  const preferenceKey='cbim.composer.'+workspace.id+'.'+tab.id;
  const readPreference=()=>{try{const value=JSON.parse(localStorage.getItem(preferenceKey)||'{}');return value&&typeof value==='object'?value:{}}catch{return {}}};
  const [permission,setPermission]=useState<ChatPermission>(()=>['read','ask','execute'].includes(readPreference().permission)?readPreference().permission:'ask');
  const mainAgent=useMainAgentSettings(workspace.id,workspace.instanceId,active);
  // 无兼容模型时只保留尚未完成的表单输入，不另存一份会话配置。
  const [pendingEngine,setPendingEngine]=useState<LoopEngine>();
  const selectedRuntime=mainAgent.value?.selection;
  const selection=selectedRuntime?JSON.stringify([selectedRuntime.profileId,selectedRuntime.modelId]):'';
  // 模式只用于新目标，进行中与持久等待冻结原模式，避免给已派发任务换规则。
  const [collaborationMode,setCollaborationMode]=useState<'auto'|'team'>(()=>readPreference().collaborationMode==='auto'?'auto':readPreference().collaborationMode==='team'||tab.taskId?'team':'auto');
  useEffect(()=>{try{localStorage.setItem(preferenceKey,JSON.stringify({permission,collaborationMode}))}catch{}},[preferenceKey,permission,collaborationMode]);
  const [attachmentBusy,setAttachmentBusy]=useState(false),[dragActive,setDragActive]=useState(false);
  const dragDepth=useRef(0),importing=useRef(false);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[pollError,setPollError]=useState(''),[loaded,setLoaded]=useState(false);
  const {items:queued,error:queueError,refresh:refreshQueue,invalidate:invalidateQueue}=useMessageQueue(workspace.id,tab.taskId);
  const [nextTip,setNextTip]=useState(0);
  useEffect(()=>{if(!nextTip)return;const timer=setTimeout(()=>setNextTip(0),5000);return()=>clearTimeout(timer)},[nextTip]);
  const [questions,setQuestions]=useState<PendingQuestion[]>([]);
  const [now,setNow]=useState(Date.now()),[approvals,setApprovals]=useState<ChatApproval[]>([]);
  const attachments=tab.attachments||[];
  const attachmentRef=useRef(attachments);attachmentRef.current=attachments;
  function addAttachments(items:ChatAttachment[]){const combined=[...attachmentRef.current];for(const item of items)if(!combined.some(a=>a.kind===item.kind&&a.source===item.source))combined.push(item);if(combined.length>12){setError('最多可添加 12 项附件，请移除部分附件后重试');return}onAttachments(combined);if(taskOpen)setNextTip(Date.now())}
  async function importFiles(files:File[]){if(importing.current||attachmentBusy||busy)return;if(files.length+attachmentRef.current.length>12){setError('最多可添加 12 项附件');return}importing.current=true;setAttachmentBusy(true);setError('');try{addAttachments(await api.importFiles(workspace.id,files))}catch(e:any){setError(e.message)}finally{importing.current=false;setAttachmentBusy(false)}}
  /** 粘贴图片无需磁盘路径；只消费本次事件，失败不发送消息或清空既有草稿。 */
  async function importPaste(files:File[],paths?:string[],original=''){
    if(importing.current||attachmentBusy||busy)return;
    if((paths?.length??files.length)+attachmentRef.current.length>12){setError('最多可添加 12 项附件');if(original)onDraft((input.current?.value||'')+'\n'+original);return}
    importing.current=true;setAttachmentBusy(true);setError('');
    try{
      let items:ChatAttachment[];
      if(paths)items=await api.call('chat.paths',{id:workspace.id,paths});
      else{
        const images=files.filter(file=>file.type.startsWith('image/')),others=files.filter(file=>!file.type.startsWith('image/'));
        if(images.reduce((sum,file)=>sum+file.size,0)>20*1024*1024)throw Error('图片合计超过 20 MiB，请分批粘贴');
        const prepared=await Promise.all(images.map(pastedImage));items=[];
        for(const image of prepared)items.push(await api.call('chat.image',{id:workspace.id,...image}));
        if(others.length)items.push(...await api.importFiles(workspace.id,others));
      }
      if(alive.current)addAttachments(items);
    }catch(e:any){if(alive.current){setError(e.message+(original?'；原路径已保留在草稿。':''));if(original)onDraft((input.current?.value||'')+'\n'+original)}}
    finally{importing.current=false;if(alive.current)setAttachmentBusy(false)}
  }
  const input=useRef<HTMLTextAreaElement>(null);
  const lock=useRef(false),alive=useRef(true),scroll=useRef<HTMLDivElement>(null),follow=useRef(true),historyContent=useRef<HTMLDivElement>(null);
  const stopGate=useRef(new ConversationStopGate()),[,renderStop]=useState(0);
  stopGate.current.observe(tab.taskId?{id:workspace.id,taskId:tab.taskId}:undefined);
  const stopping=!!tab.taskId&&stopGate.current.pending({id:workspace.id,taskId:tab.taskId});
  // 当前开放目标和正在执行分开；持久等待不能通过旧 running 日志或历史选择恢复插入/队列。
  const currentRun=threadResumeRun(runs,resumeRunId),latest=currentRun??runs.at(-1),{mainRunning,executing,taskOpen,waiting,canContinueQueue,shouldQueue}=conversationExecutionState(currentRun,graph.openScope,queued.length);
  useEffect(()=>{if(!executing||admissionState.waitingOnly)return;const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer)},[executing,admissionState.waitingOnly]);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false}},[]);
  useEffect(()=>{if(!active)return;let cancelled=false;void api.call('models.list').then(x=>{if(!cancelled)setModels(x)}).catch((e:Error)=>{if(!cancelled)setError(e.message)});return()=>{cancelled=true}},[workspace.id,active,mainAgent.value?.revision]);
  // 历史/审批串行轮询，队列由独立增量 Hook 同步，不再等待日志读取。
  useEffect(()=>{let cancelled=false,timer:ReturnType<typeof setTimeout>;setRuns([]);setThreadIssues([]);setResumeRunId(undefined);setLoaded(false);
    async function poll(){try{const list:HistoryItem[]=await api.call('loop.list',{id:workspace.id});if(!cancelled)setHistory(old=>JSON.stringify(old)===JSON.stringify(list)?old:list);const view:ConversationThreadView=tab.taskId?await api.call('loop.threadView',{id:workspace.id,taskId:tab.taskId}):{runs:[],issues:[]};const data=view.runs;
      const approvals:ChatApproval[]=tab.taskId?await api.call('loop.approvals',{id:workspace.id,taskId:tab.taskId}):[];
      const questions:PendingQuestion[]=tab.taskId?await api.call('loop.questions',{id:workspace.id,taskId:tab.taskId}):[];
      if(!cancelled){setQuestions(old=>JSON.stringify(old)===JSON.stringify(questions)?old:questions);setApprovals(old=>JSON.stringify(old)===JSON.stringify(approvals)?old:approvals);setThreadIssues(old=>JSON.stringify(old)===JSON.stringify(view.issues)?old:view.issues);setResumeRunId(view.resumeRunId);
        // 日志仅追加；版本未变时不替换数组、不触发正文跟随滚动。
        setRuns(old=>old.length===data.length&&old.every((r,i)=>r.runId===data[i].runId&&r.status===data[i].status&&r.events.at(-1)?.seq===data[i].events.at(-1)?.seq)?old:data);setLoaded(true);setPollError('')}
    }catch(e:any){if(!cancelled){setPollError(e.message);setLoaded(false)}}finally{if(!cancelled)timer=setTimeout(()=>void poll(),1000)}}
    void poll();return()=>{cancelled=true;clearTimeout(timer)};
  },[workspace.id,tab.taskId]);
  // 正文排版后、浏览器绘制前跟随末尾，避免 Markdown 高度变化误判为用户向上滚动。
  useLayoutEffect(()=>{if(section==='chat'&&follow.current&&scroll.current)scroll.current.scrollTop=scroll.current.scrollHeight},[runs,questions,section]);
  // 成员输出在自己的 Hook 中更新；只在用户仍跟随底部时跟随高度，避免抢走查看旧消息的位置。
  useEffect(()=>{const node=historyContent.current;if(!node||typeof ResizeObserver==='undefined')return;const observer=new ResizeObserver(()=>{if(section==='chat'&&follow.current&&scroll.current)scroll.current.scrollTop=scroll.current.scrollHeight});observer.observe(node);return()=>observer.disconnect()},[section,tab.taskId]);
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
  /** Skill 点击只发送明确的流程调用；正文和附件留在草稿中，由用户随后自愿描述，不强制补齐格式。 */
  async function send(skill?:FeedbackSkillTitle){const message=skill?`请调用「${skill}」Skill，提示我用一句话描述问题或愿望即可，其余信息自愿补充，不强制追问。`:(tab.draft||'').trim()||(attachments.length?'请查看附加的资料。':'');if(!message)return;
    const sentAttachments=skill?[]:attachments;
    if(tab.taskId&&stopGate.current.pending({id:workspace.id,taskId:tab.taskId}))return;
    await operate(async()=>{
      if(!modelAvailable||!selectedProfile||!selectedModel)throw Error('请为当前引擎选择兼容的已启用模型');
      const options={engine:chosenEngine,profileId:selectedProfile.id,model:selectedModel.id,permission,collaborationMode};
      if(tab.taskId&&!shouldQueue&&!resumeRunId)throw Error('当前执行记录不可安全续接，请先核实任务记录。');
      // 即使离开页面，旧回调也只更新原工作区页签；历史可找回已启动任务。
      const accepted=(result:{taskId:string})=>{onBind(result.taskId);if(!skill){onDraft('');onAttachments([])}};
      const taskId=tab.taskId,runId=resumeRunId;
      const queued=!!taskId&&shouldQueue;
      if(taskId&&!queued&&!runId)throw Error('当前执行记录不可安全续接，请先核实任务记录。');
      let result:{taskId:string};
      if(taskId&&shouldQueue){result=await api.call('loop.enqueue',{id:workspace.id,taskId,message,attachments:sentAttachments.map(a=>a.id),options});accepted(result)}
      else if(taskId&&runId)result=await api.call('loop.resume',{id:workspace.id,taskId,runId,message,attachments:sentAttachments.map(a=>a.id),options});
      else result=await api.call('loop.chat',{id:workspace.id,message,attachments:sentAttachments.map(a=>a.id),options});
      if(!queued)accepted(result);
      if(alive.current){const view:ConversationThreadView=await api.call('loop.threadView',{id:workspace.id,taskId:result.taskId});if(alive.current){setRuns(view.runs);setThreadIssues(view.issues);setResumeRunId(view.resumeRunId);setLoaded(true);follow.current=true}}
    });
  }
  const selectedPair=(()=>{try{const value=JSON.parse(selection||'[]');return Array.isArray(value)?value:[]}catch{return []}})();
  const selectedProfile=models?.profiles.find(p=>p.id===(selectedPair[0]||models?.selectedId));
  const selectedModel=selectedProfile?.models.find(m=>m.id===(selectedPair[1]||selectedProfile.defaultModel));
  const chosenEngine=pendingEngine??selectedRuntime?.engine??'pi';
  const compatibleProfiles=models?.profiles.map(p=>({...p,models:p.models.filter(m=>providerSupportsEngine(chosenEngine,p,m.id))})).filter(p=>p.models.length)??[];
  const defaultProfile=compatibleProfiles.find(p=>p.id===models?.selectedId);
  const defaultModel=defaultProfile?.models.find(m=>m.id===defaultProfile.defaultModel&&m.enabled);
  /** 切换优先保留兼容模型；否则选兼容默认/首项，没有模型时保留新引擎并禁止发送。 */
  async function chooseEngine(value:string){
    const next=loopEngineSchema.parse(value);
    const profiles=models?.profiles.filter(p=>p.models.some(m=>m.enabled&&providerSupportsEngine(next,p,m.id)))??[];
    const profile=selectedProfile&&selectedModel?.enabled&&providerSupportsEngine(next,selectedProfile,selectedModel.id)?selectedProfile:profiles.find(p=>p.id===models?.selectedId)??profiles[0];
    const candidates=profile?.models.filter(m=>m.enabled&&providerSupportsEngine(next,profile,m.id));
    const model=profile===selectedProfile&&selectedModel?.enabled&&candidates?.includes(selectedModel)?selectedModel:candidates?.find(m=>m.id===profile?.defaultModel)??candidates?.[0];
    if(!profile||!model){setPendingEngine(next);return}
    if(await mainAgent.save({engine:next,profileId:profile.id,modelId:model.id})){setPendingEngine(undefined);if(taskOpen)setNextTip(Date.now())}
  }
  async function chooseModel(value:string){
    const [profileId,modelId]=value?JSON.parse(value):[defaultProfile?.id,defaultModel?.id];
    if(profileId&&modelId&&await mainAgent.save({engine:chosenEngine,profileId,modelId})){setPendingEngine(undefined);if(taskOpen)setNextTip(Date.now())}
  }
  const modelAvailable=!!mainAgent.value&&!mainAgent.busy&&!mainAgent.error&&!pendingEngine&&!!selectedProfile&&!!selectedModel?.enabled&&providerSupportsEngine(chosenEngine,selectedProfile,selectedModel.id);
  // 两处目标卡共享同一控制器。明确冻结实际模型与权限，补充不引用、不清空聊天草稿和附件。
  const continuationConfig=modelAvailable&&selectedProfile&&selectedModel?.enabled?{options:{engine:chosenEngine,provider:'cbim-'+selectedProfile.id,profileId:selectedProfile.id,model:selectedModel.id,permission},label:(selectedModel.name||selectedModel.id)+' · '+{read:'只读访问',ask:'默认权限',execute:'完全访问'}[permission]}:undefined;
  const continuation=useScopeContinuation(workspace.id,tab.taskId,graph,continuationConfig,graph.refresh,active);
  const humanContinuation=useHumanContinuation(workspace.id,tab.taskId,graph,continuationConfig,graph.refresh);
  // 业务重规划仅共享实际模型身份，权限在独立表单默认 ask 并由用户明确选择；两处卡片共用一份请求。
  const replan=useScopeReplan(workspace.id,tab.taskId,graph,modelAvailable&&selectedProfile&&selectedModel?.enabled?{options:{engine:chosenEngine,provider:'cbim-'+selectedProfile.id,profileId:selectedProfile.id,model:selectedModel.id},label:selectedModel.name||selectedModel.id}:undefined,graph.refresh,id=>{graph.selectScope(id);setSelectedTaskId(graph.graph?.root.nodeId);setSection('tasks')});
  // 影响核实共用实际会话状态和模型，仅显式新建核实任务时使用模型；不触碰聊天草稿。
  // 保留全部恢复依赖；当前模型、图或历史选择一旦变化，旧工具卡也必须获得新上下文。
  const recovery=useMemo<ExecutionRecoveryContext>(()=>({state:graph,refresh:graph.refresh,model:modelAvailable&&selectedProfile&&selectedModel?.enabled?{options:{engine:chosenEngine,provider:'cbim-'+selectedProfile.id,profileId:selectedProfile.id,model:selectedModel.id},label:selectedModel.name||selectedModel.id}:undefined,showScope:id=>{graph.selectScope(id);setSelectedTaskId(graph.graph?.root.nodeId);setSection('tasks')}}),[graph,modelAvailable,selectedProfile,selectedModel,chosenEngine]);
  // 人工决定只有一份本机会话控制器，保存不改普通草稿、权限或当前等待状态。
  const humanDecisions=useHumanDecisions(workspace.id,tab.taskId,graph,graph.refresh);
  // 初次周期读取尚未完成时不能凭运行日志猜测 resume；等待信息就绪后再决定发送或排队。
  const recoveryReason=tab.taskId&&!taskOpen?threadRecoveryReason(currentRun):undefined;
  const canSendRequest=active&&loaded&&!pollError&&!graph.loading&&!busy&&!stopping&&!attachmentBusy&&modelAvailable&&!recoveryReason;
  const canSend=canSendRequest&&(!!tab.draft?.trim()||attachments.length>0);
  // 标题只展示用户首行目标，避免把附加参考资料和内部标记放进导航。

  const queueOperation=async(action:'loop.queueChange'|'loop.queueEdit'|'loop.queueMove',args:Record<string,unknown>)=>{let saved=false;await operate(async()=>{await api.call(...checkedIpcCall(action,{id:workspace.id,taskId:tab.taskId,...args}));saved=true});return saved};
  const queueChange=(queueId:string,action:string)=>void queueOperation('loop.queueChange',{queueId,action});
  const queueContinue=()=>{const taskId=tab.taskId;if(canContinueQueue&&!graph.loading&&taskId&&!stopGate.current.pending({id:workspace.id,taskId}))void operate(async()=>{await api.call('loop.queueContinue',{id:workspace.id,taskId})})};
  return <div className="chat-page"><nav className="session-tabs" role="tablist" aria-label="会话内容"><button id={'session-chat-'+tab.id} role="tab" aria-selected={section==='chat'} aria-controls={'session-dialog-'+tab.id} onClick={()=>selectSection('chat')}>对话</button><button id={'session-tasks-'+tab.id} role="tab" aria-selected={section==='tasks'} aria-controls={'session-task-panel-'+tab.id} onClick={()=>selectSection('tasks')}>任务视图</button><button id={'session-automation-'+tab.id} role="tab" aria-selected={section==='automation'} aria-controls={'session-automation-panel-'+tab.id} onClick={()=>selectSection('automation')}>自动化</button></nav>
    <section className="session-task-panel" role="tabpanel" id={'session-automation-panel-'+tab.id} aria-labelledby={'session-automation-'+tab.id} hidden={section!=='automation'}><AutomationView key={workspace.id+':'+workspace.instanceId} workspace={workspace} active={active&&section==='automation'} onOpenRun={onOpenAutomationRun}/></section>
    <>{navigationError&&<p role="alert" className="shell-alert" data-testid="runtime-navigation-error">{navigationError}</p>}</><AdmissionNotice tickets={admissionState.waiting} error={tab.taskId?admission.error:undefined}/>
    {section==='tasks'&&<section className="session-task-panel" role="tabpanel" id={'session-task-panel-'+tab.id} aria-labelledby={'session-tasks-'+tab.id}><SessionTaskView active={active} workspaceId={workspace.id} workspaceInstanceId={workspace.instanceId} taskId={tab.taskId} runs={runs} historyIssueCount={threadIssues.length} queued={queued} now={now} busy={busy} stopping={stopping} graph={graph.graph} scopeState={graph} continuation={continuation} replan={replan} humanDecisions={humanDecisions} humanContinuation={humanContinuation} recovery={recovery} graphLoading={graph.loading} graphError={graph.error} onRefreshGraph={graph.refresh} selectedTaskId={selectedTaskId} onSelectTask={selectTask} onQueueChange={queueChange} onQueueContinue={queueContinue} onChat={()=>selectSection('chat')} onStop={()=>void stopCurrent()}/><ThreadHistoryNotice issues={threadIssues}/>{pollError&&<p role="alert">{pollError}</p>}</section>}
    <div className="conversation-dialog" hidden={section!=='chat'} role="tabpanel" id={'session-dialog-'+tab.id} aria-labelledby={'session-chat-'+tab.id}>
    <div className="chat-toolbar"><Icon name="chat" size={15}/><span className="chat-title">{member?.name??(tab.customTitle?tab.title:latest?.task.goal.split('\n')[0]||'新对话')}</span><details className="chat-menu chat-header-menu" onKeyDown={e=>{if(e.key==='Escape')e.currentTarget.removeAttribute('open')}}><summary aria-label="对话菜单" title="对话菜单">···</summary><div className="chat-menu-content"><button disabled={busy} onClick={()=>{onBind(undefined);setRuns([]);setError('')}}><Icon name="plus" size={15}/>新对话</button><section className="conversation-history" aria-label="对话历史"><h3>历史对话</h3><ConversationEntries items={conversations.map(item=>({id:item.id,title:item.title==='对话'&&!item.customTitle?'新对话':item.title,running:!!item.taskId&&runningTaskIds.includes(item.taskId)}))} selected={tab.id} disabled={busy} onSelect={onSelectConversation} onRename={onRenameConversation} onRemove={onRemoveConversation}/></section><button onClick={()=>openView('knowledge')}>项目架构</button><button onClick={()=>openView('team')}>团队能力</button><button onClick={openSettings}>模型设置</button></div></details></div>
    {(error||pollError||queueError)&&<div className="shell-alert" role="alert">{error||pollError||queueError}</div>}
    {history.some(h=>h.status==='unreadable')&&<p role="alert">部分执行记录无法读取，请检查本机任务日志。</p>}
    <div className="chat-scroll" ref={scroll} onScroll={()=>{const e=scroll.current!;follow.current=e.scrollHeight-e.scrollTop-e.clientHeight<80}}>
      {!tab.taskId&&<div className="chat-welcome"><span className="overline">CBIM · 主 Agent</span><h2>有什么可以帮你？</h2><p>聊聊想法，提出问题，或告诉我你想完成的工作。</p></div>}
      {tab.taskId&&!loaded&&!runs.length&&<p role="status">正在读取对话记录…</p>}
      <ThreadHistoryNotice issues={threadIssues}/>
      {tab.taskId&&!selectedChild&&(selectedTopicId||graph.openScope)&&<ScopeGoalPanel state={graph} compact testId="conversation-goal-summary" onSelectTask={viewMember} continuation={continuation} replan={replan} humanDecisions={humanDecisions} humanContinuation={humanContinuation}/>}
      {latest?.task.workflowContext&&<details className="chat-context"><summary>任务上下文 · {latest.task.goal.slice(0,80)}</summary><p>模块：{latest.task.moduleIds.join('、')}<br/>Agent：{latest.task.agentId}<br/>Workflow：{latest.task.workflowContext?.workflowId}<br/>责任人：{latest.task.responsiblePerson||'未指定'}</p><ul>{latest.task.acceptance.map((a,i)=><li key={i}>{a}</li>)}</ul></details>}
      <div ref={historyContent}>{selectedChild?(member?<MemberConversation key={member.session.sessionId} member={member} graph={graph.graph} scopes={graph.scopes} active={active&&section==='chat'} onSelectTask={viewMember}/>:<p role="status">正在同步成员对话；当前没有可验证的成员身份。</p>):tab.taskId&&<ConversationTopics {...topics} queued={queued} selectedId={selectedTopicId} onSelect={selectTopic} onSelectTask={viewMember} renderRun={run=><ConversationTurn key={run.runId} run={run} workspaceId={workspace.id} now={run.status==='running'?now:0} recovery={recovery} active={active&&section==='chat'} onSelectTask={viewMember}/>}/>}</div>
      {graph.error&&<p role="alert">{graph.error} <button onClick={graph.refresh}>重新同步成员动态</button></p>}
      {questions.map(q=><QuestionCard key={q.id} request={q} onAnswer={async answers=>{await api.call('loop.answerQuestion',{id:workspace.id,taskId:q.taskId,questionId:q.id,answers})}}/>)}
      {currentRun&&!mainRunning&&currentRun.unresolvedTools.length>0&&<div className="chat-reconcile" data-testid="unresolved-tools-notice"><h3>原操作结果尚未确认</h3><p>展开原工具记录，明确核实当前影响并保存处置。需要继续调查时创建独立只读核实任务；原记录保留，勾选调用标识不能恢复原运行。</p><ul>{currentRun.unresolvedTools.map(id=><li key={id}><code>{id}</code></li>)}</ul></div>}
    </div>
    <div className="chat-composer">
      {loaded&&!pollError&&!graph.loading&&recoveryReason&&<ThreadRecoveryNotice reason={recoveryReason} disabled={!active||busy||stopping||attachmentBusy} onInspect={()=>{graph.selectScope(undefined);setSelectedTaskId(graph.graph?.root.nodeId);setSection('tasks')}} onNewConversation={()=>onBind(undefined)}/>}
      {taskOpen&&!!nextTip&&<p className="composer-next-tip" role="status">附件随下次发送；引擎、模型和权限修改在下一轮执行生效。</p>}
      {waiting&&<p className="composer-next-tip" role="status" data-testid="conversation-waiting">当前话题等待补充；普通发送会排队为新任务。需要补充时，请打开该话题的“补充并继续”。
        {graph.selectedScopeId!==graph.waitingScope?.scopeId&&<button disabled={busy} onClick={()=>selectTopic(graph.waitingScope?.scopeId)}>打开等待中的话题</button>}
        {graph.detailLoading&&'正在读取等待目标…'}
        {!!queued.length&&' 队列不会自动越过等待中的话题。'}
      </p>}
      {(continuation.error||continuation.record&&(waiting||['unknown','submitting','rejected'].includes(continuation.record.attempt?.phase??'')))&&<ScopeContinuationForm state={continuation}/>}
      {approvals.map(a=><div className="chat-approval" key={a.id}><b>允许本次 {a.name} 操作？</b><pre>{JSON.stringify(a.input,null,2)}</pre><button disabled={busy} onClick={()=>void operate(async()=>{await api.call('loop.approve',{id:workspace.id,taskId:a.taskId,approvalId:a.id,allow:true})})}>允许一次</button><button disabled={busy} title="仅允许当前这次执行中的后续操作；结束或停止后自动恢复确认，知识库保护不变" onClick={()=>void operate(async()=>{await api.call('loop.approve',{id:workspace.id,taskId:a.taskId,approvalId:a.id,allow:true,allowAll:true})})}>本次任务全部通过</button><button disabled={busy} onClick={()=>void operate(async()=>{await api.call('loop.approve',{id:workspace.id,taskId:a.taskId,approvalId:a.id,allow:false})})}>拒绝</button></div>)}

      <UsageStatus runs={runs} currentRun={currentRun??null} historyIncomplete={threadIssues.length>0} now={now} placement="above" waitingApproval={approvals.length>0||questions.length>0} activity={admissionState.waitingOnly?{label:'正在等待执行资格',active:false,tone:'neutral',waitingSince:admissionState.waitingSince}:graph.currentGoalView.phase!=='none'?{...graph.currentGoalView,active:executing,waitingSince:graph.waitingScope?.wait?.createdAt}:undefined}/>
      {mainAgent.error&&<p role="alert">{mainAgent.error}</p>}
      {pendingEngine&&<p role="status">选择兼容模型后将保存主 Agent 配置。</p>}
      {!modelAvailable&&models&&mainAgent.value&&!mainAgent.busy&&<p className="chat-model-notice">{compatibleProfiles.some(p=>p.models.some(m=>m.enabled))?'所选模型已不可用，请重新选择。':engineLabel(chosenEngine)+' 暂无兼容的已启用模型，请检查模型接口协议。'}<button onClick={openSettings}>前往模型设置</button></p>}
      <ComposerCard className={COMPOSER_CONTENT_CLASS+(dragActive?' drag-active':'')} aria-busy={attachmentBusy}
        onDragEnter={e=>{if(e.dataTransfer.types.includes('Files')){e.preventDefault();dragDepth.current++;setDragActive(true)}}}
        onDragOver={e=>{if(e.dataTransfer.types.includes('Files')){e.preventDefault();e.dataTransfer.dropEffect=busy||attachmentBusy?'none':'copy'}}}
        onDragLeave={()=>{dragDepth.current=Math.max(0,dragDepth.current-1);if(!dragDepth.current)setDragActive(false)}}
        onDrop={e=>{e.preventDefault();dragDepth.current=0;setDragActive(false);if(e.dataTransfer.files.length)void importFiles(Array.from(e.dataTransfer.files))}}
        onPaste={e=>{if(e.target!==input.current||busy||attachmentBusy||importing.current)return;if(e.clipboardData.files.length){e.preventDefault();void importPaste(Array.from(e.clipboardData.files));return}const text=e.clipboardData.getData('text/plain'),paths=pastedLocalPaths(text);if(paths){e.preventDefault();void importPaste([],paths,text)}}}>
        <MessageQueue embedded items={queued} busy={busy} continueDisabled={stopping||waiting||graph.loading} onChange={queueChange} onContinue={queueContinue}
          onEdit={(queueId,message,expected)=>queueOperation('loop.queueEdit',{queueId,message,expected})}
          onMove={(queueId,beforeId)=>void queueOperation('loop.queueMove',{queueId,beforeId})}
          />
        {dragActive&&<div className="composer-drop-target"><Icon name="folder" size={24}/><b>松开以添加到对话</b><small>文件和文件夹会保存在本机附件快照中</small></div>}
        {attachmentBusy&&<div className="composer-upload-state" role="status"><span className="work-spinner"/>正在准备附件…</div>}
        <ComposerAttachments items={attachments} workspaceId={workspace.id} disabled={busy||attachmentBusy} onRemove={id=>onAttachments(attachments.filter(a=>a.id!==id))}/>
        {selectedChild&&<p className="composer-next-tip">发送给主 Agent · 当前查看 {member?.name??'成员对话'}</p>}<textarea ref={input} aria-label="对话草稿" disabled={busy} value={tab.draft||''} onChange={e=>onDraft(e.target.value)} placeholder="向主 Agent 发送新任务…" title="Enter 发送新任务或排队，Shift+Enter 换行；补充已有话题请使用话题内入口" onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing&&canSend){e.preventDefault();void send()}}}/>
        <div className="chat-controls"><div className="chat-controls-left"><AttachmentMenu workspaceId={workspace.id} disabled={busy||attachmentBusy} attachmentsFull={attachments.length>=12} skillsDisabled={!canSendRequest} onBusy={setAttachmentBusy} onAdd={addAttachments} onSkill={skill=>{if(canSendRequest)void send(skill)}}/><ComposerPicker label="协作模式" value={collaborationMode} onChange={v=>setCollaborationMode(v as 'auto'|'team')} disabled={busy||taskOpen} options={[
          {value:'auto',label:'自动模式',icon:'sparkles',description:'主 Agent 按目标直接执行，必要时交给已登记的负责岗位；权限和人工验收保持原要求'},
          {value:'team',label:'团队模式',icon:'team',description:'优先按自定义负责岗位分工；未配置负责 Agent 的模块由主 Agent 在原会话执行'},
        ]}/><ComposerPicker label="执行权限" value={permission} onChange={v=>{setPermission(v as ChatPermission);if(taskOpen)setNextTip(Date.now())}} disabled={busy} warning={permission==='execute'} options={[
          {value:'read',label:'只读访问',icon:'knowledge',description:'只查看、分析和预览，不修改业务文件或正式知识，不执行命令'},
          {value:'ask',label:'默认权限',icon:'hand',description:'修改业务文件、提交知识和运行命令前逐次确认'},
          {value:'execute',label:'完全访问',icon:'warning',description:'自动执行业务文件、知识提交和命令操作；仍检查工作区边界及知识版本'},
        ]}/></div>
        <div className="chat-controls-right"><ComposerPicker label="Loop 引擎" value={chosenEngine} disabled={busy||mainAgent.busy||!models||!mainAgent.value} fallbackLabel="选择引擎" onChange={value=>void chooseEngine(value)} options={loopEngineSchema.options.map(engine=>({value:engine,label:engineLabel(engine)}))}/><ComposerPicker label="对话模型" value={pendingEngine?'':selection} onChange={value=>void chooseModel(value)} disabled={busy||mainAgent.busy||!models||!mainAgent.value} fallbackLabel={models?'所选模型不可用':'正在加载模型…'} searchable align="right" options={[
          ...(defaultModel?[{value:'',label:defaultModel.name||defaultModel.id,description:'使用设置中的默认供应商和模型',group:'默认'}]:[]),
          ...(compatibleProfiles.flatMap(p=>p.models.filter(m=>m.enabled).map(m=>({value:JSON.stringify([p.id,m.id]),label:m.name||m.id,description:p.name+' / '+m.id,group:p.name})))||[]),
        ]}/>{taskOpen&&<SendButton disabled={stopping} isStreaming stopLabel={waiting?'取消当前任务':undefined} onClick={()=>void stopCurrent()}/>} {(!taskOpen||!!tab.draft?.trim()||attachments.length>0)&&<SendButton disabled={!canSend} queued={shouldQueue} onClick={()=>void send()}/>}</div></div>
      </ComposerCard>
      <div className="chat-footer"><span><Icon name="folder" size={13}/>{workspace.name}</span><UsageStatus runs={runs} currentRun={currentRun??null} historyIncomplete={threadIssues.length>0} now={now} placement="footer" capacity={selectedModel?.contextWindow}/></div>
    </div>
    </div>
  </div>
}
