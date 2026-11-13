import {expect,it} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {SessionReadProjection,SessionScopeProjection,completeSessionRead,scopeGoalView,currentScope,type ScopeGoalState} from '../src/view/tasks/scope-state';
import {ScopeGoalPanel,goalTaskReference} from '../src/view/tasks/ScopeGoalPanel';
import {MemberTaskDetail} from '../src/view/tasks/MemberTaskDetail';
import {SessionTaskView,sessionRoot} from '../src/view/tasks/SessionTaskView';
import {applyGraphBatch} from '../src/logic/tasks/rules/graph-reducer';
import {summarizeScope} from '../src/logic/tasks/rules/scope-view';
import type {DispatchScope,DispatchSessionRead,ScopeSnapshot,ScopeDetailRead,GraphEventBatch,GraphSnapshot,TaskNode} from '../src/bridge/contracts/dispatch';

const identity={workspaceId:'workspace',rootSessionId:'main-session'},time='2026-11-07T00:00:00.000Z';
const agent={agentId:'cbim:main',agentInstanceId:'main',agentSessionId:'channel',name:'主 Agent'};
const initial:GraphEventBatch={version:1,identity,streamId:'graph',seq:1,eventId:'first',commandId:'open',cause:'graph.created',committedAt:time,changes:[{type:'root.upserted',root:{kind:'session-root',nodeId:'session:main-session',identity,agent,revision:1,createdAt:time}},{type:'agent.upserted',agent:{agentId:agent.agentId,agentInstanceId:agent.agentInstanceId,name:agent.name,revision:1,state:'idle',waitingTaskIds:[]}}]};
const graph=applyGraphBatch(undefined,initial),streamId='scopes:graph';
const scope=(scopeId='scope-one'):DispatchScope=>({scopeId,...identity,status:'active',createdAt:time,goal:{revision:1,input:{message:'本轮真实输入，不是首次会话标题',attachmentIds:[]}}});
const snapshot=(scopes:DispatchScope[],seq:number):ScopeSnapshot=>({identity,cursor:{...identity,kind:'scopes',streamId,seq},scopes:scopes.map(item=>summarizeScope(item,streamId,seq))});
const detail=(value:DispatchScope,seq=1):ScopeDetailRead=>({mode:'updated',stamp:{scopeId:value.scopeId,streamId,seq},scope:value});
function reset(value=scope(),seq=1):DispatchSessionRead{const scopes=snapshot([value],seq);return {graph:{mode:'reset',reason:'initial',snapshot:graph,cursor:graph.cursor},scopes:{mode:'reset',reason:'initial',snapshot:scopes,cursor:scopes.cursor},detail:detail(value,seq)}}
function planned(){const value=scope();value.goal!.revision=2;value.goal!.plan={revision:2,runId:'main-run',recordedAt:time,knowledgeRevision:'knowledge',graphCursor:{streamId:'graph',seq:1},objective:'当前周期的治理目标',constraints:['仅管理知识'],criteria:[{id:'c1',kind:'evidence',text:'提供真实提交证据'}],assignments:[{agentId:'cbim:main',agentName:'主 Agent',teamId:'.cbim/team',moduleIds:[],moduleNames:[],criterionIds:['c1'],reason:'治理知识'}],reason:'按真实目标安排'};return value}
function reviewed(){const value=planned();value.goal!.revision=3;value.goal!.review={revision:3,planRevision:2,runId:'main-run',recordedAt:time,knowledgeRevision:'knowledge',graphCursor:{streamId:'graph',seq:1},observedSeq:10,lastEffectSeq:4,decision:'complete',checks:[{criterionId:'c1',outcome:'satisfied',reason:'有真实证据',evidence:[{kind:'main-knowledge',toolCallIds:['commit-one']}]}],superseded:[],gaps:[],reason:'程序尚需复核'};return value}
it('未建立业务计划的结束状态不把独立知识写入显示成目标未完成',()=>{
 const unplanned=scope();unplanned.status='closed';unplanned.outcome='failed';
 expect(scopeGoalView(summarizeScope(unplanned,streamId,1))).toMatchObject({label:'业务目标未建立',tone:'warning'});
 const business=planned();business.status='closed';business.outcome='failed';
 expect(scopeGoalView(summarizeScope(business,streamId,1)).label).toBe('目标未完成');
});
function view(value:DispatchScope):ScopeGoalState{const summary=summarizeScope(value,streamId,1),goalView=scopeGoalView(summary,graph);return {scopes:[summary],selectedScopeId:value.scopeId,selectedScope:value,openScope:value.status!=='closed'?summary:undefined,activeScope:value.status==='active'?summary:undefined,waitingScope:value.status==='waiting'?summary:undefined,selectedGoalView:goalView,currentGoalView:goalView,graph,loading:false,detailLoading:false,error:'',selectScope:()=>{}}}

