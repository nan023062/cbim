import {expect,it,vi} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {HumanDecisionController,HumanDecisionPool,checkedHumanDecisionPreview,checkedHumanDecisionReceipt,humanDecisionRejected,type HumanDecisionTarget,type HumanDecisionPorts} from '../src/frontend/tasks/human-decision-state';
import {humanDecisionTarget,type HumanDecisionsView} from '../src/frontend/tasks/useHumanDecisions';
import {HumanDecisionPanel} from '../src/frontend/tasks/HumanDecisionPanel';
import {humanDecisionCoverageLimitation,humanDecisionPreviewSchema,humanDecisionReceiptSchema,type HumanDecisionPreviewInput,type HumanDecisionPreview,type HumanDecisionRequest,type HumanDecisionReceipt} from '../src/bridge/contracts/human-decisions';
import type {DispatchScope,ScopeSummary} from '../src/bridge/contracts/dispatch';
import type {ScopeGoalState} from '../src/frontend/tasks/scope-state';

const time='2026-11-07T00:00:00.000Z',hash='a'.repeat(64),target:HumanDecisionTarget={workspaceId:'workspace',rootSessionId:'root',scopeId:'scope',criterionId:'human',anchor:'anchor-1'};
const selection={taskId:'task',runId:'member-run',baselineId:'baseline'},criterion={id:'human',text:'请人工判断成果是否满足目标',kind:'human' as const};
const identity={workspaceId:target.workspaceId,rootSessionId:target.rootSessionId,scopeId:target.scopeId};
function preview(input:HumanDecisionPreviewInput,revision=0):HumanDecisionPreview{
  return humanDecisionPreviewSchema.parse({identity:{...identity,criterionId:input.criterionId},checkedAt:time,decisionRevision:revision,basis:hash,
    source:{waitId:'wait',goalRevision:3,inputRevision:1,planRevision:2,reviewRevision:3,reviewRunId:'main-run',reviewLogHash:hash,knowledgeRevision:'knowledge',graphCursor:{streamId:'graph',seq:8},criterion:{...criterion,id:input.criterionId}},
    candidates:[{taskId:'task',taskRevision:5,runId:'member-run',resultId:'result',planRevision:1,logHash:hash,evidenceToolCallIds:['read-1'],agentName:'执行者',summary:'真实候选',baselines:[{baselineId:'baseline',capturedAt:time,fileCount:1},{baselineId:'baseline-two',capturedAt:time,fileCount:1}],
      ...(input.baselines.length?{selected:{baselineId:input.baselines[0].baselineId,captureToolCallId:'capture',capturedSeq:4,finishedSeq:5,knowledgeRevision:'knowledge',progressVersion:2,invalidated:false,files:[{relativePath:'result.txt',expected:{byteLength:4,sha256:hash},observed:{byteLength:4,sha256:hash},state:'matches'}]}}:{})}],
    allowedDecisions:input.baselines.length?['accept','reject','request_evidence']:['reject','request_evidence'],limitations:[humanDecisionCoverageLimitation],issues:[]});
}
function receipt(request:HumanDecisionRequest):HumanDecisionReceipt{
  const p=preview(request,request.expectedDecisionRevision),candidate=p.candidates[0],{agentName:_name,summary:_summary,baselines:_menu,...proofCandidate}=candidate;
  return humanDecisionReceiptSchema.parse({...identity,scopeStatus:'waiting',decisionRevision:request.expectedDecisionRevision+1,record:{decisionId:request.commandId,revision:request.expectedDecisionRevision+1,recordedAt:time,actor:{kind:'local_desktop',interaction:'explicit_submit'},criterionId:request.criterionId,decision:request.decision,comment:request.comment,basis:request.expectedBasis,baselines:request.baselines,proof:{identity,source:p.source,candidates:[proofCandidate],limitations:p.limitations,allowedDecisions:p.allowedDecisions}}});
}
function fixture(submit:HumanDecisionPorts['submit']=async request=>receipt(request),lookup:HumanDecisionPorts['lookup']=async()=>undefined){
  let number=0;const saved=new Map<string,string>(),read=vi.fn(async(input:HumanDecisionPreviewInput)=>preview(input)),send=vi.fn(submit),query=vi.fn(lookup),storage={getItem:(key:string)=>saved.get(key)??null,setItem:(key:string,value:string)=>{saved.set(key,value)}},ports:HumanDecisionPorts={storage,preview:read,submit:send,lookup:query,uuid:()=>`22222222-2222-4222-8222-${String(++number).padStart(12,'0')}`};
  const controller=new HumanDecisionController('workspace','root',ports);return {controller,saved,ports,send,query,read};
}
async function ready(f:ReturnType<typeof fixture>,controller=f.controller){controller.edit(target,{baselines:[selection],decision:'accept',comment:'明确意见'});await controller.preview(target)}

