import {expect,it,vi} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {ScopeContinuationController,ScopeContinuationPool,checkedContinuationReceipt,continuationRejected,type ContinuationTarget,type ContinuationPorts} from '../src/frontend/tasks/continuation-state';
import {continuationTarget,continuationModel,type ScopeContinuationView} from '../src/frontend/tasks/useScopeContinuation';
import {ScopeContinuationForm} from '../src/frontend/tasks/ScopeContinuationForm';
import type {GoalContinuationRequest,GoalContinuationReceipt,DispatchScope,ScopeSummary} from '../src/bridge/contracts/dispatch';
import type {ScopeGoalState} from '../src/frontend/tasks/scope-state';
import {continuationFiles,appendContinuationFiles} from '../src/frontend/tasks/continuation-attachments';

const target:ContinuationTarget={workspaceId:'workspace',rootSessionId:'root',scopeId:'scope',waitId:'wait',expectedGoalRevision:3,expectedInputRevision:1};
const options={provider:'cbim-11111111-1111-4111-8111-111111111111',profileId:'11111111-1111-4111-8111-111111111111',model:'model',permission:'ask' as const};
const command='22222222-2222-4222-8222-222222222222',time='2026-11-07T00:00:00.000Z';
function receipt(request:GoalContinuationRequest):GoalContinuationReceipt{return {workspaceId:request.workspaceId,rootSessionId:request.rootSessionId,scopeId:request.scopeId,scopeStatus:'active',continuation:{continuationId:request.commandId,acceptedAt:time,wait:{waitId:request.waitId,reason:'需要补充',createdAt:time,runId:'previous',goalRevision:request.expectedGoalRevision,graphCursor:{streamId:'graph',seq:1},knowledgeRevision:'knowledge',mainRunIds:['previous']},inputRevision:request.expectedInputRevision+1,input:{...request.input},runId:'reserved-run',options:structuredClone(request.options)}}}
function fixture(submit:ContinuationPorts['submit']=async request=>receipt(request),lookup:ContinuationPorts['lookup']=async()=>undefined){
  const saved=new Map<string,string>(),storage={getItem:(key:string)=>saved.get(key)??null,setItem:(key:string,value:string)=>{saved.set(key,value)}},send=vi.fn(submit),query=vi.fn(lookup),ports:ContinuationPorts={storage,submit:send,lookup:query,uuid:()=>command};
  const controller=new ScopeContinuationController(target.workspaceId,target.rootSessionId,ports);return {controller,saved,ports,send,query};
}

it('先保存冻结正文/模型/权限再发送，双击两处表单也只产生一次请求',async()=>{
  let release!:(value:unknown)=>void;const f=fixture(request=>{const saved=JSON.parse(f.saved.get(f.controller.storageKey)!);expect(saved.records[0].attempt.request).toEqual(request);return new Promise(resolve=>{release=resolve})});
  f.controller.edit(target,'  原始补充\n正文  ');const first=f.controller.submit(target,options);await f.controller.submit(target,options);
  expect(f.send).toHaveBeenCalledTimes(1);const request=f.send.mock.calls[0][0];expect(request.input.message).toBe('  原始补充\n正文  ');expect(request).not.toHaveProperty('attachments');
  release(receipt(request));await first;expect(f.controller.record('scope','wait')?.attempt?.phase).toBe('accepted');
  f.controller.edit(target,'不能改写已受理正文');await f.controller.submit(target,{...options,permission:'execute'});expect(f.send).toHaveBeenCalledTimes(1);expect(f.controller.record('scope','wait')?.text).toBe('  原始补充\n正文  ');
});

it('通信未知后查询undefined仍冻结请求，重试保持原id正文与原模型设置',async()=>{
  const f=fixture(async()=>{throw Error('IPC_TIMEOUT')});f.controller.edit(target,'同意继续讨论，不是人工批准');await f.controller.submit(target,options);
  const request=f.send.mock.calls[0][0];expect(f.controller.record('scope','wait')?.attempt?.phase).toBe('unknown');
  f.controller.edit(target,'另一个正文');await f.controller.submit(target,{...options,model:'other',permission:'execute'});expect(f.send).toHaveBeenCalledTimes(1);
  await f.controller.query('scope','wait');expect(f.query).toHaveBeenCalledTimes(1);expect(f.controller.record('scope','wait')?.attempt?.phase).toBe('unknown');
  f.send.mockImplementation(async request=>receipt(request));await f.controller.retry('scope','wait');expect(f.send).toHaveBeenCalledTimes(2);expect(f.send.mock.calls[1][0]).toEqual(request);
});