it('替代审阅只导航已同步的本周期节点，旧节点与新成果各自保留原身份',()=>{
  const value=reviewed();value.goal!.review!.superseded=[{taskId:'old-task',replacementTaskIds:['new-task'],reason:'新负责人提供独立候选'}];
  const member=(taskId:string):TaskNode=>({kind:'task',nodeId:'task:'+taskId,taskId,identity,scopeId:value.scopeId,requester:agent,assignee:{agentId:'static-role',agentInstanceId:taskId+'-instance',agentSessionId:taskId+'-session',name:taskId==='old-task'?'原负责人':'新负责人'},modules:[],goal:taskId+'目标',acceptance:[],revision:1,planRevision:1,status:taskId==='old-task'?'cancelled':'result_ready',awaitedChildren:[],runIds:[],createdAt:time,updatedAt:time});
  const old=member('old-task'),next=member('new-task'),state={...view(value),graph:{...graph,tasks:[old,next]}};
  expect(goalTaskReference(state,'old-task')).toBe(old);expect(goalTaskReference(state,'new-task')).toBe(next);
  const html=renderToStaticMarkup(createElement(ScopeGoalPanel,{state,onSelectTask:()=>{}}));
  expect(html).toContain('原任务与替代成果');expect(html.match(/data-testid="scope-task-reference"/g)).toHaveLength(2);expect(html).toContain('原负责人');expect(html).toContain('新负责人');
  expect(renderToStaticMarkup(createElement(ScopeGoalPanel,{state}))).not.toContain('data-testid="scope-task-reference"');
  expect(goalTaskReference({...state,selectedScopeId:'foreign'},'old-task')).toBeUndefined();
  for(const changed of [{...state.graph,identity:{...identity,workspaceId:'foreign'}},{...state.graph,tasks:[old,old,next]},{...state.graph,tasks:[{...old,scopeId:'foreign'},next]},{...state.graph,tasks:[{...old,identity:{...identity,rootSessionId:'foreign'}},next]}]){
    const invalid={...state,graph:changed};expect(goalTaskReference(invalid,'old-task')).toBeUndefined();const rendered=renderToStaticMarkup(createElement(ScopeGoalPanel,{state:invalid,onSelectTask:()=>{}}));expect(rendered).not.toContain('data-task-id="old-task"');expect(rendered).toContain('old-task');
  }
  expect(state.graph.edges).toEqual(graph.edges);expect(old.assignee.agentInstanceId).toBe('old-task-instance');
});