it('不自动核实或选择基线，选择改变后必须重新预览才能提交',async()=>{
  const f=fixture();expect(f.read).not.toHaveBeenCalled();await f.controller.preview(target);expect(f.controller.record('scope','human')).toBeUndefined();expect(f.controller.currentPreview(target)?.candidates[0].selected).toBeUndefined();
  f.controller.edit(target,{baselines:[selection],decision:'accept',comment:'意见'});expect(f.controller.currentPreview(target)).toBeUndefined();await f.controller.submit(target);expect(f.send).not.toHaveBeenCalled();
  await f.controller.preview(target);await f.controller.submit(target);expect(f.read).toHaveBeenCalledTimes(2);expect(f.send).toHaveBeenCalledTimes(1);
});

it('旧选择和旧目标的迟到预览不能覆盖新选择或成为新目标的依据',async()=>{
  const f=fixture();let old!:(value:HumanDecisionPreview)=>void;f.read.mockImplementationOnce(input=>new Promise(resolve=>{old=resolve}));const pending=f.controller.preview(target);
  f.controller.edit(target,{baselines:[selection]});await f.controller.preview(target);const current=f.controller.currentPreview(target);expect(current?.candidates[0].selected?.baselineId).toBe('baseline');old(preview({...identity,criterionId:'human',baselines:[]}));await pending;expect(f.controller.currentPreview(target)).toBe(current);
  expect(f.controller.currentPreview({...target,anchor:'anchor-2'})).toBeUndefined();await f.controller.submit({...target,anchor:'anchor-2'});expect(f.send).not.toHaveBeenCalled();
  expect(f.controller.currentPreview({...target,criterionId:'other'})).toBeUndefined();
});

it('双卡共享草稿及在途请求，先持久化冻结请求再发送，双击只有一个命令',async()=>{
  let finish!:(value:HumanDecisionReceipt)=>void;const f=fixture(request=>{expect(JSON.parse(f.saved.get(f.controller.storageKey)!).records[0].attempt.request).toEqual(request);return new Promise(resolve=>{finish=resolve})}),pool=new HumanDecisionPool();
  const first=pool.get('workspace','root',f.ports),second=pool.get('workspace','root',f.ports);expect(second).toBe(first);await ready(f,first);expect(second.record('scope','human')?.comment).toBe('明确意见');
  const sending=first.submit(target);await second.submit(target);second.edit(target,{comment:'在途不能替换'});expect(f.send).toHaveBeenCalledTimes(1);expect(first.record('scope','human')?.comment).toBe('明确意见');
  finish(receipt(f.send.mock.calls[0][0]));await sending;expect(second.record('scope','human')?.attempt?.phase).toBe('accepted');
});

it('未知提交重开只查询，查无结果保留原命令且显式重试不改正文或选择',async()=>{
  const f=fixture(async()=>{throw Error('IPC_TIMEOUT')});await ready(f);await f.controller.submit(target);const request=f.send.mock.calls[0][0],reopened=new HumanDecisionController('workspace','root',f.ports);await reopened.restore();expect(f.query).toHaveBeenCalledTimes(1);expect(f.send).toHaveBeenCalledTimes(1);expect(f.read).toHaveBeenCalledTimes(1);
  reopened.edit(target,{comment:'不能替换',baselines:[]});await reopened.submit(target);expect(reopened.record('scope','human')?.attempt?.request).toEqual(request);f.send.mockImplementation(async value=>receipt(value));await reopened.retry('scope','human');expect(f.send.mock.calls[1][0]).toEqual(request);expect(reopened.record('scope','human')?.attempt?.phase).toBe('accepted');
});