it('服务已受理但响应丢失，重开只查回执不自动发送或重复启动',async()=>{
  let accepted:GoalContinuationReceipt|undefined;const f=fixture(async request=>{accepted=receipt(request);throw Error('连接中断')},async()=>accepted);
  f.controller.edit(target,'补充');await f.controller.submit(target,options);const reopened=new ScopeContinuationController(target.workspaceId,target.rootSessionId,f.ports);
  expect(reopened.record('scope','wait')?.attempt?.phase).toBe('unknown');await reopened.restore();expect(f.send).toHaveBeenCalledTimes(1);expect(f.query).toHaveBeenCalledTimes(1);expect(reopened.record('scope','wait')?.attempt?.phase).toBe('accepted');
  await reopened.retry('scope','wait');expect(f.send).toHaveBeenCalledTimes(1);
});

it('切换工作区再返回仍共享在途控制器，迟到回执不覆盖另一个等待草稿',async()=>{
  let finish!:(value:unknown)=>void;const f=fixture(()=>new Promise(resolve=>{finish=resolve})),pool=new ScopeContinuationPool(1);
  const first=pool.get('workspace','root',f.ports);first.edit(target,'当前请求');const sending=first.submit(target,options);
  pool.get('workspace','other-root',f.ports);const returned=pool.get('workspace','root',f.ports);expect(returned).toBe(first);
  returned.edit({...target,waitId:'next-wait'},'新等待草稿');await returned.submit(target,options);expect(f.send).toHaveBeenCalledTimes(1);
  finish(receipt(f.send.mock.calls[0][0]));await sending;
  const records=JSON.parse(f.saved.get(first.storageKey)!).records;expect(records.find((item:any)=>item.waitId==='next-wait').text).toBe('新等待草稿');expect(records.find((item:any)=>item.waitId==='wait').attempt.phase).toBe('accepted');
});

it('明确预受理拒绝保留草稿可修正，曾经未知的请求即使重试拒绝也不解锁换id',async()=>{
  const f=fixture(async()=>{throw Error('GOAL_WAIT_CONFLICT: 等待版本已变化')});f.controller.edit(target,'草稿');await f.controller.submit(target,options);expect(f.controller.record('scope','wait')?.attempt?.phase).toBe('rejected');f.controller.edit(target,'修正草稿');expect(f.controller.record('scope','wait')?.text).toBe('修正草稿');
  const uncertain=fixture(async()=>{throw Error('网络失败')});uncertain.controller.edit(target,'保留');await uncertain.controller.submit(target,options);uncertain.send.mockImplementation(async()=>{throw Error('GOAL_WAIT_CONFLICT: 旧请求仍不能改写')});await uncertain.controller.retry('scope','wait');expect(uncertain.controller.record('scope','wait')?.attempt?.phase).toBe('unknown');
  expect(continuationRejected(Error('COMMAND_ID_CONFLICT: 请求已绑定不同内容'))).toBe(false);expect(continuationRejected(Error('CONTINUATION_CONFLICT: 已有提交'))).toBe(false);expect(continuationRejected(Error('COLLABORATION_STOPPED: 已受理后停止'))).toBe(false);
});

