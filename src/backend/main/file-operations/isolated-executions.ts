/**
 * 目录归属：backend/main/file-operations；受控操作与原资源核实服务。
 * 作用定位：正式成员隔离记录的可信装配，以及原运行的桌面核实／显式清理服务。
 * 设计原因：临时 owner 或 PID 不能独立授予删除权；私有记录、原 canonical 授权及实际 Windows 对象共同核对。
 * 职责边界：报告不写记录，不启动模型；清理不改变旧任务状态，不恢复程序，也不对历史无记录调用补造事实。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {isDeepStrictEqual as equal} from 'node:util';
import {hash} from '../../../core/platform/node/serialization';
import {fail} from '../../../core/errors';
import type {DispatchStore} from '../../../logic/dispatch/rules/dispatch-storage';
import type {DispatchRun} from '../../../logic/tasks/rules/dispatch-execution';
import type {RunSummary} from '../../../logic/execution/rules/types';
import {preparedExecutionScope,type ExecutionScope} from '../../../logic/workspace/rules/execution-scope';
import {scopedNodeToolName} from '../../../logic/file-operations/rules/scoped-execution';
import {scopedExecutionAuthorizationSchema,isolatedExecutionRunSchema,isolatedExecutionReportSchema,isolatedExecutionCleanupSchema,isolatedExecutionCleanupReceiptSchema,type ScopedExecutionAuthorization,type IsolatedExecutionRun,type IsolatedExecutionItem} from '../../../logic/file-operations/rules/isolated-execution-recovery';
import {isolationOriginSchema,type IsolationLifecycle,type IsolationOrigin} from '../platform/isolation/isolation-record';
import {FileIsolationRecords,isolationOperationId,type IsolationHead,type IsolationChange} from '../platform/isolation/isolation-records';
import {Win32IsolationRecovery} from '../platform/isolation/isolation-recovery-win32';
import type {Workspace} from '../workspace/workspace';
import type {WorkspaceExecutionLease} from '../../../logic/execution/admission/workspace-lease';
const requireRuntime=createRequire(typeof __filename==='string'?__filename:import.meta.url);
const issue=(error:unknown)=>{const code=(error as {code?:unknown})?.code;return typeof code==='string'&&/^[A-Z0-9_]{1,100}$/.test(code)?code:'ISOLATION_UNVERIFIABLE'};
/** 每个已打开工作区唯一实例；由工作区锁保护跨进程写入，显式清理在本实例串行。 */
export class IsolatedExecutions {
  readonly records:FileIsolationRecords;private tail:Promise<void>=Promise.resolve();private closed=false;
  constructor(private readonly owner:Workspace,private readonly store:DispatchStore,private readonly lease:WorkspaceExecutionLease,private readonly inspect:(run:DispatchRun)=>Promise<RunSummary>,private readonly isCurrent:()=>boolean){this.records=new FileIsolationRecords(path.join(owner.paths.project(owner.entry.id),'isolated-executions'))}
  private assert(){this.owner.assert();if(this.closed||!this.isCurrent())fail('ISOLATION_UNAVAILABLE','工作区正在关闭，不能开始核实或清理')}
  private platform(){const host=process as NodeJS.Process&{resourcesPath?:string;defaultApp?:boolean};return new Win32IsolationRecovery(host.resourcesPath&&!host.defaultApp?path.join(host.resourcesPath,'koffi'):requireRuntime.resolve('koffi'))}
  private async run(identity:IsolatedExecutionRun){this.assert();if(identity.workspaceId!==this.owner.entry.id)fail('ISOLATION_IDENTITY','工作区身份不一致');const state=await this.store.read(),run=state.runs?.find(r=>r.binding.runId===identity.runId);if(!run||Object.entries(identity).some(([key,value])=>run.binding[key as keyof typeof run.binding]!==value))fail('ISOLATION_IDENTITY','没有所选原成员运行');const task=state.graphs.find(g=>g.identity.rootSessionId===identity.rootSessionId)?.tasks.find(t=>t.taskId===identity.taskId);if(!task)fail('ISOLATION_IDENTITY','原任务不存在');return {run,task}}
  private async source(run:DispatchRun,origin:IsolationOrigin,scopeId:string|undefined){
    if(!equal(run.binding,origin.binding)||origin.permission!==run.permission||origin.scopeId!==scopeId||hash(JSON.stringify(preparedExecutionScope(run.prepared.modules.map(m=>({contract:m.workflowContract})))))!==origin.scopeHash)fail('ISOLATION_ORIGIN','隔离来源与原冻结任务不一致');
    const summary=await this.inspect(run),allowed=summary.events.filter(e=>e.type==='tool.allowed'&&e.data.id===origin.toolCallId),proposed=summary.events.filter(e=>e.type==='tool.proposed'&&e.data.id===origin.toolCallId);
    if(!equal(summary.memberBinding,run.binding)||allowed.length!==1||proposed.length!==1||allowed[0].seq!==origin.allowedSeq||allowed[0].data.allow!==true||allowed[0].data.name!==scopedNodeToolName||proposed[0].data.name!==scopedNodeToolName||proposed[0].seq>=allowed[0].seq||hash(JSON.stringify(allowed[0].data.input))!==origin.inputHash||!equal(allowed[0].data.input,proposed[0].data.input)||summary.events.some(e=>e.type==='tool.denied'&&e.data.id===origin.toolCallId))fail('ISOLATION_ORIGIN','原隔离调用缺少唯一可靠授权');
  }
  /** 工厂冻结完整运行来源；每个工具调用各持一个生命周期对象，不能凭参数重用旧执行。 */
  forRun(run:DispatchRun,scopeId:string,scope:ExecutionScope){const saved=structuredClone(run),scopeHash=hash(JSON.stringify(scope));return async(raw:ScopedExecutionAuthorization):Promise<IsolationLifecycle>=>{
    this.assert();const authorization=scopedExecutionAuthorizationSchema.parse(raw),origin=isolationOriginSchema.parse({...authorization,workspaceInstanceId:this.owner.instanceId,scopeId,binding:saved.binding,scopeHash,permission:saved.permission}),operationId=isolationOperationId(saved.binding.runId,authorization.toolCallId);
    await this.source(saved,origin,scopeId);if(await this.records.read(saved.binding.runId,operationId))fail('ISOLATION_ALREADY_RECORDED','原调用已有隔离记录，不能重新执行');let head:IsolationHead|undefined;
    const append=async(change:IsolationChange)=>{head=await this.records.append(saved.binding.runId,operationId,change,head?.revision??0)};
    return {prepared:async(resource,requestHash)=>{this.assert();await append({kind:'prepared',record:{version:1,origin,resource,requestHash,createdAt:new Date().toISOString()}})},started:async process=>{this.assert();await append({kind:'started',process})},settled:()=>append({kind:'settled'}),cleaned:()=>append({kind:'cleaned'})};
  }}
  private async item(head:IsolationHead,run:DispatchRun,scopeId:string|undefined):Promise<IsolatedExecutionItem>{
    const {record,revision,phase}=head,resource=record.resource,issues:string[]=[];let host:IsolatedExecutionItem['host']='unknown',job:IsolatedExecutionItem['job']='not_observed',files:IsolatedExecutionItem['files']='unknown',verified=false;
    try{await this.source(run,record.origin,scopeId);verified=true}catch(error){issues.push(issue(error))}
    try{const platform=this.platform();host=platform.host(resource.host);if(['exited','reused'].includes(host))job=platform.job(resource);
      try{const identity=platform.directoryIdentity(resource.root);files=equal(identity,resource.rootIdentity)?'present':'changed';if(files==='present'&&phase!=='cleanup_requested'){const value=JSON.parse(await fs.readFile(path.join(resource.root,'owner.json'),'utf8'));if(value.executionId!==resource.executionId||value.profileName!==resource.profileName||value.pid!==resource.host.pid||value.nonce!==resource.nonce)files='changed'}}catch(error){const failure=error as {code?:string;win32Code?:number};files=failure.code==='ENOENT'||failure.code==='ISOLATION_RECOVERY_OPEN'&&[2,3].includes(failure.win32Code??0)?'absent':'unknown';if(files==='unknown')issues.push(issue(error))}
    }catch(error){issues.push(issue(error))}
    const cleared=['cleaned','cleanup_complete'].includes(phase),cleanupAllowed=verified&&!cleared&&['exited','reused'].includes(host)&&['empty','absent'].includes(job)&&['present','absent'].includes(files),state:IsolatedExecutionItem['state']=verified&&cleared&&files==='absent'?'cleaned':cleanupAllowed?'cleanup_available':verified&&host==='live'&&!cleared?'active':'unverifiable';
    if(state==='unverifiable'&&!issues.length)issues.push('原宿主、资源或记录未能共同核实；保留现场，不执行清理。');const prior=head.changes.find(c=>c.kind==='cleanup_requested');
    const facts={executionId:resource.executionId,toolCallId:record.origin.toolCallId,revision,phase,host,job,files,state,cleanupAllowed,...(prior?.kind==='cleanup_requested'?{cleanupCommandId:prior.commandId,cleanupBasis:prior.basis}:{}),issues};return {...facts,basis:hash(JSON.stringify([head.checksum,facts]))};
  }
  /** 显式查询只访问所选运行；没有新协议记录不能据此判定旧调用未执行。 */
  async report(raw:unknown){const identity=isolatedExecutionRunSchema.parse(raw),{run,task}=await this.run(identity),issues:string[]=[];let items:IsolatedExecutionItem[]=[];try{for(const {head}of await this.records.list(identity.runId))items.push(await this.item(head,run,task.scopeId))}catch(error){issues.push(issue(error))}return isolatedExecutionReportSchema.parse({identity,checkedAt:new Date().toISOString(),items,issues})}
  /** 已登记的清理只可按原 commandId 显式继续；每次重核原物理资源，不重发原业务程序。 */
  cleanup(raw:unknown){const input=isolatedExecutionCleanupSchema.parse(raw);const pending=this.tail.then(async()=>{
    this.owner.assert({workspaceId:input.workspaceId,instanceId:input.instanceId});const identity=isolatedExecutionRunSchema.parse({workspaceId:input.workspaceId,rootSessionId:input.rootSessionId,taskId:input.taskId,runId:input.runId}),{run,task}=await this.run(identity),entry=(await this.records.list(input.runId)).find(value=>value.head.record.resource.executionId===input.executionId);if(!entry)fail('ISOLATION_NOT_FOUND','没有该原执行的可靠资源记录');let {head}=entry;const last=head.changes.at(-1)!;
    if(last.kind==='cleanup_complete'){if(last.commandId!==input.commandId)fail('ISOLATION_CLEANUP_CONFLICT','原资源已由另一清理请求完成');return isolatedExecutionCleanupReceiptSchema.parse({executionId:input.executionId,commandId:input.commandId,state:'cleaned',revision:head.revision})}
    const report=await this.item(head,run,task.scopeId);if(!report.cleanupAllowed)fail('ISOLATION_CLEANUP_UNAVAILABLE','原资源尚未核实为可清理，请重新核实');
    if(last.kind==='cleanup_requested'){if(last.commandId!==input.commandId||last.basis!==input.basis)fail('ISOLATION_CLEANUP_CONFLICT','请查询并继续原清理请求')}else if(report.basis!==input.basis)fail('ISOLATION_CLEANUP_STALE','原报告已变化，请重新核实');
    const release=this.lease.acquire('isolation-cleanup:'+input.executionId,'execute');try{
      this.assert();this.owner.assert({workspaceId:input.workspaceId,instanceId:input.instanceId});const platform=this.platform(),resource=head.record.resource;await this.source(run,head.record.origin,task.scopeId);
      if(!['exited','reused'].includes(platform.host(resource.host))||!['empty','absent'].includes(platform.job(resource)))fail('ISOLATION_CLEANUP_UNAVAILABLE','原宿主或进程树尚未可靠退出');
      let tree:ReturnType<Win32IsolationRecovery['lockTree']>|undefined;try{tree=platform.lockTree(resource,last.kind!=='cleanup_requested')}catch(error){const failure=error as {code?:string;win32Code?:number};if(!(failure.code==='ISOLATION_RECOVERY_OPEN'&&[2,3].includes(failure.win32Code??0)&&report.files==='absent'))throw error}
      try{if(last.kind!=='cleanup_requested')head=await this.records.append(input.runId,entry.operationId,{kind:'cleanup_requested',commandId:input.commandId,basis:input.basis},head.revision);this.assert();platform.deleteProfile(resource);tree?.remove();head=await this.records.append(input.runId,entry.operationId,{kind:'cleanup_complete',commandId:input.commandId},head.revision)}finally{tree?.close()}
      return isolatedExecutionCleanupReceiptSchema.parse({executionId:input.executionId,commandId:input.commandId,state:'cleaned',revision:head.revision});
    }finally{release()}
  });this.tail=pending.then(()=>{},()=>{});return pending}
  /** 成员先完成原收尾，随后等待已受理的显式清理，最后才释放工作区锁。 */
  async close(){this.closed=true;await this.tail;await this.records.drain()}
}