it('目标与成员只展示各自持久的指定流程，切回无选择历史不补造选择',()=>{
  const moduleId='.cbim/workspace/game',workflowId=moduleId+'/workflows/validate_json',value=planned();
  value.goal!.plan!.assignments[0]={...value.goal!.plan!.assignments[0],agentId:'cbim:executor',agentName:'执行者',moduleIds:[moduleId],moduleNames:['游戏'],workflowSelections:[{moduleId,workflowId}]};
  const selected=renderToStaticMarkup(createElement(ScopeGoalPanel,{state:view(value)}));expect(selected).toContain('data-testid="goal-workflow-selection"');expect(selected).toContain('指定流程：游戏');expect(selected).toContain(workflowId);
  const old=structuredClone(value);delete old.goal!.plan!.assignments[0].workflowSelections;
  const oldHtml=renderToStaticMarkup(createElement(ScopeGoalPanel,{state:view(old)}));expect(oldHtml).not.toContain('goal-workflow-selection');expect(oldHtml).not.toContain(workflowId);expect(old.goal!.plan!.assignments[0]).not.toHaveProperty('workflowSelections');
  const task:TaskNode={kind:'task',nodeId:'task:member',taskId:'member',identity,requester:agent,assignee:{...agent,agentId:'cbim:executor',name:'执行者'},modules:[{moduleId,name:'游戏',knowledgeRevision:'knowledge',maintenanceBindingId:'maintenance',maintainerPersonIds:['owner'],workflow:{kind:'module',id:workflowId,version:'frozen'}}],workflowSelections:[{moduleId,workflowId}],goal:'验证文件',acceptance:[],revision:1,planRevision:1,status:'queued',awaitedChildren:[],runIds:[],createdAt:time,updatedAt:time};
  const render=(item:TaskNode)=>renderToStaticMarkup(createElement(MemberTaskDetail,{workspaceId:identity.workspaceId,rootSessionId:identity.rootSessionId,task:item}));
  const current=render(task);expect(current).toContain('指定流程：');expect(current).toContain('data-workflow-id="'+workflowId+'"');
  const legacy=structuredClone(task);delete legacy.workflowSelections;const historic=render(legacy);expect(historic).toContain(workflowId);expect(historic).not.toContain('指定流程：');expect(legacy).not.toHaveProperty('workflowSelections');
});

it('目标变化独立于graph游标，noop保留全部对象引用并省略大正文',()=>{
  const state=new SessionReadProjection(identity),first=reset();state.apply(first);
  const priorGraph=state.graph,priorScopes=state.scopes,priorDetail=state.detail();
  state.apply({graph:{mode:'noop',cursor:graph.cursor},scopes:{mode:'noop',cursor:state.scopeCursor!},detail:{mode:'noop',stamp:state.detailStamp()!}});
  expect(state.graph).toBe(priorGraph);expect(state.scopes).toBe(priorScopes);expect(state.detail()).toBe(priorDetail);
  const next=planned(),summary=summarizeScope(next,streamId,2);
  state.apply({graph:{mode:'noop',cursor:graph.cursor},scopes:{mode:'delta',from:state.scopeCursor!,cursor:{...state.scopeCursor!,seq:2},batches:[{identity,streamId,seq:2,scopes:[summary]}],hasMore:false},detail:detail(next,2)});
  expect(state.graph).toBe(priorGraph);expect(state.detail()!.goal!.plan!.objective).toBe('当前周期的治理目标');expect(state.scopeCursor!.seq).toBe(2);
});

it('组合读取任一部分错身份/断档/同版冲突均不提交另一部分的新图',()=>{
  const state=new SessionReadProjection(identity);state.apply(reset());const priorGraph=state.graph,priorScope=state.scopes;
  const batch:GraphEventBatch={...initial,seq:2,eventId:'second',commandId:'update',cause:'agent.state_changed',changes:[{type:'agent.upserted',agent:{...graph.agents[0],revision:2,state:'communicating'}}]};
  const update={mode:'delta' as const,from:graph.cursor,cursor:{...graph.cursor,seq:2},batches:[batch],hasMore:false};
  expect(()=>state.apply({graph:update,scopes:{mode:'noop',cursor:{...state.scopeCursor!,rootSessionId:'foreign'}},detail:{mode:'empty'}})).toThrow('其他会话');
  expect(state.graph).toBe(priorGraph);expect(state.scopes).toBe(priorScope);
  const wrong=scope();wrong.rootSessionId='foreign';expect(()=>state.apply({graph:update,scopes:{mode:'noop',cursor:state.scopeCursor!},detail:detail(wrong)})).toThrow('其他会话');expect(state.graph).toBe(priorGraph);
  const changed=scope();changed.goal!.input.message='同版本偷偷改写';expect(()=>state.apply({graph:update,scopes:{mode:'noop',cursor:state.scopeCursor!},detail:detail(changed)})).toThrow('内容不一致');expect(state.graph).toBe(priorGraph);
});