it.each(['SCOPE_BUDGET_EXCEEDED','SCOPE_BUDGET_UNVERIFIABLE','SCOPE_BUDGET_WAITING'])('首次 %s 明确未受理并保留草稿，曾通信未知的请求仍冻结',async code=>{
  const f=fixture(async()=>{throw Error(code+': 尚未接受本次补充')});f.controller.edit(target,'等待用户的原始补充');await f.controller.submit(target,options);
  const record=f.controller.record('scope','wait');expect(record?.text).toBe('等待用户的原始补充');expect(record?.attempt).toMatchObject({phase:'rejected',uncertain:false});expect(record?.attempt?.receipt).toBeUndefined();
  const reopened=new ScopeContinuationController(target.workspaceId,target.rootSessionId,f.ports);expect(reopened.record('scope','wait')?.attempt?.phase).toBe('rejected');reopened.edit(target,'可修正的草稿');expect(reopened.record('scope','wait')?.text).toBe('可修正的草稿');
  const uncertain=fixture(async()=>{throw Error('IPC_TIMEOUT')});uncertain.controller.edit(target,'冻结正文');await uncertain.controller.submit(target,options);const request=uncertain.send.mock.calls[0][0];uncertain.send.mockImplementation(async()=>{throw Error(code+': 后续拒绝')});await uncertain.controller.retry('scope','wait');
  expect(uncertain.controller.record('scope','wait')?.attempt).toMatchObject({phase:'unknown',uncertain:true,request});uncertain.controller.edit(target,'不能替换');expect(uncertain.controller.record('scope','wait')?.text).toBe('冻结正文');expect(uncertain.send.mock.calls[1][0]).toEqual(request);
  expect(continuationRejected(Error('SCOPE_BUDGET_RUN_CONFLICT: 非预受理错误'))).toBe(false);
});

it('成员文件或原权限的首次核验拒绝可修正，通信未知后同样的错误仍不能更换请求',async()=>{
  for(const code of ['MEMBER_CHECKPOINT_ARTIFACT_CHANGED','GOAL_MEMBER_PAUSE_PERMISSION','OWNER_MODEL_CHANGED']){
    const f=fixture(async()=>{throw Error(code+': 原成员尚未恢复')});f.controller.edit(target,'保留原补充');await f.controller.submit(target,options);
    expect(f.controller.record('scope','wait')?.attempt).toMatchObject({phase:'rejected',uncertain:false});const reopened=new ScopeContinuationController(target.workspaceId,target.rootSessionId,f.ports);reopened.edit(target,'核实后明确修正');expect(reopened.record('scope','wait')?.text).toBe('核实后明确修正');
    f.send.mockImplementation(async request=>receipt(request));await reopened.submit(target,options);expect(reopened.record('scope','wait')?.attempt?.phase).toBe('accepted');
    const uncertain=fixture(async()=>{throw Error('IPC_TIMEOUT')});uncertain.controller.edit(target,'冻结正文');await uncertain.controller.submit(target,options);const request=uncertain.send.mock.calls[0][0];uncertain.send.mockImplementation(async()=>{throw Error(code+': 后续核验失败')});await uncertain.controller.retry('scope','wait');uncertain.controller.edit(target,'不能改写');
    expect(uncertain.controller.record('scope','wait')?.attempt).toMatchObject({phase:'unknown',uncertain:true,request});expect(uncertain.controller.record('scope','wait')?.text).toBe('冻结正文');
  }
  expect(continuationRejected(Error('MEMBER_CHECKPOINT_UNKNOWN: 无可靠结论'))).toBe(false);expect(continuationRejected(Error('GOAL_MEMBER_PAUSE_COMMIT_UNKNOWN: 不推测未来代码'))).toBe(false);
});

it('本地保存失败不发请求且可恢复保存，损坏记录不能默默丢弃未知请求',async()=>{
  const f=fixture();f.controller.edit(target,'保留草稿');const real=f.ports.storage.setItem;f.ports.storage.setItem=()=>{throw Error('QuotaExceededError')};await f.controller.submit(target,options);expect(f.send).not.toHaveBeenCalled();expect(f.controller.snapshot.error).toContain('未能保存');expect(f.controller.record('scope','wait')?.text).toBe('保留草稿');
  f.ports.storage.setItem=real;await f.controller.submit(target,options);expect(f.send).toHaveBeenCalledTimes(1);
  f.saved.set(f.controller.storageKey,'{broken');const broken=new ScopeContinuationController(target.workspaceId,target.rootSessionId,f.ports);broken.edit(target,'不能覆盖');await broken.submit(target,options);expect(f.send).toHaveBeenCalledTimes(1);expect(broken.available).toBe(false);expect(f.saved.get(f.controller.storageKey)).toBe('{broken');
});

