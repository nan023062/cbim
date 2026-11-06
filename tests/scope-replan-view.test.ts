import {expect,it,vi} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {ScopeReplanController,ScopeReplanPool,checkedReplanPreview,checkedReplanReceipt,replanRejected,REPLAN_INDEX_BYTE_LIMIT,type ReplanPorts,type ReplanTarget} from '../src/frontend/tasks/replan-state';
import {replanTarget,type ScopeReplanView} from '../src/frontend/tasks/useScopeReplan';
import {ScopeReplanForm} from '../src/frontend/tasks/ScopeReplanForm';
import {ScopeGoalPanel} from '../src/frontend/tasks/ScopeGoalPanel';
import {SessionTaskView} from '../src/frontend/tasks/SessionTaskView';
import type {ReplanPreview,ReplanRequest,ReplanReceipt,DispatchScope,ScopeSummary,GraphSnapshot} from '../src/bridge/contracts/dispatch';
import type {ScopeGoalState} from '../src/frontend/tasks/scope-state';

const identity={workspaceId:'workspace',rootSessionId:'root'},scopeId='inspection',time='2026-11-07T00:00:00.000Z',command='22222222-2222-4222-8222-222222222222';
const target:ReplanTarget={...identity,inspectionScopeId:scopeId,anchor:'graph-8/scope-4/model',graphCursor:{streamId:'graph',seq:8},inspectionGoalRevision:3};
const model={provider:'cbim-11111111-1111-4111-8111-111111111111',profileId:'11111111-1111-4111-8111-111111111111',model:'model'},message='  新业务目标：保留已有文件，修复并验证交付\n  ';
function preview(inspectionScopeId=scopeId):ReplanPreview{return {identity:{...identity,inspectionScopeId},eligible:true,basis:'a'.repeat(64),graphCursor:{streamId:'graph',seq:8},inspectionGoalRevision:3,knowledgeRevision:'knowledge',requiredModules:[{moduleId:'game',name:'游戏业务'}],inheritedHuman:[{id:'h1',text:'需要人工确认视觉效果',kind:'human',sourceScopeId:'source-business',sourceGoalRevision:2}],issues:[]}}
function receipt(request:ReplanRequest):ReplanReceipt{return {...identity,scopeId:request.commandId,scopeStatus:'active',replan:{replanId:request.commandId,acceptedAt:time,source:{...request.source,proof:{inspectionGoalRevision:3,inspectionPlanRevision:2,reviewRunId:'inspection-main-run',knowledgeRevision:'knowledge',sourceScopeId:'source-business',sourceTaskId:'source-member',sourceRunId:'source-member-run',sourceReportBasis:'b'.repeat(64),evidenceDigest:'c'.repeat(64),requiredModules:preview().requiredModules,inheritedHuman:preview().inheritedHuman}},operation:'business_replan',input:{...request.input},options:{...request.options},runId:'new-business-run'}}}
function fixture(submit:ReplanPorts['submit']=async request=>receipt(request),lookup:ReplanPorts['lookup']=async()=>undefined){
  const saved=new Map<string,string>(),ports:ReplanPorts={storage:{getItem:key=>saved.get(key)??null,setItem:(key,value)=>{saved.set(key,value)}},preview:vi.fn(async input=>preview(input.inspectionScopeId)),submit:vi.fn(submit),lookup:vi.fn(lookup),uuid:vi.fn(()=>command)};
  const controller=new ScopeReplanController('workspace','root',ports);controller.observeTarget(target);
  return {saved,ports,controller,inspect:vi.mocked(ports.preview),send:vi.mocked(ports.submit),query:vi.mocked(ports.lookup)};
}
async function ready(f:ReturnType<typeof fixture>,permission:'ask'|'execute'='ask'){f.controller.edit(scopeId,message,permission);await f.controller.preview(target)}

