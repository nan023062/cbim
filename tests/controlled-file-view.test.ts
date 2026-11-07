import {expect,it,vi} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {ControlledFileController,ControlledFilePool,checkedControlledFileReport,checkedFileCompensationReceipt,type ControlledFilePorts} from '../src/frontend/tasks/controlled-file-state';
import {ControlledFilePanel,MemberControlledFiles} from '../src/frontend/tasks/ControlledFilePanel';
import type {ControlledFileReportInput,ControlledFileReport,ControlledFileOperationSummary,FileCompensationInput,FileCompensationPreview,FileCompensationReceipt} from '../src/bridge/contracts/controlled-files';
import type {ExecutionReport} from '../src/bridge/contracts/dispatch';

const identity:ControlledFileReportInput={workspaceId:'workspace',rootSessionId:'root',taskId:'member-task',runId:'member-run',toolCallId:'controlled-call'};
const instanceId='11111111-1111-4111-8111-111111111111',command='22222222-2222-4222-8222-222222222222',time='2026-11-08T01:00:00.000Z',digest='a'.repeat(64),operationId='b'.repeat(64);
function source():ControlledFileOperationSummary{return {operationId,scopeId:'scope',binding:{workspaceId:identity.workspaceId,teamId:'team',agentId:'worker',agentInstanceId:'agent-instance',agentSessionId:'agent-session',rootSessionId:identity.rootSessionId,taskId:identity.taskId,runId:identity.runId,leaseEpoch:1,planRevision:1},toolCallId:identity.toolCallId,revision:3,phase:'applied',relativePath:'src/result.json',before:{byteLength:8,sha256:'c'.repeat(64)},intendedAfter:{byteLength:12,sha256:'d'.repeat(64)},preparedAt:time,updatedAt:time}}
function report():ControlledFileReport{return {version:1,identity:{...identity},checkedAt:time,ledger:{state:'recorded',operation:source(),originalExecution:'settled',compensationRevision:0,compensations:[]},readOnly:true,acceptance:'not_evaluated'}}
function preview():FileCompensationPreview{return {version:1,identity:{workspaceId:identity.workspaceId,instanceId,rootSessionId:identity.rootSessionId,operationId},checkedAt:time,eligible:true,basis:digest,operationRevision:3,compensationRevision:0,source:source(),observed:{state:'matches',fact:source().intendedAfter},restore:source().before,issues:[],limitations:['仅恢复文件默认数据流'],readOnly:true,acceptance:'not_evaluated'}}
function receipt(request:FileCompensationInput,phase:FileCompensationReceipt['phase']='applied'):FileCompensationReceipt{return {version:1,workspaceId:request.workspaceId,rootSessionId:request.rootSessionId,commandId:request.commandId,compensationId:'e'.repeat(64),operationId:request.operationId,request:structuredClone(request),actor:{kind:'local_desktop',interaction:'explicit_submit',instanceId:request.instanceId},revision:phase==='prepared'?1:phase==='executing'?2:3,phase,preparedAt:time,updatedAt:time,relativePath:source().relativePath,before:source().intendedAfter,after:source().before,acceptance:'not_evaluated'}}
function fixture(){const saved=new Map<string,string>();const ports:ControlledFilePorts={storage:{getItem:key=>saved.get(key)??null,setItem:(key,value)=>{saved.set(key,value)}},uuid:vi.fn(()=>command),report:vi.fn(async()=>report()),preview:vi.fn(async()=>preview()),apply:vi.fn(async input=>receipt(input)),receipt:vi.fn(async()=>undefined)};const controller=new ControlledFileController(identity.workspaceId,identity.rootSessionId,ports);controller.observeAnchor(identity,'v1');return {saved,ports,controller}}
async function ready(f:ReturnType<typeof fixture>){await f.controller.inspect(identity);await f.controller.preview(identity,instanceId);f.controller.edit(identity,'明确恢复本次写前字节');expect(f.controller.fresh(identity,instanceId)).toBe(true)}