it('跨目标或错误冻结内容的回执不能确认提交，本地记录按工作区/根/等待隔离',async()=>{
  const f=fixture(async request=>({...receipt(request),scopeId:'other'}));f.controller.edit(target,'原目标');await f.controller.submit(target,options);expect(f.controller.record('scope','wait')?.attempt?.phase).toBe('unknown');
  const request=f.send.mock.calls[0][0];expect(()=>checkedContinuationReceipt({...receipt(request),continuation:{...receipt(request).continuation,options:{...options,permission:'execute'}}},request)).toThrow('不一致');
  f.controller.edit({...target,waitId:'wait-two'},'另一等待草稿');expect(f.controller.record('scope','wait')?.text).toBe('原目标');expect(f.controller.record('scope','wait-two')?.text).toBe('另一等待草稿');
  const other=new ScopeContinuationController('workspace','other-root',f.ports);expect(other.snapshot.records).toEqual([]);await other.submit(target,options);expect(f.send).toHaveBeenCalledTimes(1);
});

function scopeState():ScopeGoalState{
  const wait=receipt({...target,commandId:command,input:{message:'补充'},options}).continuation.wait;
  const selected:DispatchScope={...target,status:'waiting',createdAt:time,goal:{revision:3,input:{message:'原始目标',attachmentIds:[]}},wait};
  const summary:ScopeSummary={scopeId:'scope',status:'waiting',createdAt:time,hasGoal:true,hasPlan:true,goalRevision:3,inputRevision:1,reviewDecision:'awaiting_user',wait:{waitId:'wait',reason:'需要补充',createdAt:time,goalRevision:3},stamp:{scopeId:'scope',streamId:'scopes:graph',seq:1}};
  const goalView={phase:'waiting',label:'等待补充',tone:'warning' as const};return {scopes:[summary],openScope:summary,waitingScope:summary,selectedScopeId:'scope',selectedScope:selected,selectedGoalView:goalView,currentGoalView:goalView,loading:false,detailLoading:false,error:'',selectScope:()=>{}};
}
it('只有当前waiting详情同身份同版本可写，历史选择/换根/同步失败全部只读',()=>{
  const state=scopeState();expect(continuationTarget('workspace','root',state)).toEqual(target);
  expect(continuationTarget('workspace','root',{...state,selectedScopeId:'history'})).toBeUndefined();expect(continuationTarget('workspace','root',{...state,detailLoading:true})).toBeUndefined();expect(continuationTarget('workspace','other',state)).toBeUndefined();expect(continuationTarget('workspace','root',{...state,error:'同步失败'})).toBeUndefined();
  expect(continuationTarget('workspace','root',{...state,selectedScope:{...state.selectedScope!,wait:{...state.selectedScope!.wait!,waitId:'obsolete'}}})).toBeUndefined();
  expect(continuationTarget('workspace','root',{...state,waitingScope:{...state.waitingScope!,inputRevision:2}})).toBeUndefined();
});

it('历史表单不提供提交或重试按钮，未知与受理不冒充执行或人工验收',()=>{
  const request={...target,commandId:command,input:{message:'补充'},options};
  const base:ScopeContinuationView={sourceSelectionKey:JSON.stringify(target),importSource:async()=>{},materialTargets:async()=>undefined,materialList:async()=>undefined,cancelImport:()=>{},workspaceId:'workspace',attachments:[],importing:false,pickFiles:async()=>{},removeFile:()=>{},scopeId:'scope',waitId:'wait',text:'补充',editable:false,canSubmit:false,canRetry:false,pending:false,error:'',modelLabel:'model',edit:()=>{},submit:async()=>{},submitInput:async()=>{},query:async()=>{},retry:async()=>{}};
  const unknown=renderToStaticMarkup(createElement(ScopeContinuationForm,{state:{...base,record:{scopeId:'scope',waitId:'wait',text:'补充',attempt:{request,phase:'unknown',uncertain:true}}}}));expect(unknown).toMatch(/readonly=""/i);expect(unknown).toContain('查询提交状态');expect(unknown).not.toContain('scope-continuation-submit');expect(unknown).not.toContain('scope-continuation-retry');expect(unknown).toContain('不代表人工验收');
  const accepted=renderToStaticMarkup(createElement(ScopeContinuationForm,{state:{...base,record:{scopeId:'scope',waitId:'wait',text:'补充',attempt:{request,phase:'accepted',uncertain:false,receipt:receipt(request)}}}}));expect(accepted).toContain('补充已受理');expect(accepted).not.toContain('正在运行');
});

