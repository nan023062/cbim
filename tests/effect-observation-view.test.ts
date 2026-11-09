import {expect,it,vi} from 'vitest';
import {EffectObservationController,EffectObservationPool,checkedEffectReport,checkedEffectReceipt,type EffectPorts} from '../src/frontend/tasks/effect-observation-state';
import {effectRecoveryTarget,effectObservationAnchor} from '../src/frontend/tasks/effect-recovery-state';
import {ExecutionRecoveryController,checkedRecoveryReceipt,recoverySourceKey} from '../src/frontend/tasks/recovery-state';
import type {EffectObservationInput,EffectObservationReport,EffectDispositionInput,EffectDispositionReceipt} from '../src/bridge/contracts/effect-observation';
import type {RecoveryRequest,RecoveryReceipt} from '../src/bridge/contracts/dispatch';
import type {ScopeGoalState} from '../src/frontend/tasks/scope-state';

const identity:EffectObservationInput={workspaceId:'workspace',rootSessionId:'root',subject:{kind:'main_run',runId:'original-main',toolCallIds:['original-call']}},hash='a'.repeat(64),command='11111111-1111-4111-8111-111111111111',time='2026-11-08T00:00:00.000Z';
function report():EffectObservationReport{return {version:1,identity:structuredClone(identity),checkedAt:time,basis:hash,dispositionRevision:0,consistency:'stable',source:{state:'verified',scopeId:'old-scope',scopeStatus:'closed',scopeOutcome:'failed',execution:'settled',logState:'verified',logPrefixHash:hash,throughSeq:6,unknownToolCount:1},calls:[{toolCallId:'original-call',toolName:'write',outcome:'unknown',coverage:'selected_files_now',inputHash:hash,proposedSeq:2,allowedSeq:3,scope:{kind:'workspace',workspaceId:'workspace'},file:{relativePath:'src/result.txt',state:'present',byteLength:8,sha256:hash},limitations:['当前文件不说明原操作完整效果']}],limitations:[],readOnly:true,acceptance:'not_evaluated'}}
function receipt(request:EffectDispositionInput):EffectDispositionReceipt{return {workspaceId:request.workspaceId,rootSessionId:request.rootSessionId,record:{version:1,dispositionId:request.commandId,request,revision:request.expectedRevision+1,recordedAt:time,actor:{kind:'local_desktop',interaction:'explicit_submit'},observation:{...report(),identity:{workspaceId:request.workspaceId,rootSessionId:request.rootSessionId,subject:request.subject},basis:request.expectedBasis,dispositionRevision:request.expectedRevision}}}}
function fixture(){const saved=new Map<string,string>(),ports:EffectPorts={storage:{getItem:k=>saved.get(k)??null,setItem:(k,v)=>{saved.set(k,v)}},uuid:vi.fn(()=>command),observe:vi.fn(async()=>report()),record:vi.fn(async request=>receipt(request)),receipt:vi.fn(async()=>undefined),list:vi.fn(async()=>({identity,revision:0,records:[],readOnly:true})),relations:vi.fn(async()=>{throw Error('not queried')})};const controller=new EffectObservationController('workspace','root',ports);controller.observeAnchor(identity,'v1');return {saved,ports,controller}}
async function prepare(f:ReturnType<typeof fixture>){await f.controller.observe(identity);f.controller.edit(identity,'当前文件存在但原调用未知','inspect_more')}

it('构造、订阅及重开不读取；重复显式观察合并，原unknown与当前文件并存',async()=>{
 const f=fixture(),listener=vi.fn();f.controller.subscribe(listener);expect(f.ports.observe).not.toHaveBeenCalled();let resolve!:(v:unknown)=>void;vi.mocked(f.ports.observe).mockImplementationOnce(()=>new Promise(done=>{resolve=done}));const first=f.controller.observe(identity);await f.controller.observe(identity);expect(f.ports.observe).toHaveBeenCalledTimes(1);resolve(report());await first;expect(f.controller.fresh(identity)).toBe(true);expect(f.controller.read(identity)?.report?.calls[0]).toMatchObject({outcome:'unknown',file:{state:'present'}});new EffectObservationController('workspace','root',f.ports);expect(f.ports.observe).toHaveBeenCalledTimes(1);expect(f.ports.record).not.toHaveBeenCalled();
});