it('挂载/编辑不核验或启动；显式核验不调用模型，新目标和独立权限保存后再提交',async()=>{
  const f=fixture();f.controller.subscribe(()=>{});f.controller.edit(scopeId,message,'ask');expect(f.inspect).not.toHaveBeenCalled();expect(f.send).not.toHaveBeenCalled();expect(f.ports.uuid).not.toHaveBeenCalled();
  await f.controller.preview(target);expect(f.inspect).toHaveBeenCalledWith({...identity,inspectionScopeId:scopeId});expect(f.send).not.toHaveBeenCalled();
  f.send.mockImplementation(async request=>{expect(JSON.parse(f.saved.get(f.controller.storageKey)!).records[0].attempt.request).toEqual(request);return receipt(request)});
  await f.controller.submit(target,model);expect(f.send).toHaveBeenCalledTimes(1);const request=f.send.mock.calls[0][0];expect(request.input.message).toBe(message);expect(request.options.permission).toBe('ask');expect(request).not.toHaveProperty('attachments');expect(request).not.toHaveProperty('agentInstanceId');expect(request).not.toHaveProperty('nativeSessionId');expect(f.controller.record(scopeId)?.attempt?.phase).toBe('accepted');
  f.controller.edit(scopeId,'不能改写','execute');await f.controller.submit(target,model);expect(f.controller.record(scopeId)?.permission).toBe('ask');expect(f.send).toHaveBeenCalledTimes(1);
});

it('显式execute不改变旧只读能力；修改目标或权限后必须重新核验，提交双击只发一次',async()=>{
  let finish!:(value:unknown)=>void;const f=fixture(()=>new Promise(resolve=>{finish=resolve}));await ready(f);
  f.controller.edit(scopeId,message,'execute');expect(f.controller.ready(target)).toBeUndefined();await f.controller.submit(target,model);expect(f.send).not.toHaveBeenCalled();
  await f.controller.preview(target);const pending=f.controller.submit(target,model);await f.controller.submit(target,model);expect(f.send).toHaveBeenCalledTimes(1);expect(f.send.mock.calls[0][0].options.permission).toBe('execute');
  finish(receipt(f.send.mock.calls[0][0]));await pending;expect(f.controller.record(scopeId)?.attempt?.request).not.toHaveProperty('operation');
});

it('迟到核验不能启用跨周期、版本或新草稿提交；错误身份与缺依据结果拒绝',async()=>{
  let finish!:(value:unknown)=>void;const f=fixture();f.controller.edit(scopeId,message,'ask');f.inspect.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve}));const pending=f.controller.preview(target);
  const next={...target,inspectionScopeId:'other'};f.controller.observeTarget(next);finish(preview());await pending;expect(f.controller.snapshot.preview).toBeUndefined();expect(f.controller.ready(target)).toBeUndefined();
  f.controller.observeTarget(target);f.inspect.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve}));const editing=f.controller.preview(target);f.controller.edit(scopeId,'修改目标','ask');finish(preview());await editing;expect(f.controller.ready(target)).toBeUndefined();
  await f.controller.preview(target);expect(f.controller.ready(target)).toBeDefined();f.controller.observeTarget({...target,anchor:'new-graph',graphCursor:{streamId:'graph',seq:9}});expect(f.controller.ready(target)).toBeUndefined();
  expect(()=>checkedReplanPreview({...preview(),identity:{...identity,inspectionScopeId:'foreign'}},target)).toThrow('不属于');expect(()=>checkedReplanPreview({...preview(),basis:undefined},target)).toThrow('缺少');
  f.controller.observeTarget(target);f.inspect.mockResolvedValueOnce({...preview(),graphCursor:{streamId:'graph',seq:9}});await f.controller.preview(target);expect(f.controller.snapshot.preview?.error).toContain('已变化');expect(f.controller.ready(target)).toBeUndefined();
});

it('预览阻塞只显示原始原因，不生成命令；无条件预览不能直接提交',async()=>{
  const f=fixture();f.controller.edit(scopeId,message,'ask');await f.controller.submit(target,model);expect(f.send).not.toHaveBeenCalled();
  f.inspect.mockResolvedValueOnce({...preview(),eligible:false,basis:undefined,issues:[{code:'REPLAN_PROOF_INVALID',message:'执行日志未完整核实'}]});await f.controller.preview(target);expect(f.controller.snapshot.preview?.result?.issues[0].message).toBe('执行日志未完整核实');await f.controller.submit(target,model);expect(f.send).not.toHaveBeenCalled();expect(f.ports.uuid).not.toHaveBeenCalled();
});

