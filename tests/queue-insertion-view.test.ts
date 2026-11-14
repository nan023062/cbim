import {expect,it,vi} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import type {RunSummary,QueueInsertRequest} from '../src/bridge/contracts/execution';
import {captureQueueInsertTarget,enqueueConversationMessage,insertQueuedMessage} from '../src/view/conversation/queue-insertion';
import {ConversationStopGate} from '../src/view/conversation/conversation-stop';
import {conversationExecutionState} from '../src/view/conversation/conversation-state';
import {SessionTaskView} from '../src/view/tasks/SessionTaskView';
import {scopeGoalView,type ScopeGoalState} from '../src/view/tasks/scope-state';
import type {ScopeSummary} from '../src/bridge/contracts/dispatch';
import {dispatchApplication} from '../src/bridge/server/ipc/dispatch';
import type {ApplicationServices} from '../src/bridge/server/ipc/services';

const run=():RunSummary=>({task:{workspaceId:'workspace',taskId:'root',root:'/workspace',goal:'主任务',moduleIds:[],acceptance:[],agentId:'cbim:main',mode:'chat'},runId:'run-before',status:'running',acceptance:'not_evaluated',unresolvedTools:[],events:[]});
const deferred=<T>()=>{let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>resolve=r);return {promise,resolve}};
const target=()=>captureQueueInsertTarget('workspace','root',run(),true)!;

it('新草稿入队等待期间换轮仍绑定点击时原run，先确认真实入队再只插入一次',async()=>{
  const current=run(),captured=captureQueueInsertTarget('workspace','root',current,true)!,gate=deferred<{taskId:string;id:string}>(),events:string[]=[],enqueue=vi.fn(()=>gate.promise),accepted=vi.fn(()=>events.push('accepted')),insert=vi.fn(async(request:QueueInsertRequest)=>{events.push('insert');return request});
  const pending=enqueueConversationMessage({enqueue,accepted,insert},captured);expect(accepted).not.toHaveBeenCalled();expect(insert).not.toHaveBeenCalled();
  current.runId='run-after';current.status='completed';gate.resolve({taskId:'root',id:'queued'});await pending;
  expect(events).toEqual(['accepted','insert']);expect(enqueue).toHaveBeenCalledTimes(1);expect(insert).toHaveBeenCalledExactlyOnceWith({id:'workspace',taskId:'root',queueId:'queued',expectedRunId:'run-before'});
});

it.each(['QUEUE_INSERT_STALE','QUEUE_INSERT_STOPPED','QUEUE_INSERT_UNKNOWN','IPC_TIMEOUT'])('%s 在入队之后发生不恢复草稿、不删除或重复提交消息',async code=>{
  const queue=[{taskId:'root',id:'queued',message:'已保存消息'}];let draft='已保存消息';const enqueue=vi.fn(async()=>queue[0]),accepted=vi.fn(()=>{draft=''}),insert=vi.fn(async()=>{throw Error(code)});
  await expect(enqueueConversationMessage({enqueue,accepted,insert},target())).rejects.toThrow(code);
  expect(draft).toBe('');expect(queue).toHaveLength(1);expect(queue[0].id).toBe('queued');expect(accepted).toHaveBeenCalledTimes(1);expect(enqueue).toHaveBeenCalledTimes(1);expect(insert).toHaveBeenCalledTimes(1);
});

it('入队失败保留草稿；回执错会话不再把消息插入点击时或其它主轮',async()=>{
  const accepted=vi.fn(),insert=vi.fn();
  await expect(enqueueConversationMessage({enqueue:async()=>{throw Error('SAVE_FAILED')},accepted,insert},target())).rejects.toThrow('SAVE_FAILED');expect(accepted).not.toHaveBeenCalled();expect(insert).not.toHaveBeenCalled();
  await expect(enqueueConversationMessage({enqueue:async()=>({taskId:'other-root',id:'q'}),accepted,insert},target())).rejects.toThrow('归属未确认');expect(accepted).not.toHaveBeenCalled();expect(insert).not.toHaveBeenCalled();
});

it('已有队列项入口使用同一冻结身份，丢回包只报错不改为新轮或自动重插',async()=>{
  const current=run(),captured=captureQueueInsertTarget('workspace','root',current,true)!,insert=vi.fn(async()=>{throw Error('IPC_REPLY_LOST')});current.runId='new-run';
  await expect(insertQueuedMessage(captured,'existing',insert)).rejects.toThrow('IPC_REPLY_LOST');expect(insert).toHaveBeenCalledExactlyOnceWith({id:'workspace',taskId:'root',queueId:'existing',expectedRunId:'run-before'});
});