it('挂载订阅重开零请求；显式报告只查一次，不据读取自动打开当前文件',async()=>{
 const f=fixture(),listener=vi.fn(),off=f.controller.subscribe(listener);expect(f.ports.report).not.toHaveBeenCalled();let resolve!:(v:unknown)=>void;
 vi.mocked(f.ports.report).mockImplementationOnce(()=>new Promise(done=>{resolve=done}));const first=f.controller.inspect(identity);await f.controller.inspect(identity);expect(f.ports.report).toHaveBeenCalledTimes(1);resolve(report());await first;
 expect(f.controller.read(identity)?.report?.ledger.state).toBe('recorded');expect(f.ports.preview).not.toHaveBeenCalled();expect(f.ports.apply).not.toHaveBeenCalled();off();new ControlledFileController(identity.workspaceId,identity.rootSessionId,f.ports);expect(f.ports.report).toHaveBeenCalledTimes(1);
});

it('跨来源、查无和倒退回包不能抹掉已核实原操作，读取失败保留旧报告',async()=>{
 const f=fixture();await ready(f);const old=f.controller.read(identity)?.report;
 const foreign=report();foreign.identity.runId='other';if(foreign.ledger.state==='recorded')foreign.ledger.operation.binding.runId='other';
 vi.mocked(f.ports.report).mockResolvedValueOnce(foreign);await f.controller.inspect(identity);expect(f.controller.read(identity)?.report).toBe(old);expect(f.controller.read(identity)?.error).toMatch(/所选调用/);
 const absent={...report(),ledger:{state:'absent',issues:[]}};expect(()=>checkedControlledFileReport(absent,identity,old)).toThrow(/保留/);
 const regressed=report();if(regressed.ledger.state==='recorded')Object.assign(regressed.ledger.operation,{phase:'executing',revision:2});expect(()=>checkedControlledFileReport(regressed,identity,old)).toThrow(/冲突/);
 expect(f.ports.apply).not.toHaveBeenCalled();
});

it('预览必须匹配当前实例和原摘要；图变化或迟到预览不取得提交资格',async()=>{
 const f=fixture();await f.controller.inspect(identity);
 vi.mocked(f.ports.preview).mockResolvedValueOnce({...preview(),identity:{...preview().identity,instanceId:command}});await f.controller.preview(identity,instanceId);expect(f.controller.read(identity)?.error).toMatch(/当前工作区实例/);
 let resolve!:(v:unknown)=>void;vi.mocked(f.ports.preview).mockImplementationOnce(()=>new Promise(done=>{resolve=done}));const waiting=f.controller.preview(identity,instanceId);f.controller.observeAnchor(identity,'v2');resolve(preview());await waiting;f.controller.edit(identity,'恢复');await f.controller.submit(identity,instanceId);expect(f.ports.apply).not.toHaveBeenCalled();expect(f.controller.fresh(identity,instanceId)).toBe(false);
 await f.controller.preview(identity,instanceId);expect(f.controller.fresh(identity,instanceId)).toBe(true);expect(f.controller.fresh(identity,command)).toBe(false);
});

it('请求在写端口之前可靠保存，双击不重复发送，成功原操作和补偿独立',async()=>{
 const f=fixture();await ready(f);let resolve!:(v:unknown)=>void,request!:FileCompensationInput;
 vi.mocked(f.ports.apply).mockImplementationOnce(input=>{request=input;const saved=JSON.parse(f.saved.get(f.controller.storageKey)!);expect(saved.attempts[0].request).toEqual(input);return new Promise(done=>{resolve=done})});
 const first=f.controller.submit(identity,instanceId);await f.controller.submit(identity,instanceId);expect(f.ports.apply).toHaveBeenCalledTimes(1);expect(f.controller.isPending(command)).toBe(true);
 resolve(receipt(request));await first;expect(f.controller.attempt(identity)).toMatchObject({state:'settled',receipt:{phase:'applied'}});expect(f.controller.read(identity)?.report).toEqual(report());expect(f.controller.fresh(identity,instanceId)).toBe(false);
 await f.controller.submit(identity,instanceId);expect(f.ports.apply).toHaveBeenCalledTimes(1);
});