it('服务已保存但响应丢失，重开查询原记录而不再次提交',async()=>{
  let accepted:HumanDecisionReceipt|undefined;const f=fixture(async request=>{accepted=receipt(request);throw Error('响应中断')},async()=>accepted);await ready(f);await f.controller.submit(target);const reopened=new HumanDecisionController('workspace','root',f.ports);await reopened.restore();expect(reopened.record('scope','human')?.attempt?.receipt).toEqual(accepted);expect(f.send).toHaveBeenCalledTimes(1);await reopened.retry('scope','human');expect(f.send).toHaveBeenCalledTimes(1);
});

it('首次HUMAN_STALE拒绝后必须重新核实；未知后同样拒绝仍不能解冻',async()=>{
  const f=fixture(async()=>{throw Error('HUMAN_STALE: 文件变化')});await ready(f);await f.controller.submit(target);expect(f.controller.record('scope','human')?.attempt?.phase).toBe('rejected');expect(f.controller.currentPreview(target)).toBeUndefined();f.controller.edit(target,{comment:'保留新意见'});await f.controller.submit(target);expect(f.send).toHaveBeenCalledTimes(1);f.send.mockImplementation(async request=>receipt(request));await f.controller.preview(target);await f.controller.submit(target);expect(f.send).toHaveBeenCalledTimes(2);
  const unknown=fixture(async()=>{throw Error('IPC_TIMEOUT')});await ready(unknown);await unknown.controller.submit(target);const request=unknown.send.mock.calls[0][0];unknown.send.mockImplementation(async()=>{throw Error('HUMAN_STALE: 后续拒绝')});await unknown.controller.retry('scope','human');expect(unknown.controller.record('scope','human')?.attempt).toMatchObject({phase:'unknown',uncertain:true,request});unknown.controller.edit(target,{comment:'不能换ID'});expect(unknown.controller.record('scope','human')?.comment).toBe('明确意见');
  expect(humanDecisionRejected(Error('COMMAND_ID_CONFLICT: 原命令内容不一致'))).toBe(false);expect(humanDecisionRejected(Error('IO: 写入失败'))).toBe(false);
});

it('预览与回执核验外层及proof身份，错误依据不能确认提交',async()=>{
  const f=fixture();await ready(f);const input={...identity,criterionId:'human',baselines:[selection]},p=preview(input);expect(()=>checkedHumanDecisionPreview({...p,identity:{...p.identity,rootSessionId:'other'}},input)).toThrow('不一致');expect(()=>checkedHumanDecisionPreview(p,{...input,baselines:[]})).toThrow('不一致');
  f.send.mockImplementation(async request=>{const r=receipt(request);return {...r,record:{...r.record,proof:{...r.record.proof,identity:{...identity,rootSessionId:'other'}}}}});await f.controller.submit(target);expect(f.controller.record('scope','human')?.attempt?.phase).toBe('unknown');const request=f.send.mock.calls[0][0],good=receipt(request);
  expect(()=>checkedHumanDecisionReceipt({...good,workspaceId:'other'},request)).toThrow();expect(()=>checkedHumanDecisionReceipt({...good,record:{...good.record,comment:'错误正文'}},request)).toThrow('不一致');expect(()=>checkedHumanDecisionReceipt({...good,record:{...good.record,recordedAt:'2026-11-08T00:00:00.000Z'}},request,good)).toThrow('不一致');
});

it('本地持久化失败或损坏数据不发送，也不覆盖未知请求',async()=>{
  const f=fixture();await ready(f);f.ports.storage.setItem=()=>{throw Error('QuotaExceededError')};await f.controller.submit(target);expect(f.send).not.toHaveBeenCalled();expect(f.controller.available).toBe(false);expect(f.controller.snapshot.error).toContain('本地保存失败');expect(f.controller.record('scope','human')?.comment).toBe('明确意见');
  const broken=fixture();broken.saved.set(broken.controller.storageKey,'{broken');const controller=new HumanDecisionController('workspace','root',broken.ports);controller.edit(target,{comment:'不能覆盖'});await controller.preview(target);await controller.submit(target);expect(controller.available).toBe(false);expect(broken.saved.get(controller.storageKey)).toBe('{broken');expect(broken.send).not.toHaveBeenCalled();expect(broken.read).not.toHaveBeenCalled();
});