it('主工具、成员详情与重规划共享会话时效，切换视图不作废依据，真实周期更新才作废',async()=>{
 const f=fixture(),state={graph:{cursor:{streamId:'g',seq:3}},scopes:[{scopeId:'old',stamp:{scopeId:'old',streamId:'s',seq:4}}],selectedScopeId:'old'} as unknown as ScopeGoalState;
 const switched:ScopeGoalState={...state,selectedScopeId:'inspection'},original=effectObservationAnchor(state),other=effectObservationAnchor(switched);expect(other).toBe(original);f.controller.observeAnchor(identity,original);await prepare(f);f.controller.observeAnchor(identity,other);expect(f.controller.fresh(identity)).toBe(true);
 f.controller.observeAnchor(identity,effectObservationAnchor({...state,scopes:[{...state.scopes[0],stamp:{...state.scopes[0].stamp,seq:5}}]}));expect(f.controller.fresh(identity)).toBe(false);expect(f.ports.observe).toHaveBeenCalledTimes(1);
});

it('观察失败保留旧报告；图版本变化不自动回读，迟到观察不能取得新版本提交资格',async()=>{
 const f=fixture();await prepare(f);const old=f.controller.read(identity)?.report;vi.mocked(f.ports.observe).mockRejectedValueOnce(Error('IO'));await f.controller.observe(identity);expect(f.controller.read(identity)?.report).toBe(old);expect(f.controller.fresh(identity)).toBe(false);let finish!:(v:unknown)=>void;vi.mocked(f.ports.observe).mockImplementationOnce(()=>new Promise(done=>{finish=done}));const work=f.controller.observe(identity);f.controller.observeAnchor(identity,'v2');finish(report());await work;await f.controller.submit(identity);expect(f.ports.record).not.toHaveBeenCalled();expect(f.controller.fresh(identity)).toBe(false);
});

it.each(['workspaceId','rootSessionId'] as const)('拒绝跨%s报告，坏来源不能覆盖原报告',async field=>{
 const f=fixture();await prepare(f);const old=f.controller.read(identity)?.report,bad=report();bad.identity[field]='different';vi.mocked(f.ports.observe).mockResolvedValueOnce(bad);await f.controller.observe(identity);expect(f.controller.read(identity)?.report).toBe(old);expect(f.controller.read(identity)?.error).toContain('失败');
});

it('拒绝跨run/调用顺序及私有字段；missing文件不能冒充0字节存在',()=>{
 const r=report();expect(()=>checkedEffectReport({...r,privateNative:'secret'},identity)).toThrow();expect(()=>checkedEffectReport({...r,identity:{...identity,subject:{...identity.subject,runId:'other'}}},identity)).toThrow();expect(()=>checkedEffectReport({...r,calls:[{...r.calls[0],file:{relativePath:'src/result.txt',state:'missing',byteLength:0,sha256:hash}}]},identity)).toThrow();
});

it('保存前持久完整命令，双击一次，接受后只读刷新不启动任务',async()=>{
 const f=fixture();await prepare(f);let finish!:(v:unknown)=>void;vi.mocked(f.ports.record).mockImplementationOnce(request=>{expect(JSON.parse(f.saved.get(f.controller.storageKey)!).attempts[0].request).toEqual(request);return new Promise(done=>{finish=done})});const work=f.controller.submit(identity);await f.controller.submit(identity);expect(f.ports.record).toHaveBeenCalledTimes(1);const request=vi.mocked(f.ports.record).mock.calls[0][0];finish(receipt(request));await work;expect(f.controller.attempt(identity)?.phase).toBe('accepted');expect(f.controller.selected(identity)?.request.reason).toBe('当前文件存在但原调用未知');expect(f.controller.fresh(identity)).toBe(false);f.controller.edit(identity,'不能改写','leave_unresolved');expect(f.controller.draft(identity)?.reason).toBe(request.reason);expect(f.ports.relations).not.toHaveBeenCalled();
});