it('提交后丢回复只持久未知；重开显式查询同命令不再发写，正文草稿独立',async()=>{
 const f=fixture();await ready(f);let committed!:FileCompensationReceipt;
 vi.mocked(f.ports.apply).mockImplementationOnce(async input=>{committed=receipt(input);throw Error('reply lost')});await f.controller.submit(identity,instanceId);expect(f.controller.attempt(identity)?.state).toBe('unknown');
 f.controller.edit(identity,'改参');expect(f.controller.draft(identity)?.reason).toBe('明确恢复本次写前字节');const reads=vi.mocked(f.ports.report).mock.calls.length;
 const reopened=new ControlledFileController(identity.workspaceId,identity.rootSessionId,f.ports);expect(reopened.attempt(identity)?.state).toBe('unknown');expect(f.ports.report).toHaveBeenCalledTimes(reads);expect(f.ports.apply).toHaveBeenCalledTimes(1);
 vi.mocked(f.ports.receipt).mockResolvedValueOnce(undefined);await reopened.query(identity,command);expect(reopened.attempt(identity)?.state).toBe('unknown');
 vi.mocked(f.ports.receipt).mockResolvedValueOnce(committed);await reopened.query(identity,command);expect(reopened.attempt(identity)?.receipt).toEqual(committed);await reopened.submit(identity,instanceId);expect(f.ports.apply).toHaveBeenCalledTimes(1);
 expect([...f.saved.keys()]).toEqual([f.controller.storageKey]);
});

it('回执可前进但终态不可改写；未知原命令不准备第二个ID',async()=>{
 const f=fixture();await ready(f);vi.mocked(f.ports.apply).mockImplementationOnce(async input=>receipt(input,'prepared'));await f.controller.submit(identity,instanceId);const request=f.controller.attempt(identity)!.request;
 vi.mocked(f.ports.receipt).mockResolvedValueOnce(receipt(request,'executing'));await f.controller.query(identity,command);expect(f.controller.attempt(identity)?.receipt?.phase).toBe('executing');
 vi.mocked(f.ports.receipt).mockResolvedValueOnce(receipt(request,'unknown'));await f.controller.query(identity,command);expect(f.controller.attempt(identity)?.receipt?.phase).toBe('unknown');
 f.controller.prepare(identity);expect(f.controller.draft(identity)?.commandId).toBe(command);
 vi.mocked(f.ports.receipt).mockResolvedValueOnce(receipt(request));await f.controller.query(identity,command);expect(f.controller.attempt(identity)?.receipt?.phase).toBe('unknown');expect(f.controller.read(identity)?.error).toMatch(/冲突/);
 expect(()=>checkedFileCompensationReceipt({...receipt(request),after:source().intendedAfter},request,source())).toThrow(/摘要不一致/);
});

it('明确未发写后才可重新预览准备新补偿；保留原命令记录',async()=>{
 const f=fixture();await ready(f);vi.mocked(f.ports.apply).mockImplementationOnce(async input=>receipt(input,'not_applied'));await f.controller.submit(identity,instanceId);f.controller.prepare(identity);
 expect(f.controller.draft(identity)?.commandId).toBeUndefined();expect(f.controller.snapshot.attempts).toHaveLength(1);expect(f.controller.fresh(identity,instanceId)).toBe(false);
 f.controller.edit(identity,'第二次明确补偿');await f.controller.preview(identity,instanceId);vi.mocked(f.ports.uuid).mockReturnValueOnce('33333333-3333-4333-8333-333333333333');await f.controller.submit(identity,instanceId);expect(f.ports.apply).toHaveBeenCalledTimes(2);expect(f.controller.snapshot.attempts.map(v=>v.receipt?.phase)).toEqual(['not_applied','applied']);
});