it('已记录决定不能重复提交，新编辑才准备新意见而不篡改旧回执',async()=>{
  const f=fixture();await ready(f);await f.controller.submit(target);const first=structuredClone(f.controller.record('scope','human')!.attempt!);await f.controller.submit(target);expect(f.send).toHaveBeenCalledTimes(1);f.controller.edit(target,{decision:'reject',comment:'重新考虑'});expect(f.controller.record('scope','human')?.attempt).toBeUndefined();f.read.mockImplementation(async input=>preview(input,1));await f.controller.preview(target);await f.controller.submit(target);expect(f.send).toHaveBeenCalledTimes(2);expect(f.send.mock.calls[1][0].commandId).not.toBe(first.request.commandId);expect(f.send.mock.calls[1][0].expectedDecisionRevision).toBe(1);expect(first.receipt?.record.decision).toBe('accept');
});
it('返工新等待显式清除旧基线后才能列出新成果，历史回执不改且未知请求不能清除',async()=>{
  const f=fixture();await ready(f);await f.controller.submit(target);const original=structuredClone(f.controller.record('scope','human')!.attempt!.receipt),next={...target,anchor:'new-wait-new-candidate'};
  f.read.mockImplementation(async input=>{if(input.baselines.length)throw Error('HUMAN_SOURCE_INVALID: 旧基线不属于当前成果');const listed=preview(input,1);return {...listed,source:{...listed.source!,waitId:'new-wait'},candidates:listed.candidates.map(value=>({...value,taskId:'new-task',runId:'new-run',resultId:'new-result'}))}});
  await f.controller.preview(next);expect(f.controller.previewState(next)?.error).toContain('HUMAN_SOURCE_INVALID');const before=f.read.mock.calls.length;expect(f.controller.resetBaselines(next)).toBe(true);expect(f.read).toHaveBeenCalledTimes(before);expect(f.controller.record('scope','human')).toMatchObject({baselines:[],comment:'明确意见'});expect(f.controller.record('scope','human')?.decision).toBeUndefined();expect(f.controller.currentPreview(next)).toBeUndefined();expect(f.controller.record('scope','human')?.attempt).toBeUndefined();
  await f.controller.preview(next);expect(f.read.mock.lastCall?.[0].baselines).toEqual([]);expect(f.controller.currentPreview(next)?.source?.waitId).toBe('new-wait');expect(original?.record.baselines).toEqual([selection]);expect(f.send).toHaveBeenCalledTimes(1);
  const unknown=fixture(async()=>{throw Error('IPC_TIMEOUT')});await ready(unknown);await unknown.controller.submit(target);const request=structuredClone(unknown.controller.record('scope','human'));expect(unknown.controller.resetBaselines(next)).toBe(false);expect(unknown.controller.record('scope','human')).toEqual(request);expect(unknown.read).toHaveBeenCalledTimes(1);
});
it('清除基线会隔离旧选择的迟到预览，重新读取不继承旧文件观察',async()=>{
  const f=fixture();await ready(f);let finish!:(value:HumanDecisionPreview)=>void;f.read.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve}));const pending=f.controller.preview(target);
  expect(f.controller.resetBaselines(target)).toBe(true);await f.controller.preview(target);expect(f.controller.currentPreview(target)?.candidates[0].selected).toBeUndefined();finish(preview({...identity,criterionId:'human',baselines:[selection]}));await pending;expect(f.controller.currentPreview(target)?.candidates[0].selected).toBeUndefined();expect(f.controller.record('scope','human')?.baselines).toEqual([]);expect(f.send).not.toHaveBeenCalled();
});