it('丢回包锁定原请求，重开零请求；显式查询undefined仍未知，原回执恢复',async()=>{
 const f=fixture();await prepare(f);let saved:EffectDispositionReceipt|undefined;vi.mocked(f.ports.record).mockImplementationOnce(async request=>{saved=receipt(request);throw Error('IPC lost')});await f.controller.submit(identity);const request=f.controller.attempt(identity)!.request;await f.controller.submit(identity);expect(f.ports.record).toHaveBeenCalledTimes(1);const reopened=new EffectObservationController('workspace','root',f.ports);expect(reopened.attempt(identity)?.request).toEqual(request);expect(f.ports.receipt).not.toHaveBeenCalled();await reopened.query(identity,command);expect(reopened.attempt(identity)?.phase).toBe('unknown');vi.mocked(f.ports.receipt).mockResolvedValueOnce(saved);await reopened.query(identity,command);expect(reopened.attempt(identity)?.phase).toBe('accepted');expect(f.ports.record).toHaveBeenCalledTimes(1);
});

it('保存失败不发送；坏本机索引保留原字节且不可写',async()=>{
 const f=fixture();await prepare(f);f.ports.storage.setItem=()=>{throw Error('quota')};await f.controller.submit(identity);expect(f.ports.record).not.toHaveBeenCalled();expect(f.controller.draft(identity)?.commandId).toBeUndefined();const raw='corrupt';f.saved.set(f.controller.storageKey,raw);const reopened=new EffectObservationController('workspace','root',f.ports);expect(reopened.available).toBe(false);reopened.edit(identity,'不能覆盖','leave_unresolved');expect(f.saved.get(f.controller.storageKey)).toBe(raw);
});

it('只有专用事务前拒绝允许编辑；事务CAS与IO仍冻结未知命令',async()=>{
 const denied=fixture();await prepare(denied);vi.mocked(denied.ports.record).mockRejectedValueOnce(Error('EFFECT_PREACCEPT_BASIS_STALE: 文件已变化'));await denied.controller.submit(identity);expect(denied.controller.attempt(identity)?.phase).toBe('rejected');expect(denied.controller.fresh(identity)).toBe(false);denied.controller.edit(identity,'重新核实后补充理由','inspect_more');expect(denied.controller.draft(identity)?.commandId).toBeUndefined();
 for(const code of ['EFFECT_BASIS_STALE','EFFECT_REVISION_CONFLICT','IO']){const f=fixture();await prepare(f);vi.mocked(f.ports.record).mockRejectedValueOnce(Error(code+': 未确认'));await f.controller.submit(identity);f.controller.edit(identity,'不能换命令','leave_unresolved');expect(f.controller.attempt(identity)?.phase).toBe('unknown');expect(f.controller.draft(identity)?.commandId).toBe(command)}
});

it('同来源历史并发查询按用户最后选择生效，迟到回执仅保存历史',async()=>{
 const f=fixture(),other='22222222-2222-4222-8222-222222222222',request=(id:string,n:number):EffectDispositionInput=>({...identity,commandId:id,expectedBasis:hash,expectedRevision:n,decision:'inspect_more',reason:'历史'}),a=receipt(request(command,0)),b=receipt(request(other,1));
 vi.mocked(f.ports.list).mockResolvedValueOnce({identity,revision:2,records:[a,b].map(v=>({dispositionId:v.record.dispositionId,revision:v.record.revision,decision:'inspect_more',reason:'历史',reasonTruncated:false,recordedAt:time,observationBasis:hash})),readOnly:true});await f.controller.list(identity);let old!:(value:unknown)=>void;vi.mocked(f.ports.receipt).mockImplementationOnce(()=>new Promise(done=>{old=done})).mockResolvedValueOnce(b);const first=f.controller.query(identity,command);await f.controller.query(identity,other);old(a);await first;expect(f.controller.selected(identity)?.dispositionId).toBe(other);expect(f.controller.snapshot.attempts).toHaveLength(2);
});