it('分页中的详情领先摘要时先缓存，追齐同stamp后显示，不拼接两个版本',()=>{
  const state=new SessionReadProjection(identity),first=reset();state.apply(first);
  const newest=reviewed(),middle=planned();
  state.apply({graph:{mode:'noop',cursor:graph.cursor},scopes:{mode:'delta',from:state.scopeCursor!,cursor:{...state.scopeCursor!,seq:2},batches:[{identity,streamId,seq:2,scopes:[summarizeScope(middle,streamId,2)]}],hasMore:true},detail:detail(newest,3)});
  expect(state.scopes![0].goalRevision).toBe(2);expect(state.detail()).toBeUndefined();expect(state.detailStamp()!.seq).toBe(3);
  state.apply({graph:{mode:'noop',cursor:graph.cursor},scopes:{mode:'delta',from:state.scopeCursor!,cursor:{...state.scopeCursor!,seq:3},batches:[{identity,streamId,seq:3,scopes:[summarizeScope(newest,streamId,3)]}],hasMore:false},detail:{mode:'noop',stamp:state.detailStamp()!}});
  expect(state.detail()).toBe(newest);expect(state.scopes![0].goalRevision).toBe(3);
});

it('任一增量流仍分页就保留上个完整组合，后续失败不发布已关闭目标与旧运行节点',()=>{
  const state=new SessionReadProjection(identity),first=reset();state.apply(first);
  let published=completeSessionRead(first,state)!;const original=published;
  const task={kind:'task' as const,nodeId:'task:member',taskId:'member',scopeId:'scope-one',identity,requester:agent,assignee:{...agent,agentId:'cbim:executor',name:'执行 Agent',agentInstanceId:'executor'},modules:[{moduleId:'module',name:'业务模块',knowledgeRevision:'k',maintenanceBindingId:'binding',maintainerPersonIds:['person'],workflow:{kind:'general' as const,id:'workflow',version:'v1',reason:'通用流程'}}],goal:'成员目标',acceptance:[{id:'check',text:'验证成果'}],revision:1,planRevision:1,status:'running' as const,awaitedChildren:[],runIds:['member-run'],createdAt:time,updatedAt:time};
  const partial:GraphEventBatch={...initial,seq:2,eventId:'task-planned',commandId:'dispatch',cause:'task.dispatched',changes:[{type:'task.upserted',task:{...task,status:'planned',runIds:[]}},{type:'agent.upserted',agent:{agentId:'cbim:executor',agentInstanceId:'executor',name:'执行 Agent',revision:1,state:'working',waitingTaskIds:[]}},{type:'edge.upserted',edge:{edgeId:'dispatch',identity,kind:'dispatch',fromNodeId:graph.root.nodeId,toNodeId:task.nodeId,revision:1,enabled:true}}]};
  const running:GraphEventBatch={...partial,seq:3,eventId:'task-running',commandId:'start',cause:'task.started',changes:[{type:'task.upserted',task:{...task,revision:2}}]};
  const closed={...reviewed(),status:'closed' as const,outcome:'completed' as const,closedAt:time};
  const page:DispatchSessionRead={graph:{mode:'delta',from:graph.cursor,cursor:{...graph.cursor,seq:3},batches:[partial,running],hasMore:true},scopes:{mode:'delta',from:state.scopeCursor!,cursor:{...state.scopeCursor!,seq:2},batches:[{identity,streamId,seq:2,scopes:[summarizeScope(closed,streamId,2)]}],hasMore:false},detail:detail(closed,2)};
  state.apply(page);published=completeSessionRead(page,state)??published;
  expect(state.scopes![0].outcome).toBe('completed');expect(state.graph!.tasks[0].status).toBe('running');expect(published).toBe(original);
  expect(()=>state.apply({graph:{mode:'noop',cursor:{...state.graphCursor!,seq:99}},scopes:{mode:'noop',cursor:state.scopeCursor!},detail:{mode:'noop',stamp:state.detailStamp()!}})).toThrow();expect(published).toBe(original);
  const finished:GraphEventBatch={...partial,seq:4,eventId:'task-completed',commandId:'finish',cause:'task.result_ready',changes:[{type:'task.upserted',task:{...task,revision:3,status:'result_ready',result:{resultId:'candidate',runId:'member-run',planRevision:1,summary:'已生成候选',evidenceRefs:[],limitations:[],acceptance:'not_evaluated'}}}]};
  const last:DispatchSessionRead={graph:{mode:'delta',from:state.graphCursor!,cursor:{...state.graphCursor!,seq:4},batches:[finished],hasMore:false},scopes:{mode:'noop',cursor:state.scopeCursor!},detail:{mode:'noop',stamp:state.detailStamp()!}};
  state.apply(last);published=completeSessionRead(last,state)??published;
  expect(published).not.toBe(original);expect(published.scopes[0].outcome).toBe('completed');expect(published.graph!.tasks[0].status).toBe('result_ready');
});