function scopeState():ScopeGoalState{
  const source=preview({...identity,criterionId:'human',baselines:[]}).source!,stamp={revision:2,inputRevision:1,runId:'main-first',recordedAt:time,knowledgeRevision:'knowledge',graphCursor:source.graphCursor};
  const selected:DispatchScope={...identity,status:'waiting',createdAt:time,goal:{revision:3,inputRevision:1,input:{message:'原目标',attachmentIds:[]},plan:{...stamp,objective:'原目标',constraints:[],criteria:[criterion],assignments:[{agentId:'agent',agentName:'执行者',teamId:'team',moduleIds:['module'],moduleNames:['模块'],criterionIds:['human'],reason:'职责'}],reason:'保存目标'},review:{...stamp,revision:3,runId:'main-run',planRevision:2,decision:'awaiting_user',checks:[{criterionId:'human',outcome:'needs_human',reason:'等待人工',evidence:[]}],superseded:[],gaps:['等待人工'],reason:'等待人工',observedSeq:8,lastEffectSeq:0}},wait:{waitId:'wait',reason:'等待人工',createdAt:time,runId:'main-run',goalRevision:3,graphCursor:source.graphCursor,knowledgeRevision:'knowledge',mainRunIds:['main-first','main-run']}};
  const summary:ScopeSummary={scopeId:'scope',status:'waiting',createdAt:time,hasGoal:true,hasPlan:true,goalRevision:3,inputRevision:1,reviewDecision:'awaiting_user',wait:{waitId:'wait',reason:'等待人工',createdAt:time,goalRevision:3},stamp:{scopeId:'scope',streamId:'scopes:graph',seq:1}};
  const goalView={phase:'waiting',label:'等待补充',tone:'warning' as const};return {scopes:[summary],openScope:summary,waitingScope:summary,selectedScopeId:'scope',selectedScope:selected,selectedGoalView:goalView,currentGoalView:goalView,loading:false,detailLoading:false,error:'',selectScope:()=>{}};
}
it('只有当前waiting人工项可写，历史、未追齐详情与错误身份不会得到提交目标',()=>{
  const state=scopeState(),actual=humanDecisionTarget('workspace','root',state,'human');expect(actual).toMatchObject(identity);expect(actual?.criterionId).toBe('human');expect(humanDecisionTarget('workspace','root',{...state,selectedScopeId:'history'},'human')).toBeUndefined();expect(humanDecisionTarget('workspace','root',{...state,detailLoading:true},'human')).toBeUndefined();expect(humanDecisionTarget('workspace','root',{...state,error:'同步失败'},'human')).toBeUndefined();expect(humanDecisionTarget('workspace','other',state,'human')).toBeUndefined();expect(humanDecisionTarget('workspace','root',state,'non-human')).toBeUndefined();expect(humanDecisionTarget('workspace','root',{...state,selectedScope:{...state.selectedScope!,wait:{...state.selectedScope!.wait!,waitId:'obsolete'}}},'human')).toBeUndefined();
  const changed={...state,waitingScope:{...state.waitingScope!,stamp:{...state.waitingScope!.stamp,seq:2}}};expect(humanDecisionTarget('workspace','root',changed,'human')?.anchor).not.toBe(actual?.anchor);
});
function view():HumanDecisionsView{return {scopeId:'scope',criterionId:'human',criteria:[criterion],history:[],eligible:true,editable:true,pending:false,previewCurrent:false,canSubmit:false,canRetry:false,error:'',select:()=>{},chooseBaseline:()=>{},chooseDecision:()=>{},comment:()=>{},clearBaselines:async()=>{},inspect:async()=>{},submit:async()=>{},query:async()=>{},retry:async()=>{}}}
it('视图不默认选择文件，三种意见明确显示，历史仅展示且不提供继续执行',async()=>{
  const f=fixture();await f.controller.preview(target);const markup=renderToStaticMarkup(createElement(HumanDecisionPanel,{state:{...view(),preview:f.controller.previewState(target),previewCurrent:true}}));expect(markup).toContain('<option value="" selected="">未选择');expect(markup).toContain('human-decision-accept');expect(markup).toContain('human-decision-reject');expect(markup).toContain('human-decision-request_evidence');expect(markup).toContain('不启动模型');expect(markup).not.toContain('window.confirm');
  await ready(f);await f.controller.submit(target);const record=f.controller.record('scope','human')!,historical=renderToStaticMarkup(createElement(HumanDecisionPanel,{state:{...view(),eligible:false,editable:false,record,history:[record.attempt!.receipt!.record]}}));expect(historical).toContain('human-history');expect(historical).toContain('尚非整体目标完成');expect(historical).not.toContain('data-testid="human-submit"');expect(historical).not.toContain('data-testid="human-preview"');expect(historical).not.toContain('<button');expect(historical).toContain('保存本身不启动模型');expect(f.send).toHaveBeenCalledTimes(1);
});