it('未知结果跨重开只查同命令，undefined不代表未受理；原请求重试冻结目标/权限/依据',async()=>{
  const f=fixture(async()=>{throw Error('IPC_TIMEOUT')});await ready(f,'execute');await f.controller.submit(target,model);const original=f.send.mock.calls[0][0];
  f.controller.edit(scopeId,'不能改变','ask');await f.controller.submit(target,{...model,model:'other'});expect(f.send).toHaveBeenCalledTimes(1);
  const reopened=new ScopeReplanController('workspace','root',f.ports);await reopened.restore();expect(f.query).toHaveBeenCalledWith({...identity,commandId:command});expect(f.inspect).toHaveBeenCalledTimes(1);expect(f.send).toHaveBeenCalledTimes(1);expect(reopened.record(scopeId)?.attempt?.phase).toBe('unknown');
  reopened.observeTarget(undefined); // 后续新周期使首次提交不再准入，也不能隐藏未知命令的原请求查询/重试。
  f.send.mockImplementation(async request=>receipt(request));await reopened.retry(scopeId);expect(f.send.mock.calls[1][0]).toEqual(original);expect(reopened.record(scopeId)?.attempt?.phase).toBe('accepted');
});

it('明确预受理拒绝可修正，曾未知后拒绝仍锁定，命令冲突不换ID',async()=>{
  const f=fixture(async()=>{throw Error('REPLAN_STALE: 依据变化')});await ready(f);await f.controller.submit(target,model);expect(f.controller.record(scopeId)?.attempt?.phase).toBe('rejected');f.controller.edit(scopeId,'新目标','ask');expect(f.controller.record(scopeId)?.message).toBe('新目标');expect(f.controller.ready(target)).toBeUndefined();
  const unknown=fixture(async()=>{throw Error('连接中断')});await ready(unknown);await unknown.controller.submit(target,model);unknown.send.mockRejectedValueOnce(Error('REPLAN_STALE: 依据变化'));await unknown.controller.retry(scopeId);expect(unknown.controller.record(scopeId)?.attempt?.phase).toBe('unknown');
  for(const code of ['REPLAN_COMMAND_CONFLICT','REPLAN_CONFLICT','REPLAN_UNKNOWN','COMMAND_ID_CONFLICT','COLLABORATION_STOPPED'])expect(replanRejected(Error(code+': 保留请求'))).toBe(false);
});

it('回执严格绑定目标/权限/已核验约束，受理后的可信事实不可覆盖',async()=>{
  const f=fixture();await ready(f);await f.controller.submit(target,model);const request=f.send.mock.calls[0][0],prior=f.controller.record(scopeId)!.attempt!.receipt!,proof=preview();
  expect(()=>checkedReplanReceipt({...prior,scopeId:'other'},request,proof)).toThrow('不一致');
  expect(()=>checkedReplanReceipt({...prior,replan:{...prior.replan,source:{...prior.replan.source,proof:{...prior.replan.source.proof,inheritedHuman:[]}}}},request,proof)).toThrow('前置依据');
  expect(()=>checkedReplanReceipt({...prior,replan:{...prior.replan,runId:prior.replan.source.proof.reviewRunId}},request,proof)).toThrow('前置依据');
  for(const change of [{runId:'different'},{acceptedAt:'2026-11-08T00:00:00.000Z'}]){f.query.mockResolvedValueOnce({...prior,replan:{...prior.replan,...change}});await f.controller.query(scopeId);expect(f.controller.record(scopeId)?.attempt?.receipt).toBe(prior);expect(f.controller.record(scopeId)?.attempt?.error).toContain('冲突')}
  f.query.mockResolvedValueOnce({...prior,scopeStatus:'closed'});await f.controller.query(scopeId);f.query.mockResolvedValueOnce(prior);await f.controller.query(scopeId);expect(f.controller.record(scopeId)?.attempt?.receipt?.scopeStatus).toBe('closed');
});