it('处置回执跨命令或更改原事实被拒，已保存记录不被查询失败撤销',async()=>{
 const f=fixture();await prepare(f);await f.controller.submit(identity);const old=f.controller.attempt(identity)!,changed=structuredClone(old.receipt!);changed.record.request.reason='修改后的理由';expect(()=>checkedEffectReceipt(changed,old.request)).toThrow();vi.mocked(f.ports.receipt).mockResolvedValueOnce(changed);await f.controller.query(identity,command);expect(f.controller.attempt(identity)?.phase).toBe('accepted');expect(f.controller.attempt(identity)?.receipt).toEqual(old.receipt);expect(f.controller.attempt(identity)?.error).toContain('查询结果');
});

it('显式历史选择才读取回执，关系必须属于相同处置且不把新完成写成原成功',async()=>{
 const f=fixture(),req:EffectDispositionInput={...identity,commandId:command,expectedBasis:hash,expectedRevision:0,decision:'inspect_more',reason:'历史处置'},value=receipt(req);vi.mocked(f.ports.list).mockResolvedValueOnce({identity,revision:1,records:[{dispositionId:command,revision:1,decision:req.decision,reason:req.reason,reasonTruncated:false,recordedAt:time,observationBasis:hash}],readOnly:true});await f.controller.list(identity);expect(f.controller.selected(identity)).toBeUndefined();expect(f.ports.receipt).not.toHaveBeenCalled();vi.mocked(f.ports.receipt).mockResolvedValueOnce(value);await f.controller.query(identity,command);vi.mocked(f.ports.relations).mockResolvedValueOnce({identity:{workspaceId:'workspace',rootSessionId:'root',dispositionId:command},record:value.record,links:[{kind:'repair',scopeId:'new-scope',status:'closed',outcome:'completed',runId:'new-run',taskIds:['new-task']}],readOnly:true});await f.controller.relations(identity);expect(f.controller.read(identity)?.relations?.links[0].outcome).toBe('completed');expect(f.controller.selected(identity)?.observation.calls[0].outcome).toBe('unknown');expect(f.ports.record).not.toHaveBeenCalled();
});

it('历史切换清除上一处置关系；读取旧处置失败可见且不撤销当前事实',async()=>{
 const f=fixture(),second='22222222-2222-4222-8222-222222222222';await prepare(f);await f.controller.submit(identity);const a=f.controller.selected(identity)!;
 vi.mocked(f.ports.relations).mockResolvedValueOnce({identity:{workspaceId:'workspace',rootSessionId:'root',dispositionId:command},record:a,links:[],readOnly:true});await f.controller.relations(identity);expect(f.controller.read(identity)?.relations?.identity.dispositionId).toBe(command);
 f.controller.prepare(identity);await f.controller.observe(identity);vi.mocked(f.ports.uuid).mockReturnValueOnce(second);await f.controller.submit(identity);expect(f.controller.selected(identity)?.dispositionId).toBe(second);expect(f.controller.read(identity)?.relations).toBeUndefined();
 const b=f.controller.selected(identity)!;vi.mocked(f.ports.relations).mockResolvedValueOnce({identity:{workspaceId:'workspace',rootSessionId:'root',dispositionId:second},record:b,links:[],readOnly:true});await f.controller.relations(identity);
 vi.mocked(f.ports.receipt).mockRejectedValueOnce(Error('历史A读取失败'));await f.controller.query(identity,command);expect(f.controller.read(identity)?.error).toContain('历史A读取失败');expect(f.controller.selected(identity)?.dispositionId).toBe(second);expect(f.controller.read(identity)?.relations?.identity.dispositionId).toBe(second);
 vi.mocked(f.ports.receipt).mockResolvedValueOnce({workspaceId:'workspace',rootSessionId:'root',record:a});await f.controller.query(identity,command);expect(f.controller.selected(identity)?.dispositionId).toBe(command);expect(f.controller.read(identity)?.relations).toBeUndefined();expect(f.controller.read(identity)?.error).toBe('');expect(f.ports.record).toHaveBeenCalledTimes(2);
});