it('本机保存失败或损坏索引不发送补偿；仍可显式只读核实',async()=>{
 const f=fixture();await ready(f);vi.spyOn(f.ports.storage,'setItem').mockImplementationOnce(()=>{throw Error('quota')});await f.controller.submit(identity,instanceId);expect(f.ports.apply).not.toHaveBeenCalled();expect(f.controller.snapshot.error).toMatch(/未能保存/);
 f.saved.set(f.controller.storageKey,'{bad');const broken=new ControlledFileController(identity.workspaceId,identity.rootSessionId,f.ports);expect(broken.available).toBe(false);await broken.inspect(identity);expect(broken.read(identity)?.report?.ledger.state).toBe('recorded');await broken.submit(identity,instanceId);expect(f.ports.apply).not.toHaveBeenCalled();expect(f.saved.get(f.controller.storageKey)).toBe('{bad');
});

it('只识别首次提交的明确事务前拒绝码，重新预览才可发新命令；未知后的查询不能解除锁',async()=>{
 const f=fixture();await ready(f);vi.mocked(f.ports.apply).mockRejectedValueOnce(Error('FILE_COMPENSATION_PRE_ACCEPT_REJECTED: 文件已变化'));await f.controller.submit(identity,instanceId);
 expect(f.controller.attempt(identity)?.state).toBe('rejected');expect(f.controller.fresh(identity,instanceId)).toBe(false);await f.controller.submit(identity,instanceId);expect(f.ports.apply).toHaveBeenCalledTimes(1);
 vi.mocked(f.ports.receipt).mockRejectedValueOnce(Error('连接断开'));await f.controller.query(identity,command);expect(f.controller.attempt(identity)?.state).toBe('rejected');expect(f.controller.read(identity)?.error).toContain('连接断开');
 const reopened=new ControlledFileController(identity.workspaceId,identity.rootSessionId,f.ports);expect(reopened.attempt(identity)?.state).toBe('rejected');expect(f.ports.apply).toHaveBeenCalledTimes(1);
 f.controller.edit(identity,'再次核实后的补偿');expect(f.controller.draft(identity)?.commandId).toBeUndefined();await f.controller.preview(identity,instanceId);
 vi.mocked(f.ports.uuid).mockReturnValueOnce('33333333-3333-4333-8333-333333333333');vi.mocked(f.ports.apply).mockRejectedValueOnce(Error('连接已断开，FILE_COMPENSATION_PRE_ACCEPT_REJECTED: 未确认'));await f.controller.submit(identity,instanceId);
 expect(f.controller.snapshot.attempts.map(v=>v.state)).toEqual(['rejected','unknown']);const current=f.controller.attempt(identity)!.request.commandId;
 vi.mocked(f.ports.receipt).mockRejectedValueOnce(Error('FILE_COMPENSATION_PRE_ACCEPT_INPUT: 查询请求无效'));await f.controller.query(identity,current);expect(f.controller.attempt(identity)?.state).toBe('unknown');f.controller.edit(identity,'不应解除锁');expect(f.controller.draft(identity)?.reason).toBe('再次核实后的补偿');
});

it('文件漂移及原unknown不允许补偿，旧报告里的补偿历史只显式查询',async()=>{
 const f=fixture();await f.controller.inspect(identity);vi.mocked(f.ports.preview).mockResolvedValueOnce({...preview(),eligible:false,basis:undefined,observed:{state:'changed',fact:{byteLength:5,sha256:digest}}});await f.controller.preview(identity,instanceId);f.controller.edit(identity,'恢复');await f.controller.submit(identity,instanceId);expect(f.ports.apply).not.toHaveBeenCalled();
 const unknown=report();if(unknown.ledger.state==='recorded')unknown.ledger.operation.phase='unknown';const other=fixture();vi.mocked(other.ports.report).mockResolvedValueOnce(unknown);await other.controller.inspect(identity);await other.controller.preview(identity,instanceId);expect(other.ports.preview).not.toHaveBeenCalled();
});