it('本地保存失败不发送不发布；损坏记录不自动覆盖；受理查询失败仍保留原命令',async()=>{
  const f=fixture();await ready(f);const save=f.ports.storage.setItem;f.ports.storage.setItem=()=>{throw Error('QuotaExceededError')};await f.controller.submit(target,model);expect(f.send).not.toHaveBeenCalled();expect(f.controller.record(scopeId)?.attempt).toBeUndefined();expect(f.controller.snapshot.error).toContain('保存');
  f.ports.storage.setItem=save;await f.controller.submit(target,model);expect(f.send).toHaveBeenCalledTimes(1);f.query.mockRejectedValueOnce(Error('网络中断'));await f.controller.query(scopeId);expect(f.controller.record(scopeId)?.attempt?.phase).toBe('accepted');
  f.saved.set(f.controller.storageKey,'{broken');const broken=new ScopeReplanController('workspace','root',f.ports);broken.observeTarget(target);broken.edit(scopeId,message,'ask');await broken.preview(target);await broken.submit(target,model);expect(broken.available).toBe(false);expect(f.saved.get(f.controller.storageKey)).toBe('{broken');expect(f.send).toHaveBeenCalledTimes(1);
});

it('工作区切换保留在途控制器；迟到受理只更新原来源，重开草稿不恢复预览资格',async()=>{
  let finish!:(value:unknown)=>void;const f=fixture(()=>new Promise(resolve=>{finish=resolve})),pool=new ScopeReplanPool(1),first=pool.get('workspace','root',f.ports);first.observeTarget(target);first.edit(scopeId,message,'ask');await first.preview(target);
  const pending=first.submit(target,model);pool.get('workspace','other',f.ports);expect(pool.get('workspace','root',f.ports)).toBe(first);first.observeTarget({...target,inspectionScopeId:'another'});first.edit('another','另一目标','ask');finish(receipt(f.send.mock.calls[0][0]));await pending;
  expect(first.record('another')?.attempt).toBeUndefined();expect(first.record(scopeId)?.attempt?.phase).toBe('accepted');
  const reopened=new ScopeReplanController('workspace','root',f.ports);reopened.observeTarget(target);expect(reopened.ready(target)).toBeUndefined();expect(reopened.record('another')?.message).toBe('另一目标');
});

it('索引容量和受理回执空间在发送前检查；不淘汰已有来源，足够空间可保存真实回执',async()=>{
  const f=fixture();for(let i=0;i<128;i++)f.controller.edit('source-'+i,'已保存草稿','ask');const original=f.saved.get(f.controller.storageKey);f.controller.edit(scopeId,message,'ask');expect(f.controller.snapshot.records).toHaveLength(128);expect(f.saved.get(f.controller.storageKey)).toBe(original);expect(f.controller.snapshot.error).toContain('128');
  const bounded=fixture();for(let i=0;i<19;i++)bounded.controller.edit('large-'+i,'中'.repeat(30000),'ask');bounded.controller.edit(scopeId,'文'.repeat(50000),'ask');await bounded.controller.preview(target);const before=bounded.saved.get(bounded.controller.storageKey)!;expect(new TextEncoder().encode(before).length).toBeLessThan(REPLAN_INDEX_BYTE_LIMIT);await bounded.controller.submit(target,model);expect(bounded.send).not.toHaveBeenCalled();expect(bounded.controller.record(scopeId)?.attempt).toBeUndefined();expect(bounded.saved.get(bounded.controller.storageKey)).toBe(before);expect(bounded.controller.snapshot.error).toContain('2 MiB');
  const enough=fixture();for(let i=0;i<14;i++)enough.controller.edit('large-'+i,'中'.repeat(30000),'ask');enough.controller.edit(scopeId,'文'.repeat(50000),'ask');await enough.controller.preview(target);await enough.controller.submit(target,model);expect(enough.send).toHaveBeenCalledTimes(1);expect(enough.controller.record(scopeId)?.attempt?.phase).toBe('accepted');expect(new ScopeReplanController('workspace','root',enough.ports).record(scopeId)?.attempt?.phase).toBe('accepted');
});

