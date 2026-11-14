import {expect,it} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {SessionReadProjection,scopeGoalView,type ScopeGoalState} from '../src/view/tasks/scope-state';
import {ScopeGoalPanel} from '../src/view/tasks/ScopeGoalPanel';
import {ScopeActiveInputs} from '../src/view/tasks/ScopeActiveInputs';
import {summarizeScope} from '../src/logic/tasks/rules/scope-view';
import {applyGraphBatch} from '../src/logic/tasks/rules/graph-reducer';
import type {ScopeActiveInput,DispatchScope,DispatchSessionRead,GraphEventBatch} from '../src/bridge/contracts/dispatch';

const time='2026-11-07T12:00:00.000Z',identity={workspaceId:'workspace',rootSessionId:'root'},streamId='scopes:graph';
const agent={agentId:'cbim:main',agentInstanceId:'main',agentSessionId:'channel',name:'主 Agent'};
const event:GraphEventBatch={version:1,identity,streamId:'graph',seq:1,eventId:'create',commandId:'open',cause:'graph.created',committedAt:time,changes:[{type:'root.upserted',root:{kind:'session-root',nodeId:'session:root',identity,agent,revision:1,createdAt:time}},{type:'agent.upserted',agent:{agentId:agent.agentId,agentInstanceId:agent.agentInstanceId,name:agent.name,revision:1,state:'idle',waitingTaskIds:[]}}]};
const graph=applyGraphBatch(undefined,event),message='补充：需要触屏操作\n附件快照资料';
function pending():ScopeActiveInput{return {insertionId:'a'.repeat(64),queueId:'queue',runId:'run',preparedAt:time,baseGoalRevision:3,baseInputRevision:1,inputHash:'b'.repeat(64),messageBytes:new TextEncoder().encode(message).byteLength,messageCharacters:message.length,status:'pending'}}
function accepted():ScopeActiveInput{return {...pending(),status:'accepted',acceptedAt:time,inputRevision:2,goalRevision:4,input:{message},requestedSeq:10,acceptedSeq:11}}
function scope():DispatchScope{return {scopeId:'scope',...identity,status:'active',createdAt:time,goal:{revision:3,input:{message:'制作游戏',attachmentIds:[]},plan:{revision:2,runId:'run',recordedAt:time,knowledgeRevision:'knowledge',graphCursor:{streamId:'graph',seq:1},objective:'游戏目标',constraints:[],criteria:[{id:'criterion',kind:'evidence',text:'真实验证'}],assignments:[{agentId:'cbim:executor',agentName:'执行者',teamId:'.cbim/team',moduleIds:['module'],moduleNames:['游戏模块'],criterionIds:['criterion'],reason:'执行游戏任务'}],reason:'拆解'},review:{revision:3,planRevision:2,runId:'run',recordedAt:time,knowledgeRevision:'knowledge',graphCursor:{streamId:'graph',seq:1},observedSeq:9,lastEffectSeq:4,decision:'complete',checks:[{criterionId:'criterion',outcome:'satisfied',reason:'已回执',evidence:[{kind:'member-result',taskId:'member',runId:'member-run',resultId:'candidate',planRevision:1,toolCallIds:['tool']}]}],superseded:[],gaps:[],reason:'旧输入的完成申请'}}}}
function state(value:DispatchScope):ScopeGoalState{const summary=summarizeScope(value,streamId,1),view=scopeGoalView(summary,graph);return {scopes:[summary],selectedScopeId:value.scopeId,selectedScope:value,selectedGoalView:view,currentGoalView:view,graph,loading:false,detailLoading:false,error:'',selectScope:()=>{}}}
const render=(value:DispatchScope)=>renderToStaticMarkup(createElement(ScopeGoalPanel,{state:state(value)}));
function read(value:DispatchScope,seq=1):DispatchSessionRead{const summary=summarizeScope(value,streamId,seq),cursor={...identity,kind:'scopes' as const,streamId,seq};return {graph:{mode:'reset',reason:'initial',snapshot:graph,cursor:graph.cursor},scopes:{mode:'reset',reason:'initial',cursor,snapshot:{identity,cursor,scopes:[summary]}},detail:{mode:'updated',stamp:summary.stamp,scope:value}}}

it.each(['pending','unknown'] as const)('运行内%s输入优先于旧完成申请，历史没有伪造正文或重试动作',status=>{
  const value=scope();value.activeInputs=[status==='pending'?pending():{...pending(),status:'unknown',resolvedAt:time,reason:'原生返回未知'}];
  expect(state(value).selectedGoalView.phase).toBe(status==='pending'?'input_pending':'input_unknown');
  const html=render(value);expect(html).toContain('scope-active-input-notice');expect(html).toContain('运行内补充记录');expect(html).not.toContain('data-testid="scope-active-input-message"');expect(html).not.toContain('data-goal-state="review_pending"');
  expect(html).toContain('本轮原始输入');expect(html).toContain('制作游戏');expect(html).toContain('queue');expect(html).not.toMatch(/<button[^>]*>.*(?:重试|恢复)/);
});