it('原历史查询核对真实来源和命令，跨会话不能混入本机索引',async()=>{
 const f=fixture();await ready(f);await f.controller.submit(identity,instanceId);const request=f.controller.attempt(identity)!.request,saved=receipt(request);
 const history=report();if(history.ledger.state==='recorded'){history.ledger.compensationRevision=1;history.ledger.compensations=[{compensationId:saved.compensationId,commandId:command,phase:saved.phase,revision:saved.revision,preparedAt:time,updatedAt:time}]}
 const clean=fixture();vi.mocked(clean.ports.report).mockResolvedValueOnce(history);await clean.controller.inspect(identity);expect(clean.ports.receipt).not.toHaveBeenCalled();
 vi.mocked(clean.ports.receipt).mockResolvedValueOnce({...saved,operationId:'f'.repeat(64),request:{...request,operationId:'f'.repeat(64)}});await clean.controller.query(identity,command);expect(clean.controller.snapshot.attempts).toHaveLength(0);expect(clean.controller.read(identity)?.error).toMatch(/所选原命令/);
 vi.mocked(clean.ports.receipt).mockResolvedValueOnce({...saved,compensationId:'f'.repeat(64)});await clean.controller.query(identity,command);expect(clean.controller.snapshot.attempts).toHaveLength(0);expect(clean.controller.read(identity)?.error).toMatch(/已观察历史冲突/);
 vi.mocked(clean.ports.receipt).mockResolvedValueOnce({...saved,phase:'not_applied',revision:2});await clean.controller.query(identity,command);expect(clean.controller.snapshot.attempts).toHaveLength(0);expect(clean.controller.read(identity)?.error).toMatch(/已观察历史冲突/);
 vi.mocked(clean.ports.receipt).mockResolvedValueOnce(saved);await clean.controller.query(identity,command);expect(clean.controller.snapshot.attempts[0].receipt).toEqual(saved);expect(clean.ports.apply).not.toHaveBeenCalled();
 await clean.controller.query({...identity,rootSessionId:'foreign'},command);expect(clean.ports.receipt).toHaveBeenCalledTimes(4);
});

it('本机显式畸形receipt字段不被当成缺省拒绝记录而解锁',async()=>{
 const f=fixture();await ready(f);vi.mocked(f.ports.apply).mockRejectedValueOnce(Error('FILE_COMPENSATION_PRE_ACCEPT_INPUT: 无效'));await f.controller.submit(identity,instanceId);
 const saved=JSON.parse(f.saved.get(f.controller.storageKey)!);saved.attempts[0].receipt=false;f.saved.set(f.controller.storageKey,JSON.stringify(saved));const reopened=new ControlledFileController(identity.workspaceId,identity.rootSessionId,f.ports);
 expect(reopened.available).toBe(false);expect(reopened.snapshot.error).toMatch(/无法读取/);reopened.edit(identity,'不能覆盖损坏索引');expect(JSON.parse(f.saved.get(f.controller.storageKey)!).attempts[0].receipt).toBe(false);expect(f.ports.apply).toHaveBeenCalledTimes(1);
});

it('共享控制器只释放闲置项，组件挂载零调用且旧原生工具没有补偿入口',()=>{
 const f=fixture(),pool=new ControlledFilePool(1),a=pool.get('workspace','root',f.ports),off=a.subscribe(()=>{});pool.get('other','root',f.ports);expect(pool.get('workspace','root',f.ports)).toBe(a);off();
 const call=vi.fn();vi.stubGlobal('window',{cbim:{call},localStorage:f.ports.storage});try{
  const html=renderToStaticMarkup(createElement(ControlledFilePanel,{identity,instanceId,anchor:'v1',toolStatus:'failed'}));expect(html).toContain('原工具失败');expect(html).toContain('核实原文件操作');expect(html).not.toContain('确认恢复写前内容');expect(call).not.toHaveBeenCalled();
  const old={identity,tools:{items:[{toolName:'write',toolCallId:'old',status:'unknown'}]}} as unknown as ExecutionReport;
  expect(renderToStaticMarkup(createElement(MemberControlledFiles,{report:old,instanceId,anchor:'v1'}))).toBe('');expect(call).not.toHaveBeenCalled();
 }finally{vi.unstubAllGlobals()}
});