it('只读核实周期的补充权限取真实开放周期，不随composer或历史选择提权',()=>{
  const state=scopeState(),model={options:{...options,permission:'execute' as const},label:'model · 完全访问'};
  const effective=continuationModel(model,{openScope:{...state.openScope!,readOnly:true}})!;
  expect(effective.options.permission).toBe('read');expect(effective.label).toContain('只读核实');expect(model.options.permission).toBe('execute');
  expect(continuationModel(model,{openScope:state.openScope})).toBe(model);
});

const files=[{id:'33333333-3333-4333-8333-333333333333',kind:'file' as const,name:'需求.txt',source:'C:/fixture/需求.txt'},{id:'44444444-4444-4444-8444-444444444444',kind:'file' as const,name:'参考.png',source:'C:/fixture/参考.png',note:'图片快照 · image/png'}];
function attachmentReceipt(request:GoalContinuationRequest):GoalContinuationReceipt{
  const value=receipt(request);if(!request.input.attachmentIds)return value;
  value.continuation.attachmentManifest={version:1,items:request.input.attachmentIds.map(id=>({attachmentId:id,kind:'file',name:files.find(file=>file.id===id)?.name??'文件',contentKind:'text',snapshotHash:'a'.repeat(64),contentHash:'b'.repeat(64),byteLength:12})),expandedMessageHash:'c'.repeat(64),expandedMessageBytes:512};return value;
}
it('共享选择器锁挡住双表单重复导入和导入中提交，并保留导入期间编辑的最新正文',async()=>{
  let finish!:(value:unknown)=>void;const f=fixture(async request=>attachmentReceipt(request)),pick=vi.fn(()=>new Promise(resolve=>{finish=resolve}));f.ports.pickFiles=pick;const changes=vi.fn(),off=f.controller.subscribe(changes);
  f.controller.edit(target,'初始');const work=f.controller.pickFiles(target,()=>true);
  expect(f.controller.isImporting).toBe(true);off();expect(f.controller.canRelease).toBe(false);
  await f.controller.pickFiles(target,()=>true);await f.controller.submit(target,options);expect(pick).toHaveBeenCalledTimes(1);expect(f.send).not.toHaveBeenCalled();
  f.controller.edit(target,'导入期间的新正文');finish(files);await work;
  expect(f.controller.record('scope','wait')).toMatchObject({text:'导入期间的新正文',attachments:files});expect(f.controller.isImporting).toBe(false);expect(f.controller.canRelease).toBe(true);expect(changes).toHaveBeenCalled();
  await f.controller.submit(target,options);expect(f.send.mock.calls[0][0].input).toEqual({message:'导入期间的新正文',attachmentIds:files.map(file=>file.id)});expect(f.controller.record('scope','wait')?.attempt?.phase).toBe('accepted');
});

it('切换或卸载后迟到的文件和错误均丢弃，旧等待与新等待草稿互不污染',async()=>{
  let finish!:(value:unknown)=>void,fail!:(value:unknown)=>void,current=true;
  const f=fixture();f.ports.pickFiles=()=>new Promise((resolve,reject)=>{finish=resolve;fail=reject});f.controller.edit(target,'旧草稿');
  const work=f.controller.pickFiles(target,()=>current);current=false;f.controller.edit({...target,waitId:'new'},'新草稿');finish(files);await work;
  expect(f.controller.record('scope','wait')?.attachments).toBeUndefined();expect(f.controller.record('scope','new')?.attachments).toBeUndefined();expect(f.controller.snapshot.error).toBe('');
  current=true;const failed=f.controller.pickFiles(target,()=>current);current=false;fail(Error('迟到导入失败'));await failed;expect(f.controller.snapshot.error).toBe('');
  expect(f.controller.record('scope','new')?.text).toBe('新草稿');expect(f.controller.isImporting).toBe(false);
});