it('接受后显示实际队列快照和新输入版本，原输入和旧计划保持各自含义',()=>{
  const value=scope();value.activeInputs=[accepted()];value.goal!.revision=4;value.goal!.inputRevision=2;delete value.goal!.review;
  const before=JSON.stringify(value),html=render(value);expect(html).toContain('data-goal-state="replanning"');expect(html).toContain('输入第 2 版');expect(html).toContain('已接收输入快照');expect(html).toContain('补充：需要触屏操作');expect(html).toContain('可能包含展开的附件资料');expect(html).toContain('此计划早于最新补充');expect(html).toContain('制作游戏');expect(html).not.toContain('<strong>目标已完成</strong>');expect(JSON.stringify(value)).toBe(before);
});

it('无计划对话接受补充后仍按普通对话结束展示，不造业务完成或计划',()=>{
  const value=scope(),item=accepted();item.baseGoalRevision=1;if(item.status==='accepted')item.goalRevision=2;
  value.activeInputs=[item];value.goal={revision:2,inputRevision:2,input:{message:'普通问答',attachmentIds:[]}};value.status='closed';value.outcome='completed';value.closedAt=time;
  const html=render(value);expect(html).toContain('本轮对话结束');expect(html).not.toContain('data-testid="scope-goal-plan"');expect(html).not.toContain('<strong>目标已完成</strong>');expect(html).toContain('输入第 2 版');
});

it('停止与中断保留终态，未知补充仍独立提示，损坏完成记录不会显示绿色完成',()=>{
  const value=scope();value.activeInputs=[{...pending(),status:'unknown',resolvedAt:time,reason:'回包未确认'}];value.status='closed';value.closedAt=time;
  for(const outcome of ['cancelled','interrupted'] as const){value.outcome=outcome;expect(state(value).selectedGoalView.phase).toBe(outcome);expect(render(value)).toContain('scope-active-input-notice')}
  value.outcome='completed';expect(state(value).selectedGoalView).toEqual({phase:'completion_unverified',label:'周期已结束 · 补充接收未确认',tone:'warning'});
});

it('目标补充独立增量刷新；noop不重建引用，旧会话图不变',()=>{
  const projection=new SessionReadProjection(identity),value=scope();value.activeInputs=[pending()];projection.apply(read(value));const first=projection.detail(),oldGraph=projection.graph,oldSummary=projection.scopes;
  projection.apply({graph:{mode:'noop',cursor:graph.cursor},scopes:{mode:'noop',cursor:projection.scopeCursor!},detail:{mode:'noop',stamp:projection.detailStamp()!}});expect(projection.detail()).toBe(first);expect(projection.scopes).toBe(oldSummary);
  const next=structuredClone(value);next.activeInputs=[accepted()];next.goal!.revision=4;next.goal!.inputRevision=2;delete next.goal!.review;
  const summary=summarizeScope(next,streamId,2);projection.apply({graph:{mode:'noop',cursor:graph.cursor},scopes:{mode:'delta',from:projection.scopeCursor!,cursor:{...projection.scopeCursor!,seq:2},batches:[{identity,streamId,seq:2,scopes:[summary]}],hasMore:false},detail:{mode:'updated',stamp:summary.stamp,scope:next}});
  expect(projection.graph).toBe(oldGraph);expect(projection.detail()!.activeInputs![0].status).toBe('accepted');expect(scopeGoalView(projection.selected(),projection.graph).phase).toBe('replanning');
});

it.each(['status','count','shape'] as const)('摘要详情%s矛盾时保留上次完整投影',kind=>{
  const projection=new SessionReadProjection(identity);projection.apply(read(scope()));const previous=projection.detail(),summary=projection.scopes;
  const value=scope();value.activeInputs=[pending()];const next=read(value,2);
  if(next.scopes.mode!=='reset'||next.detail.mode!=='updated')throw Error('fixture');
  if(kind==='status')next.scopes.snapshot.scopes[0].activeInputStatus='unknown';
  if(kind==='count')next.scopes.snapshot.scopes[0].activeInputCount=2;
  if(kind==='shape')Object.assign(next.detail.scope.activeInputs![0],{input:{message:'伪造提前受理'}});
  expect(()=>projection.apply(next)).toThrow();expect(projection.detail()).toBe(previous);expect(projection.scopes).toBe(summary);
});

it('已拒绝记录不显示接受版本；异常记录保守报错；旧历史不补造字段',()=>{
  const rejected={...pending(),status:'rejected' as const,resolvedAt:time,reason:'发送前停止'},html=renderToStaticMarkup(createElement(ScopeActiveInputs,{items:[rejected]}));expect(html).toContain('未发送');expect(html).not.toContain('输入第 2 版');expect(html).toContain('发送前停止');
  const bad={...rejected,reason:undefined} as unknown as ScopeActiveInput;expect(renderToStaticMarkup(createElement(ScopeActiveInputs,{items:[bad]}))).toContain('scope-active-input-invalid');
  const value=scope(),before=JSON.stringify(value);expect(render(value)).not.toContain('scope-active-inputs');expect(value).not.toHaveProperty('activeInputs');expect(JSON.stringify(value)).toBe(before);
});