it('同版本详情必须与摘要字段一致，旧页签响应不得改写新目标详情',()=>{
  const state=new SessionReadProjection(identity);state.apply(reset());
  const second=scope('scope-two'),closed={...scope(),status:'closed' as const,closedAt:time,outcome:'completed' as const},summaries=[summarizeScope(closed,streamId,2),summarizeScope(second,streamId,2)];
  state.apply({graph:{mode:'noop',cursor:graph.cursor},scopes:{mode:'delta',from:state.scopeCursor!,cursor:{...state.scopeCursor!,seq:2},batches:[{identity,streamId,seq:2,scopes:summaries}],hasMore:false},detail:detail(second,2)});
  const current=state.detail();state.apply({graph:{mode:'noop',cursor:graph.cursor},scopes:{mode:'noop',cursor:state.scopeCursor!},detail:detail(closed,2)},closed.scopeId);
  expect(state.detail()).toBe(current);expect(state.detail(closed.scopeId)).toBe(closed);
  const inconsistent=planned();inconsistent.scopeId='scope-two';expect(()=>state.apply({graph:{mode:'noop',cursor:graph.cursor},scopes:{mode:'noop',cursor:state.scopeCursor!},detail:detail(inconsistent,2)},second.scopeId)).toThrow('内容不一致');
  const fresh=new SessionReadProjection(identity),response=reset();if(response.detail.mode==='updated')response.detail.scope={...response.detail.scope,goal:undefined};expect(()=>fresh.apply(response)).toThrow('摘要与同版本详情');expect(fresh.graph).toBeUndefined();
});

it('自动目标按真实创建事务序列选择，旧周期更新或同毫秒随机ID不会抢占当前目标',()=>{
  const older=summarizeScope({...scope('z-old'),status:'closed',outcome:'cancelled',closedAt:time},streamId,99),newer=summarizeScope({...scope('a-new'),status:'closed',outcome:'completed',closedAt:time},streamId,2);
  expect(currentScope([older,newer])).toBe(newer);expect(currentScope([{...older,status:'active'},newer])?.scopeId).toBe('z-old');
  const projected=new SessionScopeProjection(identity);const first=snapshot([scope()],1);projected.apply({mode:'reset',reason:'initial',snapshot:first,cursor:first.cursor});expect(()=>projected.apply({mode:'delta',from:first.cursor,cursor:{...first.cursor,seq:3},batches:[{identity,streamId,seq:3,scopes:[summarizeScope(scope(),streamId,3)]}],hasMore:false})).toThrow();expect(projected.snapshot).toBe(first);
});