it('未知请求冻结原附件顺序，重开只查询；查回原回执后不能删附件或再次发送',async()=>{
  let original:GoalContinuationReceipt|undefined;const f=fixture(async request=>{original=attachmentReceipt(request);throw Error('IPC_TIMEOUT')},async()=>original);f.ports.pickFiles=async()=>files;
  f.controller.edit(target,'查看所附参考');await f.controller.pickFiles(target,()=>true);await f.controller.submit(target,options);
  const request=f.send.mock.calls[0][0];f.controller.removeFile(target,files[0].id);await f.controller.pickFiles(target,()=>true);f.controller.edit(target,'不能替换');
  expect(f.controller.record('scope','wait')?.attachments).toEqual(files);expect(f.controller.record('scope','wait')?.text).toBe('查看所附参考');
  const reopened=new ScopeContinuationController('workspace','root',f.ports);expect(reopened.record('scope','wait')?.attachments).toEqual(files);await reopened.restore();expect(reopened.record('scope','wait')?.attempt?.phase).toBe('accepted');expect(f.send).toHaveBeenCalledTimes(1);
  reopened.removeFile(target,files[0].id);await reopened.submit(target,options);expect(f.send).toHaveBeenCalledTimes(1);expect(reopened.record('scope','wait')?.attempt?.request).toEqual(request);
  const reversed={...request,input:{...request.input,attachmentIds:[...request.input.attachmentIds!].reverse()}};
  expect(()=>checkedContinuationReceipt(attachmentReceipt(reversed),request)).toThrow('不一致');
});

it('附件预受理拒绝保留可编辑草稿，通用模型失败与已有未知请求仍冻结',async()=>{
  const f=fixture(async()=>{throw Error('GOAL_ATTACHMENT_VISION: 不支持图片')});f.ports.pickFiles=async()=>files;f.controller.edit(target,'补充');await f.controller.pickFiles(target,()=>true);await f.controller.submit(target,options);
  expect(f.controller.record('scope','wait')?.attempt?.phase).toBe('rejected');f.controller.removeFile(target,files[1].id);expect(f.controller.record('scope','wait')?.attachments).toEqual(files.slice(0,1));
  expect(continuationRejected(Error('MODEL_VISION_UNSUPPORTED: 引擎已初始化'))).toBe(false);
  const uncertain=fixture(async()=>{throw Error('IPC_TIMEOUT')});uncertain.ports.pickFiles=async()=>files;uncertain.controller.edit(target,'冻结');await uncertain.controller.pickFiles(target,()=>true);await uncertain.controller.submit(target,options);uncertain.send.mockImplementation(async()=>{throw Error('GOAL_ATTACHMENT_MISSING: 已经未知')});await uncertain.controller.retry('scope','wait');expect(uncertain.controller.record('scope','wait')?.attempt?.phase).toBe('unknown');
});

it('草稿只存公开文件元数据，超量或跨种类不覆盖原选择；清空后恢复纯文本请求形状',async()=>{
  const f=fixture();f.ports.pickFiles=async()=>files;f.controller.edit(target,'正文');await f.controller.pickFiles(target,()=>true);
  expect(appendContinuationFiles(files,[files[0]])).toEqual(files);
  expect(()=>continuationFiles([{...files[0],text:'禁止存正文'}])).toThrow();expect(()=>continuationFiles([{...files[0],kind:'folder'}])).toThrow();expect(()=>continuationFiles([files[0],files[0]])).toThrow();expect(()=>continuationFiles(Array.from({length:13},()=>files[0]))).toThrow();
  f.ports.pickFiles=async()=>[{...files[0],kind:'folder'}];await f.controller.pickFiles(target,()=>true);expect(f.controller.snapshot.error).toContain('未能添加');expect(f.controller.record('scope','wait')?.attachments).toEqual(files);
  f.controller.removeFile(target,files[0].id);f.controller.removeFile(target,files[1].id);await f.controller.submit(target,options);expect(f.send.mock.calls[0][0].input).toEqual({message:'正文'});expect(f.controller.record('scope','wait')).not.toHaveProperty('attachments');
});

it('损坏的本地冻结附件顺序拒绝恢复，不能以新命令覆盖可能已受理的请求',async()=>{
  const f=fixture(async()=>{throw Error('IPC_TIMEOUT')});f.ports.pickFiles=async()=>files;f.controller.edit(target,'正文');await f.controller.pickFiles(target,()=>true);await f.controller.submit(target,options);
  const saved=JSON.parse(f.saved.get(f.controller.storageKey)!);saved.records[0].attachments.reverse();const bad=JSON.stringify(saved);f.saved.set(f.controller.storageKey,bad);
  const reopened=new ScopeContinuationController('workspace','root',f.ports);expect(reopened.available).toBe(false);expect(reopened.snapshot.error).toContain('不一致');await reopened.submit(target,options);expect(f.send).toHaveBeenCalledTimes(1);expect(f.saved.get(f.controller.storageKey)).toBe(bad);
});