it('持久索引严格核验来源和命令唯一性，不借用其他root回执或隐藏重复命令',async()=>{
  const f=fixture();await ready(f);await f.controller.submit(target,model);const value=JSON.parse(f.saved.get(f.controller.storageKey)!);
  f.saved.set(f.controller.storageKey,JSON.stringify({...value,records:[...value.records,{...value.records[0],inspectionScopeId:'other'}]}));const broken=new ScopeReplanController('workspace','root',f.ports);expect(broken.available).toBe(false);
  f.saved.set(f.controller.storageKey,JSON.stringify({...value,rootSessionId:'foreign'}));expect(new ScopeReplanController('workspace','root',f.ports).available).toBe(false);
  const next={...target,inspectionScopeId:'second',anchor:'second-source'};f.controller.observeTarget(next);f.controller.edit('second','第二个业务目标','ask');await f.controller.preview(next);await f.controller.submit(next,model);expect(f.send).toHaveBeenCalledTimes(1);expect(f.controller.snapshot.error).toContain('重复');
  const excessive=JSON.stringify({...value,records:Array.from({length:129},(_,i)=>({inspectionScopeId:'scope-'+i,message:'草稿',permission:'ask'}))});f.saved.set(f.controller.storageKey,excessive);expect(new ScopeReplanController('workspace','root',f.ports).snapshot.error).toContain('128');expect(f.saved.get(f.controller.storageKey)).toBe(excessive);
  const oversized=JSON.stringify({...value,records:Array.from({length:25},(_,i)=>({inspectionScopeId:'scope-'+i,message:'中'.repeat(30000),permission:'ask'}))});f.saved.set(f.controller.storageKey,oversized);expect(new ScopeReplanController('workspace','root',f.ports).snapshot.error).toContain('2 MiB');expect(f.saved.get(f.controller.storageKey)).toBe(oversized);
});

function scopeState():ScopeGoalState{
  const graph:GraphSnapshot={version:1,identity,cursor:{...identity,streamId:'graph',seq:8},root:{kind:'session-root',nodeId:'session:root',identity,agent:{agentId:'cbim:main',agentInstanceId:'main',agentSessionId:'task-channel',name:'主 Agent'},revision:1,createdAt:time},tasks:[],edges:[],agents:[]};
  const scope:DispatchScope={...identity,scopeId,status:'closed',outcome:'completed',createdAt:time,closedAt:time,goal:{revision:3,input:{message:'核实原业务影响',attachmentIds:[]},plan:{revision:2,runId:'review',recordedAt:time,knowledgeRevision:'knowledge',graphCursor:{streamId:'graph',seq:8},objective:'只读核实',constraints:[],criteria:[{id:'c',kind:'evidence',text:'核对实际记录'}],assignments:[],reason:'读证据'},review:{revision:3,planRevision:2,runId:'review',recordedAt:time,knowledgeRevision:'knowledge',graphCursor:{streamId:'graph',seq:8},observedSeq:5,lastEffectSeq:0,decision:'complete',checks:[],superseded:[],gaps:[],reason:'核实结束'}}};
  const summary:ScopeSummary={scopeId,status:'closed',outcome:'completed',createdAt:time,closedAt:time,origin:'inspection',readOnly:true,hasGoal:true,hasPlan:true,goalRevision:3,reviewDecision:'complete',stamp:{scopeId,streamId:'scopes:graph',seq:4}};
  const view={label:'目标已完成',tone:'success' as const,phase:'completed'};
  return {scopes:[summary],selectedScopeId:scopeId,selectedScope:scope,graph,selectedGoalView:view,currentGoalView:view,loading:false,detailLoading:false,error:'',selectScope:()=>{}};
}