it('完成申请不是目标完成，普通对话、legacy和完成依据不足的历史分别呈现',()=>{
  const request=reviewed();expect(scopeGoalView(summarizeScope(request,streamId,1)).phase).toBe('review_pending');
  expect(scopeGoalView(summarizeScope({...request,status:'closed',outcome:'completed',closedAt:time},streamId,2))).toMatchObject({phase:'completed',tone:'success'});
  expect(scopeGoalView(summarizeScope({...planned(),status:'closed',outcome:'completed',closedAt:time},streamId,2))).toMatchObject({phase:'completion_unverified',tone:'warning'});
  expect(scopeGoalView(summarizeScope({...scope(),status:'closed',outcome:'completed',closedAt:time},streamId,2))).toMatchObject({phase:'conversation_finished',tone:'neutral'});
  expect(scopeGoalView(summarizeScope({...scope(),goal:undefined},streamId,1))).toMatchObject({phase:'legacy',tone:'neutral'});
});

it.each([
  {origin:'business_replan' as const,phase:'business_planning',label:'正在规划业务任务',description:'主 Agent 正在制定业务执行计划。'},
  {origin:'inspection' as const,phase:'inspection_planning',label:'正在规划只读核实',description:'主 Agent 正在制定只读核实计划；核实期间保持只读权限。'},
])('已受理 $origin 尚无plan时保持真实任务身份，对话卡和根详情不误称普通问答',({origin,phase,label,description})=>{
  const state=view(scope()),summary={...state.scopes[0],origin},goalView=scopeGoalView(summary,graph);
  Object.assign(state,{scopes:[summary],openScope:summary,activeScope:summary,selectedGoalView:goalView,currentGoalView:goalView});
  expect(goalView).toEqual({phase,label,tone:'running'});
  const card=renderToStaticMarkup(createElement(ScopeGoalPanel,{state,compact:true,testId:'conversation-goal-summary'}));
  const root=renderToStaticMarkup(createElement(SessionTaskView,{workspaceId:identity.workspaceId,taskId:identity.rootSessionId,runs:[],queued:[],now:0,busy:false,graph,scopeState:state,selectedTaskId:graph.root.nodeId,onSelectTask:()=>{},onQueueChange:()=>{},onQueueContinue:()=>{},onChat:()=>{},onStop:()=>{}}));
  for(const html of [card,root]){expect(html).toContain(label);expect(html).toContain(description);expect(html).not.toContain('普通对话处理中');expect(html).not.toContain('普通问答无需派发任务');}
  const stopped={...summary,status:'closed' as const,outcome:'cancelled' as const,closedAt:time};expect(scopeGoalView(stopped).phase).toBe('cancelled');
  const stoppedView={...state,scopes:[stopped],selectedScope:{...state.selectedScope!,status:'closed' as const,outcome:'cancelled' as const,closedAt:time},selectedGoalView:scopeGoalView(stopped)};
  const stoppedCard=renderToStaticMarkup(createElement(ScopeGoalPanel,{state:stoppedView}));expect(stoppedCard).not.toContain(description);expect(stoppedCard).not.toContain('普通问答无需派发任务');
});

it('普通无origin问答仍使用轻量对话状态与无计划说明',()=>{
  const state=view(scope());expect(state.currentGoalView).toMatchObject({phase:'chat',label:'普通对话处理中'});
  expect(renderToStaticMarkup(createElement(ScopeGoalPanel,{state}))).toContain('本轮没有登记业务目标计划；普通问答无需派发任务。');
});