it('已受理回执只更新周期状态，矛盾运行或附件清单不能覆盖原事实',async()=>{
  let returned:GoalContinuationReceipt|undefined;const f=fixture(async request=>attachmentReceipt(request),async()=>returned);f.ports.pickFiles=async()=>files;
  f.controller.edit(target,'保留这份资料');await f.controller.pickFiles(target,()=>true);await f.controller.submit(target,options);
  const original=structuredClone(f.controller.record('scope','wait')!.attempt!.receipt!);
  returned={...original,scopeStatus:'closed'};await f.controller.query('scope','wait');expect(f.controller.record('scope','wait')?.attempt?.receipt?.scopeStatus).toBe('closed');
  const accepted=structuredClone(f.controller.record('scope','wait')!.attempt!.receipt!);
  for(const mutate of [(value:GoalContinuationReceipt)=>{value.continuation.runId='different-run'},(value:GoalContinuationReceipt)=>{value.continuation.attachmentManifest!.items[0].contentHash='d'.repeat(64)}]){
    returned=structuredClone(accepted);mutate(returned);await f.controller.query('scope','wait');const attempt=f.controller.record('scope','wait')!.attempt!;
    expect(attempt.phase).toBe('accepted');expect(attempt.receipt).toEqual(accepted);expect(attempt.error).toContain('不一致');expect(f.send).toHaveBeenCalledTimes(1);
  }
});


it('聊天发送转交同一等待与有序附件，持久化后才发请求，重复发送不另建命令',async()=>{
  const f=fixture(async request=>attachmentReceipt(request));
  await f.controller.submitInput(target,options,'继续',files);
  expect(f.send).toHaveBeenCalledTimes(1);
  expect(f.send.mock.calls[0][0]).toMatchObject({...target,input:{message:'继续',attachmentIds:files.map(file=>file.id)},options});
  expect(f.controller.record('scope','wait')?.attempt?.phase).toBe('accepted');
  await expect(f.controller.submitInput(target,options,'继续',files)).rejects.toThrow('尚不能发送');
  expect(f.send).toHaveBeenCalledTimes(1);
});

it('聊天转交不能覆盖目标卡草稿，也不能把附件交给另一会话',async()=>{
  const f=fixture();f.controller.edit(target,'原补充');
  await expect(f.controller.submitInput(target,options,'继续',files)).rejects.toThrow('已有补充草稿');
  expect(f.controller.record('scope','wait')?.text).toBe('原补充');
  await expect(f.controller.submitInput({...target,rootSessionId:'other'},options,'继续',files)).rejects.toThrow('尚不能发送');
  expect(f.send).not.toHaveBeenCalled();
});

it.each(['IPC_TIMEOUT','GOAL_WAIT_CONFLICT: 等待已变更'])('聊天转交遇到 %s 仍可找回草稿，不改身份重发',async code=>{
  const f=fixture(async()=>{throw Error(code)});
  await f.controller.submitInput(target,options,'继续',files);
  const record=f.controller.record('scope','wait');
  expect(record).toMatchObject({text:'继续',attachments:files,attempt:{phase:code==='IPC_TIMEOUT'?'unknown':'rejected'}});
  const reopened=new ScopeContinuationController('workspace','root',f.ports);
  expect(reopened.record('scope','wait')).toEqual(record);
  expect(f.send).toHaveBeenCalledTimes(1);
});

it('聊天转交保存失败时拒绝转移所有权，且不发送请求',async()=>{
  const f=fixture();f.ports.storage.setItem=()=>{throw Error('磁盘不可写')};
  await expect(f.controller.submitInput(target,options,'继续',files)).rejects.toThrow('未能保存');
  expect(f.send).not.toHaveBeenCalled();
  expect(f.controller.record('scope','wait')).toMatchObject({text:'继续',attachments:files});
});