it('主来源不借根TaskNode，关闭scope和明确处置缺一不可；无plan仍可申请只读核实',()=>{
 const current=report(),req:EffectDispositionInput={...identity,commandId:command,expectedBasis:hash,expectedRevision:0,decision:'inspect_more',reason:'核实'},record=receipt(req).record;
 const state={loading:false,error:'',graph:{identity:{workspaceId:'workspace',rootSessionId:'root'},tasks:[]},scopes:[{scopeId:'old-scope',status:'closed'}]} as unknown as ScopeGoalState;
 const result=effectRecoveryTarget(identity,current,true,record,state);expect(result.target?.source).toEqual({...identity.subject,reportBasis:hash});expect(result.target?.source).not.toHaveProperty('taskId');expect(result.target?.dispositionId).toBe(command);expect(effectRecoveryTarget(identity,current,true,undefined,state).target).toBeUndefined();expect(effectRecoveryTarget(identity,current,false,record,state).target).toBeUndefined();expect(effectRecoveryTarget(identity,{...current,source:{...current.source,scopeId:undefined,state:'unverifiable'}},true,record,state).target).toBeUndefined();expect(effectRecoveryTarget(identity,current,true,record,{...state,openScope:{status:'active'}} as unknown as ScopeGoalState).target).toBeUndefined();
});

it('新主恢复回执严格匹配来源和处置，旧key不变；共享池不产生跨root写入',async()=>{
 const saved=new Map<string,string>(),source={kind:'main_run' as const,runId:'original-main',toolCallIds:['original-call'],reportBasis:hash};
 const options={profileId:'33333333-3333-4333-8333-333333333333',provider:'fixture',model:'fixture',permission:'read' as const};
 const make=(request:RecoveryRequest):RecoveryReceipt=>({workspaceId:request.workspaceId,rootSessionId:request.rootSessionId,scopeId:request.commandId,scopeStatus:'active',recovery:{recoveryId:request.commandId,acceptedAt:time,source:{...source,scopeId:'old-scope',scopeOutcome:'failed',reportExecution:'unknown',logState:'verified',unknownToolCount:1},operation:'inspect_effects',observation:request.observation,input:request.input,options:request.options,runId:'fresh-run',dispositionId:request.dispositionId}});
 const submit=vi.fn(async(r:RecoveryRequest)=>make(r)),controller=new ExecutionRecoveryController('workspace','root',{storage:{getItem:k=>saved.get(k)??null,setItem:(k,v)=>{saved.set(k,v)}},uuid:()=>command,submit,lookup:async()=>undefined});controller.edit(source,{observation:'未知',message:'只读调查'});await controller.submit({workspaceId:identity.workspaceId,rootSessionId:identity.rootSessionId,source,dispositionId:'22222222-2222-4222-8222-222222222222'},options);expect(controller.record(source)?.attempt?.phase).toBe('accepted');const req=submit.mock.calls[0][0],wrong=make(req);wrong.recovery.dispositionId=undefined;expect(()=>checkedRecoveryReceipt(wrong,req)).toThrow();expect(recoverySourceKey({scopeId:'s',taskId:'t'})).toBe(JSON.stringify(['s','t',undefined]));const f=fixture(),pool=new EffectObservationPool();expect(pool.get('workspace','root',f.ports)).toBe(pool.get('workspace','root',f.ports));expect(pool.get('workspace','other',f.ports)).not.toBe(pool.get('workspace','root',f.ports));
});