it('补充后旧计划保持可查但不能冒充新目标完成，输入版本不一致拒绝发布',()=>{
  const revised=reviewed();revised.goal!.inputRevision=2;
  const summary=summarizeScope(revised,streamId,2);expect(summary.needsReplan).toBe(true);expect(scopeGoalView(summary)).toMatchObject({phase:'replanning',tone:'running'});
  expect(scopeGoalView({...summary,status:'closed',outcome:'completed',closedAt:time})).toMatchObject({phase:'completion_unverified',tone:'warning'});
  const html=renderToStaticMarkup(createElement(ScopeGoalPanel,{state:view(revised)}));expect(html).toContain('补充已受理');expect(html).toContain('输入第 1 版');expect(html).not.toContain('目标已完成');
  const response=reset(revised,2);if(response.scopes.mode==='reset')response.scopes.snapshot.scopes[0].inputRevision=1;
  const state=new SessionReadProjection(identity);expect(()=>state.apply(response)).toThrow('目标补充版本');expect(state.graph).toBeUndefined();
});

it('同一目标卡展示原始输入、计划、审阅、完整阻塞原因，但不伪造人工验收',()=>{
  const request=reviewed(),pending=renderToStaticMarkup(createElement(ScopeGoalPanel,{state:view(request),compact:true,testId:'conversation-goal-summary'}));
  expect(pending).toContain('data-goal-state="review_pending"');expect(pending).toContain('本轮真实输入');expect(pending).toContain('仍需等待主运行结束和程序复核');expect(pending).toContain('commit-one');expect(pending).not.toContain('目标已完成');
  const blocked=planned();blocked.goal!.blocked={reason:'完整原因 '.repeat(100)+'末尾诊断',at:time};blocked.status='closed';blocked.outcome='failed';blocked.closedAt=time;
  const html=renderToStaticMarkup(createElement(ScopeGoalPanel,{state:view(blocked)}));expect(html).toContain('data-goal-state="blocked"');expect(html).toContain('scope-goal-blocked-detail');expect(html).toContain('末尾诊断');
  const legacy=renderToStaticMarkup(createElement(ScopeGoalPanel,{state:view({...scope(),goal:undefined})}));expect(legacy).toContain('不根据会话标题推断');expect(legacy).not.toContain('scope-goal-input');
  const completed=renderToStaticMarkup(createElement(ScopeGoalPanel,{state:view({...request,status:'closed',outcome:'completed',closedAt:time})}));expect(completed).toContain('程序已核验证据、任务终态及适用的人工决定');expect(completed).toContain('完成范围以逐项审阅为准');expect(completed).not.toContain('主 Agent 已引用人工决定并复核当前依据');expect(completed).not.toContain('已记录“接受”');
});

it('主回合结束后活动周期根仍有停止入口，历史目标选择不删除全会话任务',()=>{
  const chosen=planned(),state=view(chosen),history={task:{mode:'chat' as const,taskId:identity.rootSessionId,workspaceId:identity.workspaceId,root:'root',goal:'首次标题',moduleIds:[],agentId:'cbim:main',acceptance:[]},runId:'main-run',status:'completed' as const,acceptance:'not_evaluated' as const,unresolvedTools:[],events:[]};
  const tasks=['scope-one','scope-old'].map((scopeId,index)=>({kind:'task' as const,nodeId:'task:t'+index,taskId:'t'+index,scopeId,identity,requester:agent,assignee:{...agent,agentId:'cbim:executor',name:'执行 Agent',agentInstanceId:'executor-'+index},modules:[],goal:'任务 '+index,acceptance:[],revision:1,planRevision:1,status:'running' as const,awaitedChildren:[],runIds:[],createdAt:time,updatedAt:time}));
  const fullGraph:GraphSnapshot={...graph,tasks,edges:tasks.map((task,index)=>({edgeId:'edge-'+index,identity,kind:'dispatch',fromNodeId:graph.root.nodeId,toNodeId:task.nodeId,revision:1,enabled:true}))};
  const html=renderToStaticMarkup(createElement(SessionTaskView,{workspaceId:identity.workspaceId,taskId:identity.rootSessionId,runs:[history],queued:[],now:0,busy:false,graph:fullGraph,scopeState:state,selectedTaskId:graph.root.nodeId,onSelectTask:()=>{},onQueueChange:()=>{},onQueueContinue:()=>{},onChat:()=>{},onStop:()=>{}}));
  expect(html).toContain('dispatch-root-goal');expect(html).toContain('data-testid="scope-stop"');expect(html).toContain('停止当前任务');expect(html).toContain('data-task-id="t0"');expect(html).toContain('data-task-id="t1"');expect(html).toContain('data-highlighted="false"');expect(html).toContain('当前周期的治理目标');
  const legacyState=view({...scope('legacy'),goal:undefined});expect(sessionRoot([history],identity.rootSessionId,0,fullGraph,legacyState).goal).toBe('旧周期 · 未保存原始目标');expect(sessionRoot([history],identity.rootSessionId,0,fullGraph).goal).toBe('首次标题');
  const browsing={...legacyState,openScope:state.openScope,activeScope:state.activeScope};const oldHtml=renderToStaticMarkup(createElement(SessionTaskView,{workspaceId:identity.workspaceId,taskId:identity.rootSessionId,runs:[history],queued:[],now:0,busy:false,graph:fullGraph,scopeState:browsing,selectedTaskId:graph.root.nodeId,onSelectTask:()=>{},onQueueChange:()=>{},onQueueContinue:()=>{},onChat:()=>{},onStop:()=>{}}));expect(oldHtml).toContain('当前另有任务运行');expect(oldHtml).toContain('停止正在运行的任务');
});