it('成员忙和持久waiting期间普通输入均排队；补充需显式话题入口，不能生成单轮插入请求',async()=>{
  const scope:ScopeSummary={scopeId:'scope',status:'active',createdAt:'2026-11-07T00:00:00.000Z',hasGoal:false,hasPlan:false,stamp:{scopeId:'scope',streamId:'scopes',seq:1}},memberBusy=conversationExecutionState({...run(),status:'completed'},scope),waiting=conversationExecutionState(run(),{...scope,status:'waiting'});
  expect(memberBusy.shouldQueue).toBe(true);expect(waiting.shouldQueue).toBe(true);expect(waiting.canContinueQueue).toBe(false);
  for(const state of [memberBusy,waiting]){expect(state.canInsert).toBe(false);expect(captureQueueInsertTarget('workspace','root',run(),state.canInsert)).toBeUndefined()}
  for(const [id,taskId,current] of [['other','root',run()],['workspace','other',run()],['workspace','root',undefined]] as const)expect(captureQueueInsertTarget(id,taskId,current,true)).toBeUndefined();
  const insert=vi.fn(),accepted=vi.fn();await enqueueConversationMessage({enqueue:async()=>({taskId:'root',id:'q'}),accepted,insert});expect(accepted).toHaveBeenCalledTimes(1);expect(insert).not.toHaveBeenCalled();
});

it('停止有独立在途标记，跨会话和迟到旧结束不能解锁另一请求',()=>{
  const gate=new ConversationStopGate(),a={id:'workspace',taskId:'a'},b={id:'workspace',taskId:'b'};gate.observe(a);const first=gate.begin(a)!;
  expect(gate.isCurrent(first)).toBe(true);expect(gate.begin(a)).toBeUndefined();gate.observe(b);expect(gate.isCurrent(first)).toBe(false);expect(gate.begin(a)).toBeUndefined();const second=gate.begin(b)!;expect(gate.pending(a)).toBe(true);expect(gate.pending(b)).toBe(true);
  gate.observe(a);expect(gate.isCurrent(first)).toBe(false);expect(gate.finish(first)).toBe(true);expect(gate.pending(b)).toBe(true);const next=gate.begin(a)!;expect(gate.finish(first)).toBe(false);expect(gate.pending(a)).toBe(true);gate.finish(second);expect(gate.pending(a)).toBe(true);expect(gate.isCurrent(next)).toBe(true);expect(gate.finish(next)).toBe(true);
});

it('任务根两处停止按钮不受插入busy阻止，只有重复停止在途才禁用',()=>{
  const summary:ScopeSummary={scopeId:'scope',status:'active',createdAt:'2026-11-07T00:00:00.000Z',hasGoal:false,hasPlan:false,stamp:{scopeId:'scope',streamId:'scopes',seq:1}},view=scopeGoalView(summary);
  const state:ScopeGoalState={scopes:[summary],selectedScopeId:summary.scopeId,openScope:summary,activeScope:summary,selectedGoalView:view,currentGoalView:view,loading:false,detailLoading:false,error:'',selectScope:()=>{}};
  const render=(stopping:boolean)=>renderToStaticMarkup(createElement(SessionTaskView,{workspaceId:'workspace',taskId:'root',runs:[run()],queued:[],now:0,busy:true,stopping,scopeState:state,selectedTaskId:'session:root',onSelectTask:()=>{},onQueueChange:()=>{},onQueueContinue:()=>{},onChat:()=>{},onStop:()=>{}}));
  const available=render(false),pending=render(true);expect(available).toMatch(/<button data-testid="scope-stop">/);expect(available).toContain('<button>停止本次执行</button>');expect(pending).toMatch(/<button data-testid="scope-stop" disabled="">/);expect(pending).toContain('<button disabled="">停止本次执行</button>');
});

it('IPC 原样转交 expectedRunId，旧缺字段请求不能被路由补成当前运行',async()=>{
  const insertion=vi.fn(async(_task:string,_queue:string,expected:string)=>{if(expected===undefined)throw Object.assign(Error('没有原run'),{code:'QUEUE_INSERT_STALE'});return {taskId:'root',runId:expected}}),execution=vi.fn(()=>({insertQueued:insertion})),app={execution} as unknown as ApplicationServices;
  await dispatchApplication(app,'loop.queueInsert',{id:'workspace',taskId:'root',queueId:'q',expectedRunId:'old-run'});expect(execution).toHaveBeenLastCalledWith('workspace');expect(insertion).toHaveBeenLastCalledWith('root','q','old-run');
  for(const missing of [{},{expectedRunId:''}])await expect(dispatchApplication(app,'loop.queueInsert',{id:'workspace',taskId:'root',queueId:'q',...missing})).rejects.toMatchObject({code:'QUEUE_INSERT_STALE'});
  // 严格边界在进入执行服务前拒绝旧请求，但不改变错误码，也不会补成当前运行。
  expect(insertion).toHaveBeenCalledTimes(1);expect(execution).toHaveBeenCalledTimes(1);
});
