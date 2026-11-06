import {expect,it} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {SessionReadProjection,SessionScopeProjection,completeSessionRead,scopeGoalView,currentScope,type ScopeGoalState} from '../src/frontend/tasks/scope-state';
import {ScopeGoalPanel} from '../src/frontend/tasks/ScopeGoalPanel';
import {SessionTaskView,sessionRoot} from '../src/frontend/tasks/SessionTaskView';
import {applyGraphBatch} from '../src/backend/core/tasks/graph-reducer';
import {summarizeScope} from '../src/backend/core/tasks/scope-view';
import type {DispatchScope,DispatchSessionRead,ScopeSnapshot,ScopeDetailRead,GraphEventBatch,GraphSnapshot} from '../src/bridge/contracts/dispatch';

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
function view(value:DispatchScope):ScopeGoalState{const summary=summarizeScope(value,streamId,1),goalView=scopeGoalView(summary,graph);return {scopes:[summary],selectedScopeId:value.scopeId,selectedScope:value,activeScope:value.status==='active'?summary:undefined,selectedGoalView:goalView,currentGoalView:goalView,graph,loading:false,detailLoading:false,error:'',selectScope:()=>{}}}

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

it('同一目标卡展示原始输入、计划、审阅、完整阻塞原因，但不伪造人工验收',()=>{
  const request=reviewed(),pending=renderToStaticMarkup(createElement(ScopeGoalPanel,{state:view(request),compact:true,testId:'conversation-goal-summary'}));
  expect(pending).toContain('data-goal-state="review_pending"');expect(pending).toContain('本轮真实输入');expect(pending).toContain('仍需等待主运行结束和程序复核');expect(pending).toContain('commit-one');expect(pending).not.toContain('目标已完成');
  const blocked=planned();blocked.goal!.blocked={reason:'完整原因 '.repeat(100)+'末尾诊断',at:time};blocked.status='closed';blocked.outcome='failed';blocked.closedAt=time;
  const html=renderToStaticMarkup(createElement(ScopeGoalPanel,{state:view(blocked)}));expect(html).toContain('data-goal-state="blocked"');expect(html).toContain('scope-goal-blocked-detail');expect(html).toContain('末尾诊断');
  const legacy=renderToStaticMarkup(createElement(ScopeGoalPanel,{state:view({...scope(),goal:undefined})}));expect(legacy).toContain('不根据会话标题推断');expect(legacy).not.toContain('scope-goal-input');
  const completed=renderToStaticMarkup(createElement(ScopeGoalPanel,{state:view({...request,status:'closed',outcome:'completed',closedAt:time})}));expect(completed).toContain('程序已核验证据与任务终态');expect(completed).toContain('目标符合性由主 Agent 审阅，不表示人工验收');
});

it('主回合结束后活动周期根仍有停止入口，历史目标选择不删除全会话任务',()=>{
  const chosen=planned(),state=view(chosen),history={task:{mode:'chat' as const,taskId:identity.rootSessionId,workspaceId:identity.workspaceId,root:'root',goal:'首次标题',moduleIds:[],agentId:'cbim:main',acceptance:[]},runId:'main-run',status:'completed' as const,acceptance:'not_evaluated' as const,unresolvedTools:[],events:[]};
  const tasks=['scope-one','scope-old'].map((scopeId,index)=>({kind:'task' as const,nodeId:'task:t'+index,taskId:'t'+index,scopeId,identity,requester:agent,assignee:{...agent,agentId:'cbim:executor',name:'执行 Agent',agentInstanceId:'executor-'+index},modules:[],goal:'任务 '+index,acceptance:[],revision:1,planRevision:1,status:'running' as const,awaitedChildren:[],runIds:[],createdAt:time,updatedAt:time}));
  const fullGraph:GraphSnapshot={...graph,tasks,edges:tasks.map((task,index)=>({edgeId:'edge-'+index,identity,kind:'dispatch',fromNodeId:graph.root.nodeId,toNodeId:task.nodeId,revision:1,enabled:true}))};
  const html=renderToStaticMarkup(createElement(SessionTaskView,{workspaceId:identity.workspaceId,taskId:identity.rootSessionId,runs:[history],queued:[],now:0,busy:false,graph:fullGraph,scopeState:state,selectedTaskId:graph.root.nodeId,onSelectTask:()=>{},onQueueChange:()=>{},onQueueContinue:()=>{},onChat:()=>{},onStop:()=>{}}));
  expect(html).toContain('dispatch-root-goal');expect(html).toContain('data-testid="scope-stop"');expect(html).toContain('停止当前任务');expect(html).toContain('data-task-id="t0"');expect(html).toContain('data-task-id="t1"');expect(html).toContain('data-highlighted="false"');expect(html).toContain('当前周期的治理目标');
  const legacyState=view({...scope('legacy'),goal:undefined});expect(sessionRoot([history],identity.rootSessionId,0,fullGraph,legacyState).goal).toBe('旧周期 · 未保存原始目标');expect(sessionRoot([history],identity.rootSessionId,0,fullGraph).goal).toBe('首次标题');
  const browsing={...legacyState,activeScope:state.activeScope};const oldHtml=renderToStaticMarkup(createElement(SessionTaskView,{workspaceId:identity.workspaceId,taskId:identity.rootSessionId,runs:[history],queued:[],now:0,busy:false,graph:fullGraph,scopeState:browsing,selectedTaskId:graph.root.nodeId,onSelectTask:()=>{},onQueueChange:()=>{},onQueueContinue:()=>{},onChat:()=>{},onStop:()=>{}}));expect(oldHtml).toContain('当前另有任务运行');expect(oldHtml).toContain('停止正在运行的任务');
});