it('目标入口只认真实完成inspection，不从readOnly或文字猜测；历史选择不能遮蔽开放目标',()=>{
  const state=scopeState();expect(replanTarget('workspace','root',state).target?.inspectionScopeId).toBe(scopeId);
  for(const change of [{origin:undefined},{status:'waiting' as const},{outcome:'failed' as const},{readOnly:undefined},{goalRevision:4},{reviewDecision:'replan' as const}])expect(replanTarget('workspace','root',{...state,scopes:[{...state.scopes[0],...change}]}).target).toBeUndefined();
  expect(replanTarget('workspace','root',{...state,openScope:{...state.scopes[0],scopeId:'current',status:'waiting'}}).target).toBeUndefined();
  expect(replanTarget('workspace','root',{...state,scopes:[...state.scopes,{...state.scopes[0],scopeId:'current',status:'active'}]}).target).toBeUndefined();
  const later={...state.scopes[0],scopeId:'later-business',origin:'business_replan' as const,createdAt:'2025-01-01T00:00:00.000Z'};
  expect(replanTarget('workspace','root',{...state,scopes:[...state.scopes,later]}).target).toBeUndefined();
  expect(replanTarget('workspace','root',{...state,scopes:[later,...state.scopes]}).target).toBeDefined(); // 提交顺序优先，即使系统时钟回拨。
  expect(replanTarget('workspace','root',{...state,selectedScope:{...state.selectedScope!,rootSessionId:'foreign'}}).target).toBeUndefined();
  expect(replanTarget('workspace','root',state,'model-a').target?.anchor).not.toBe(replanTarget('workspace','root',state,'model-b').target?.anchor);
});

const base:ScopeReplanView={visible:true,inspectionScopeId:scopeId,message,permission:'ask',editable:true,canPreview:true,canSubmit:false,pending:false,error:'',reason:'',modelLabel:'model',edit:()=>{},preview:async()=>{},submit:async()=>{},query:async()=>{},retry:async()=>{},showCreated:()=>{}};
it('条件面板公开必覆盖模块与继承人工项，不能批准/删改；核验不冒充执行计划',()=>{
  const state={...base,previewState:{target,draftKey:'draft',loading:false,result:preview(),error:''}},html=renderToStaticMarkup(createElement(ScopeReplanForm,{state}));
  expect(html).toContain('核验新任务条件');expect(html).toContain('不是已经生成的执行计划');expect(html).toContain('游戏业务');expect(html).toContain('需要人工确认视觉效果');expect(html).toContain('尚未取得人工批准');expect(html).toContain('不会批准或删除');expect(html).not.toContain('type="checkbox"');expect(html).toMatch(/value="ask" selected/);expect(html).toMatch(/data-testid="scope-replan-submit" disabled/);
  const blocked=renderToStaticMarkup(createElement(ScopeReplanForm,{state:{...state,previewState:{...state.previewState,result:{...preview(),eligible:false,issues:[{code:'REPLAN_PROOF_INVALID',message:'日志不完整'}]}}}}));expect(blocked).toContain('日志不完整');expect(blocked).toContain('暂不能创建');
});

it('对话卡与任务根使用同一视图且表单不藏在目标details；未知只能原命令查询重试',()=>{
  const graph=scopeState(),card=renderToStaticMarkup(createElement(ScopeGoalPanel,{state:graph,compact:true,replan:base}));expect(card.indexOf('scope-replan-form')).toBeLessThan(card.indexOf('scope-goal-details'));
  const root=renderToStaticMarkup(createElement(SessionTaskView,{workspaceId:'workspace',taskId:'root',runs:[],queued:[],now:0,busy:false,onQueueChange:()=>{},onQueueContinue:()=>{},onChat:()=>{},onStop:()=>{},graph:graph.graph,scopeState:graph,replan:base,selectedTaskId:'session:root',onSelectTask:()=>{}}));expect(root).toContain('scope-replan-form');expect(root).toContain(message);
  const request:ReplanRequest={...identity,commandId:command,source:{inspectionScopeId:scopeId,expectedBasis:preview().basis!},input:{message},options:{...model,permission:'ask'}};
  const unknown={...base,editable:false,record:{inspectionScopeId:scopeId,message,permission:'ask' as const,attempt:{request,proof:preview(),phase:'unknown' as const,uncertain:true}}};
  const html=renderToStaticMarkup(createElement(ScopeReplanForm,{state:unknown}));expect(html).toContain('scope-replan-query');expect(html).toContain('scope-replan-retry');expect(html).not.toContain('scope-replan-submit');expect(html).toMatch(/readonly=""/i);
  const accepted=renderToStaticMarkup(createElement(ScopeReplanForm,{state:{...unknown,record:{...unknown.record,attempt:{...unknown.record.attempt,phase:'accepted',receipt:receipt(request)}}}}));expect(accepted).toContain('新业务周期已受理');expect(accepted).toContain('scope-replan-view');expect(accepted).not.toContain('scope-replan-retry');
});