it('只有持久waiting才显示执行暂停，历史选择不覆盖当前等待和取消对象',()=>{
  const requested=reviewed();requested.goal!.review!.decision='awaiting_user';
  expect(scopeGoalView(summarizeScope(requested,streamId,1))).toMatchObject({phase:'awaiting_user',label:'已请求补充 · 等待暂停确认'});
  const waiting:DispatchScope={...requested,status:'waiting',wait:{waitId:'wait-one',reason:'需要用户补充 '.repeat(100)+'完整原因末尾',createdAt:time,runId:'main-run',goalRevision:3,graphCursor:{streamId:'graph',seq:1},knowledgeRevision:'knowledge',mainRunIds:['main-run']}};
  const state=view(waiting),projection=new SessionReadProjection(identity);projection.apply(reset(waiting));
  expect(state.activeScope).toBeUndefined();expect(state.openScope).toBe(state.waitingScope);expect(state.currentGoalView.phase).toBe('waiting');expect(projection.detail()?.wait?.reason).toContain('完整原因末尾');
  const html=renderToStaticMarkup(createElement(ScopeGoalPanel,{state}));expect(html).toContain('data-goal-state="waiting"');expect(html).toContain('scope-goal-wait-detail');expect(html).toContain('完整原因末尾');expect(html).toContain('普通排队消息不会恢复本目标');expect(html).not.toContain('<button');
  const historical=view({...scope('closed'),status:'closed',closedAt:time,outcome:'completed'}),browsing={...historical,scopes:[state.openScope!,...historical.scopes],openScope:state.openScope,waitingScope:state.waitingScope,currentGoalView:state.currentGoalView};
  expect(currentScope(browsing.scopes)).toBe(state.waitingScope);
  const root=renderToStaticMarkup(createElement(SessionTaskView,{workspaceId:identity.workspaceId,taskId:identity.rootSessionId,runs:[],queued:[],now:0,busy:false,graph,scopeState:browsing,selectedTaskId:graph.root.nodeId,onSelectTask:()=>{},onQueueChange:()=>{},onQueueContinue:()=>{},onChat:()=>{},onStop:()=>{}}));expect(root).toContain('当前另有待补充任务');expect(root).toContain('取消当前任务');expect(root).toContain('data-testid="scope-stop"');
  const closed={...waiting,status:'closed' as const,outcome:'cancelled' as const,closedAt:time};expect(scopeGoalView(summarizeScope(closed,streamId,2)).phase).toBe('cancelled');expect(renderToStaticMarkup(createElement(ScopeGoalPanel,{state:view(closed)}))).toContain('等待记录');
});
