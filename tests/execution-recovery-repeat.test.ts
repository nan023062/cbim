import {it,expect,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {ExecutionRecoveryController,RECOVERY_SOURCE_HISTORY_LIMIT,RECOVERY_ROOT_HISTORY_LIMIT,RECOVERY_INDEX_BYTE_LIMIT,type RecoveryPorts,type RecoveryTarget,type RecoveryDraft,type RecoveryArchive} from '../src/frontend/tasks/recovery-state';
import type {RecoveryRequest,RecoveryReceipt} from '../src/bridge/contracts/dispatch';

const target={workspaceId:'workspace',rootSessionId:'root',source:{scopeId:'source',taskId:'task',runId:'old-run',reportBasis:'a'.repeat(64)}} satisfies RecoveryTarget,fields={observation:'已看到部分文件',message:'只读核实现状'},options={profileId:'11111111-1111-4111-8111-111111111111',provider:'fixture',model:'fixture',permission:'read' as const};
function request(source=target.source):RecoveryRequest{return {...target,source,commandId:randomUUID(),operation:'inspect_effects',observation:{text:fields.observation},input:{message:fields.message},options}}
function receipt(req:RecoveryRequest,status:RecoveryReceipt['scopeStatus']='closed'):RecoveryReceipt{if('kind' in req.source)throw Error('此夹具仅测试旧成员来源');return {workspaceId:req.workspaceId,rootSessionId:req.rootSessionId,scopeId:req.commandId,scopeStatus:status,recovery:{recoveryId:req.commandId,acceptedAt:'2026-11-07T00:00:00.000Z',source:{...req.source,taskRevision:3,planRevision:1,scopeOutcome:'failed',reportExecution:'unknown',logState:'invalid',unknownToolCount:1},operation:req.operation,observation:req.observation,input:req.input,options:req.options,runId:'run-'+req.commandId}}}
function archived(source=target.source):RecoveryArchive{const req=request(source);return {request:req,phase:'accepted',uncertain:false,receipt:receipt(req)}}
function fixture(records?:RecoveryDraft[],version=2){
  const saved=new Map<string,string>(),latest=new Map<string,RecoveryReceipt>(),setItem=vi.fn((key:string,value:string)=>{saved.set(key,value)}),ports:RecoveryPorts={storage:{getItem:key=>saved.get(key)??null,setItem},submit:vi.fn(async req=>{const value=receipt(req);latest.set(req.commandId,value);return value}),lookup:vi.fn(async query=>latest.get(query.commandId)),uuid:vi.fn(()=>randomUUID())};
  const storageKey='cbim.execution-recovery.v2.'+JSON.stringify(['workspace','root']),legacyStorageKey='cbim.execution-recovery.v1.'+JSON.stringify(['workspace','root']);
  if(records){const persisted=records.map(record=>{if('kind' in record.source)throw Error('此夹具仅测试旧成员来源');return {...record,source:{scopeId:record.source.scopeId,taskId:record.source.taskId,...(record.source.runId?{runId:record.source.runId}:{})}}});saved.set(version===1?legacyStorageKey:storageKey,JSON.stringify({version,workspaceId:'workspace',rootSessionId:'root',records:persisted}));for(const record of records)if(record.attempt?.receipt)latest.set(record.attempt.request.commandId,record.attempt.receipt)}
  const controller=new ExecutionRecoveryController('workspace','root',ports);return {controller,ports,saved,latest,setItem,storageKey,legacyStorageKey,send:vi.mocked(ports.submit),query:vi.mocked(ports.lookup),uuid:vi.mocked(ports.uuid)};
}
const draft=(attempt=archived(),history:RecoveryArchive[]=[]):RecoveryDraft=>({source:target.source,...fields,attempt,history});

it('再次核实先查询closed再持久归档，双击仅一次；新命令与新basis独立，重开保留原回执',async()=>{
  const old=archived(),f=fixture([draft(old)]);let resolve!:(value:unknown)=>void;f.query.mockImplementationOnce(()=>new Promise(done=>{resolve=done}));
  const pending=f.controller.prepareAgain(target.source,old.request.commandId);expect(await f.controller.prepareAgain(target.source,old.request.commandId)).toBe(false);expect(f.controller.isPending(f.controller.record(target.source))).toBe(true);expect(f.controller.record(target.source)?.attempt).toBeDefined();
  resolve(receipt(old.request));expect(await pending).toBe(true);expect(f.query).toHaveBeenCalledTimes(1);expect(f.send).not.toHaveBeenCalled();expect(f.uuid).not.toHaveBeenCalled();
  const record=f.controller.record(target.source)!;expect(record.attempt).toBeUndefined();expect(record.history).toEqual([{...old,error:undefined}]);expect(record.observation).toBe(fields.observation);expect(record.message).toBe(fields.message);
  const newTarget={...target,source:{...target.source,reportBasis:'b'.repeat(64)}};f.controller.edit(target.source,{...fields,message:'新一轮核实目标'});await f.controller.submit(newTarget,options);expect(f.send).toHaveBeenCalledTimes(1);expect(f.send.mock.calls[0][0].commandId).not.toBe(old.request.commandId);expect(f.send.mock.calls[0][0].source.reportBasis).toBe('b'.repeat(64));
  const reopened=new ExecutionRecoveryController('workspace','root',f.ports);expect(reopened.record(target.source)?.history?.[0].receipt).toEqual(old.receipt);expect(reopened.record(target.source)?.attempt?.phase).toBe('accepted');
});

it('归档保存失败不发布解锁，不丢请求/历史/其它来源；恢复存储后才能准备新草稿',async()=>{
  const old=archived(),other={source:{...target.source,taskId:'other'},observation:'other',message:'other'},f=fixture([draft(old),other]),before=f.saved.get(f.storageKey),notifications:Array<RecoveryDraft|undefined>=[];
  f.controller.subscribe(()=>notifications.push(f.controller.record(target.source)));f.setItem.mockImplementationOnce(()=>{throw Error('QuotaExceededError')});
  expect(await f.controller.prepareAgain(target.source,old.request.commandId)).toBe(false);expect(f.saved.get(f.storageKey)).toBe(before);expect(f.controller.record(target.source)?.attempt?.request.commandId).toBe(old.request.commandId);expect(notifications.every(record=>record?.attempt?.phase==='accepted')).toBe(true);expect(f.controller.record(other.source)).toMatchObject({observation:'other',message:'other',source:{scopeId:'source',taskId:'other',runId:'old-run'}});expect(f.controller.snapshot.error).toContain('未能保存');
  await f.controller.submit(target,options);expect(f.send).not.toHaveBeenCalled();expect(await f.controller.prepareAgain(target.source,old.request.commandId)).toBe(true);
});

it('服务已受理但回执保存失败时保留原命令；查询异常不解锁，恢复存储后只查询旧回执',async()=>{
  const f=fixture();f.controller.edit(target.source,fields);
  f.send.mockImplementationOnce(async req=>{const accepted=receipt(req);f.latest.set(req.commandId,accepted);f.setItem.mockImplementationOnce(()=>{throw Error('QuotaExceededError')});return accepted});
  await f.controller.submit(target,options);const attempt=f.controller.record(target.source)!.attempt!,commandId=attempt.request.commandId;
  expect(f.send).toHaveBeenCalledTimes(1);expect(attempt.phase).toBe('submitting');expect(f.controller.isPending(f.controller.record(target.source))).toBe(false);expect(f.controller.snapshot.error).toContain('未能保存');
  expect(JSON.parse(f.saved.get(f.storageKey)!).records[0].attempt.request.commandId).toBe(commandId);
  await f.controller.submit(target,options);expect(await f.controller.prepareAgain(target.source,commandId)).toBe(false);expect(f.send).toHaveBeenCalledTimes(1);expect(f.uuid).toHaveBeenCalledTimes(1);
  f.query.mockRejectedValueOnce(Error('connection lost'));await f.controller.query(target.source);expect(f.controller.record(target.source)?.attempt).toMatchObject({phase:'unknown',uncertain:true,request:{commandId}});
  expect(await f.controller.prepareAgain(target.source,commandId)).toBe(false);await f.controller.submit(target,options);expect(f.send).toHaveBeenCalledTimes(1);
  await f.controller.query(target.source);expect(f.controller.record(target.source)?.attempt).toMatchObject({phase:'accepted',request:{commandId},receipt:{scopeStatus:'closed'}});expect(f.send).toHaveBeenCalledTimes(1);
  expect(await f.controller.prepareAgain(target.source,commandId)).toBe(true);expect(f.controller.record(target.source)?.history?.[0].request.commandId).toBe(commandId);expect(f.uuid).toHaveBeenCalledTimes(1);
});

it('undefined、矛盾或回退的查询不解锁，active/waiting/unknown与错误命令也不能再次核实',async()=>{
  for(const makeResponse of [()=>undefined,()=>receipt(request()),(old:RecoveryArchive)=>({...old.receipt,scopeStatus:'active'}),()=>{throw Error('transport lost')}]){
    const old=archived(),f=fixture([draft(old)]);f.query.mockImplementationOnce(async()=>makeResponse(old));expect(await f.controller.prepareAgain(target.source,old.request.commandId)).toBe(false);expect(f.controller.record(target.source)?.attempt?.request.commandId).toBe(old.request.commandId);expect(f.controller.record(target.source)?.history).toEqual([]);
  }
  for(const status of ['active','waiting'] as const){const old=archived();old.receipt.scopeStatus=status;const f=fixture([draft(old)]);expect(await f.controller.prepareAgain(target.source,old.request.commandId)).toBe(false);expect(f.query).not.toHaveBeenCalled()}
  const old=archived(),unknown={...draft(old),attempt:{...old,phase:'unknown' as const,receipt:undefined}},f=fixture([unknown]);expect(await f.controller.prepareAgain(target.source,old.request.commandId)).toBe(false);expect(f.query).not.toHaveBeenCalled();await f.controller.submit(target,options);expect(f.send).not.toHaveBeenCalled();
  const accepted=fixture([draft(old)]);expect(await accepted.controller.prepareAgain(target.source,randomUUID())).toBe(false);expect(accepted.query).not.toHaveBeenCalled();
});

it('v1只读迁入v2并保留原字节；坏v2不回退，历史异源或重复命令使本机记录不可用',async()=>{
  const old=archived(),f=fixture([draft(old)],1),legacy=f.saved.get(f.legacyStorageKey);expect(f.controller.available).toBe(true);expect(f.saved.has(f.storageKey)).toBe(false);
  expect(await f.controller.prepareAgain(target.source,old.request.commandId)).toBe(true);expect(f.saved.get(f.legacyStorageKey)).toBe(legacy);expect(JSON.parse(f.saved.get(f.storageKey)!).version).toBe(2);
  f.saved.set(f.storageKey,'{broken');const broken=new ExecutionRecoveryController('workspace','root',f.ports);expect(broken.available).toBe(false);await broken.prepareAgain(target.source,old.request.commandId);expect(f.saved.get(f.storageKey)).toBe('{broken');expect(f.saved.get(f.legacyStorageKey)).toBe(legacy);
  for(const record of [draft(old,[old]),draft(old,[archived({...target.source,taskId:'foreign'})])])expect(fixture([record]).controller.available).toBe(false);
});

it('来源32条、主会话128条上限不淘汰历史，不解锁当前closed请求',async()=>{
  const old=archived(),history=Array.from({length:RECOVERY_SOURCE_HISTORY_LIMIT},()=>archived()),f=fixture([draft(old,history)]),before=f.saved.get(f.storageKey);
  expect(await f.controller.prepareAgain(target.source,old.request.commandId)).toBe(false);expect(f.saved.get(f.storageKey)).toBe(before);expect(f.controller.record(target.source)?.history).toHaveLength(32);expect(f.controller.record(target.source)?.attempt?.phase).toBe('accepted');
  const records:RecoveryDraft[]=Array.from({length:4},(_,index)=>{const source={...target.source,taskId:'archive-'+index};return {source,...fields,history:Array.from({length:RECOVERY_SOURCE_HISTORY_LIMIT},()=>archived(source))}});records.push(draft(old));
  expect(records.reduce((sum,record)=>sum+(record.history?.length??0),0)).toBe(RECOVERY_ROOT_HISTORY_LIMIT);const root=fixture(records),bytes=root.saved.get(root.storageKey);expect(await root.controller.prepareAgain(target.source,old.request.commandId)).toBe(false);expect(root.saved.get(root.storageKey)).toBe(bytes);expect(root.controller.snapshot.records).toHaveLength(5);
});

it('2MiB按UTF8字节限制保存；历史UUID不可重用，错误不会发起模型或清空已保存草稿',async()=>{
  const f=fixture(),large={observation:'字'.repeat(64000),message:'字'.repeat(64000)};for(let index=0;index<5;index++)f.controller.edit({...target.source,taskId:'task-'+index},large);
  const bytes=f.saved.get(f.storageKey)!;expect(new TextEncoder().encode(bytes).length).toBeLessThan(RECOVERY_INDEX_BYTE_LIMIT);f.controller.edit({...target.source,taskId:'overflow'},large);expect(f.saved.get(f.storageKey)).toBe(bytes);expect(f.controller.record({...target.source,taskId:'overflow'})).toBeUndefined();expect(f.controller.snapshot.error).toContain('2 MiB');expect(f.send).not.toHaveBeenCalled();
  const old=archived(),history=fixture([{source:target.source,...fields,history:[old]}]);history.uuid.mockReturnValue(old.request.commandId);await history.controller.submit(target,options);expect(history.send).not.toHaveBeenCalled();expect(history.controller.record(target.source)?.history).toEqual([old]);expect(history.controller.snapshot.error).toContain('重号');
});

it('发送前为尚未返回的回执预留空间，不能把可保存的pending变成永久无法保存accepted；有空间时回执可完整重开',async()=>{
  const large={observation:'核'.repeat(64000),message:'查'.repeat(64000)},candidate={observation:'o'.repeat(64000),message:'m'.repeat(1000)};
  const full=fixture();for(let index=0;index<5;index++)full.controller.edit({...target.source,taskId:'large-'+index},large);full.controller.edit(target.source,candidate);
  const before=full.saved.get(full.storageKey)!;expect(new TextEncoder().encode(before).length).toBeLessThan(RECOVERY_INDEX_BYTE_LIMIT);
  await full.controller.submit(target,options);expect(full.send).not.toHaveBeenCalled();expect(full.controller.record(target.source)?.attempt).toBeUndefined();expect(full.saved.get(full.storageKey)).toBe(before);expect(full.controller.snapshot.error).toContain('2 MiB');
  const roomy=fixture();for(let index=0;index<4;index++)roomy.controller.edit({...target.source,taskId:'large-'+index},large);roomy.controller.edit(target.source,candidate);await roomy.controller.submit(target,options);
  expect(roomy.send).toHaveBeenCalledTimes(1);expect(roomy.controller.record(target.source)?.attempt?.phase).toBe('accepted');expect(new TextEncoder().encode(roomy.saved.get(roomy.storageKey)!).length).toBeLessThan(RECOVERY_INDEX_BYTE_LIMIT);
  const reload=new ExecutionRecoveryController('workspace','root',roomy.ports);expect(reload.available).toBe(true);expect(reload.record(target.source)?.attempt?.receipt).toEqual(roomy.controller.record(target.source)?.attempt?.receipt);
});
