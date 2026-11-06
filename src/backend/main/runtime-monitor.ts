/**
 * 作用定位：把工作区派发事务、两套运行日志和对话队列接入全局监管，同时维护静态 Agent 的持久化历史归档。
 * 设计原因：共用一次启动扫描；后续只有已提交事实进入监管与历史索引，历史页面分页不重复扫描正文。
 * 生命周期：先订阅，再结算中断成员并关闭遗留调度周期，最后恢复历史；不自动运行模型。回调绑定本次打开的 epoch，关闭先排空业务服务再撤销订阅。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import type {Workspace} from './workspace/workspace';
import {FileRunStorage} from './persistence/tasks/run-storage';
import {safeId} from '../core/foundation/identity';
import type {DispatchObserver} from '../core/tasks/dispatch-storage';
import type {WorkspaceDispatchService} from '../scheduler-engine/execution/dispatch-service';
import type {WorkspaceExecutionManager} from '../scheduler-engine/execution/execution-manager';
import type {MemberExecutionManager} from '../scheduler-engine/execution/member-execution';
import type {GlobalRuntimeManager} from '../scheduler-engine/runtime/global-runtime';
import type {AgentHistoryService} from '../scheduler-engine/runtime/agent-history';

/** 只保留稳定错误码，不将磁盘路径、工具输出和异常堆栈复制进全局监控。 */
function diagnostic(label:string,error:unknown){
  const code=(error as {code?:unknown})?.code;
  return label+(typeof code==='string'&&/^[A-Z_0-9]{1,60}$/.test(code)?`（${code}）`:'');
}

/** 一次工作区打开对应一个观察器；装配方先排空业务服务再关闭观察器，保证最后的运行事实仍被计入。 */
export class WorkspaceRuntimeMonitor {
  /** 全局监管的本次接入代际，区别重新打开的同名工作区；不是成员执行的 leaseEpoch。 */
  readonly epoch:number;
  readonly dispatchObserver:DispatchObserver;
  private unsubscribers:Array<()=>void>=[];
  constructor(private readonly global:GlobalRuntimeManager,private readonly workspaceId:string,name:string,private readonly history?:AgentHistoryService){
    this.epoch=global.begin(workspaceId,name);
    this.dispatchObserver={
      loaded:state=>{this.history?.restoreDispatch(state);global.restoreDispatch(workspaceId,this.epoch,state)},
      committed:mutation=>{this.history?.dispatchCommitted(mutation);global.dispatchCommitted(workspaceId,this.epoch,mutation)},
      failed:error=>this.issue('dispatch','派发记录不可用，成员和任务统计可能不完整',error),
    };
  }
  /** 工作区本身无法运行；与部分历史文件损坏的监控降级分开。 */
  unavailable(error:unknown){this.global.unavailable(this.workspaceId,this.epoch,diagnostic('工作区无法打开，请查看工作区错误',error))}
  private issue(source:string,label:string,error:unknown){this.global.issue(this.workspaceId,this.epoch,source,diagnostic(label,error))}
  /** 派生历史索引失败不回抛到执行链，查询页与全局监管均保留可见诊断。 */
  historyIssue(message:string){this.global.issue(this.workspaceId,this.epoch,'agent-history',message)}
  /** 自动协作暂停保留为可查询诊断，不把协调错误吞掉或伪装成任务已完成。 */
  collaborationIssue(rootSessionId:string,error:unknown){this.issue('collaboration:'+rootSessionId,'自动协作暂停，请核实主会话与成员任务后继续',error)}

  /**
   * 每次工作区装配调用一次：先接订阅，再恢复派发与两套历史，成员 initialize 只收口中断。
   * 各来源恢复失败记录为独立 issue，其他来源继续恢复；最终 ready 不表示统计一定完整。
   */
  async initialize(workspace:Workspace,dispatch:WorkspaceDispatchService,execution:WorkspaceExecutionManager,members?:MemberExecutionManager){
    const id=this.workspaceId,epoch=this.epoch;
    await this.history?.initialize();
    this.unsubscribers.push(execution.subscribe(event=>{
      this.history?.observeRun(event,'loop');
      try{this.global.runEvent(id,epoch,event)}catch(error){this.issue('run','运行事实无法更新，当前统计可能不完整',error)}
    }));
    if(members)this.unsubscribers.push(members.subscribe(event=>{
      this.history?.observeRun(event,'member');
      try{this.global.runEvent(id,epoch,event)}catch(error){this.issue('member-run','成员运行事实无法更新，当前统计可能不完整',error)}
    }));
    this.unsubscribers.push(execution.observeQueue(counts=>this.global.queue(id,epoch,counts),error=>this.issue('queue','对话队列记录不可用，排队统计可能不完整',error)));
    await dispatch.initialize().catch(error=>this.issue('dispatch','派发记录不可用，成员和任务统计可能不完整',error));
    // scope 关闭会释放执行实例，必须先把崩溃遗留的活动运行可靠结算，不能跳过 active run 校验。
    await members?.initialize().catch(error=>this.issue('member-runs','成员执行恢复未完成，统计可能不完整',error));
    await dispatch.recoverScopes().catch(error=>this.issue('dispatch-scopes','调度周期恢复未完成，执行实例可能仍占用',error));
    await Promise.all([
      this.restoreRuns(workspace).catch(error=>{this.history?.issue('runs','运行历史无法完整读取，Agent 历史可能不完整');this.issue('runs','运行历史无法完整读取，用量统计可能不完整',error)}),
      execution.initializeQueueMonitoring().catch(error=>this.issue('queue','对话队列记录不可用，排队统计可能不完整',error)),
    ]);
    await this.history?.flush();
    this.global.ready(id,epoch);
  }

  private async restoreRuns(workspace:Workspace){
    const project=workspace.paths.project(this.workspaceId);
    await Promise.all([
      this.restoreRunDirectory(workspace,path.join(project,'loop-engine','tasks'),'run'),
      this.restoreRunDirectory(workspace,path.join(project,'dispatch','runs','tasks'),'member-run'),
    ]);
  }

  /** 两套日志分别核对路径与成员绑定，避免把拷错目录的记录重复计入消费。 */
  private async restoreRunDirectory(workspace:Workspace,root:string,source:'run'|'member-run'){
    const storage=new FileRunStorage();
    // 使用 Dirent 只跟随应用自己的目录，不跟随符号链接或任意名字构造路径。
    let directories;
    try{directories=await fs.readdir(root,{withFileTypes:true})}catch(error:any){if(error.code==='ENOENT')return;throw error}
    for(const task of directories){
      if(!task.isDirectory()){this.history?.issue('runs','运行历史含无法识别的条目，Agent 历史可能不完整');this.issue('runs','运行历史含无法识别的条目，统计可能不完整',undefined);continue}
      try{
        const taskId=safeId(task.name),runs=await fs.readdir(path.join(root,taskId),{withFileTypes:true});
        for(const run of runs){
          try{
            if(!run.isDirectory())throw Error('invalid directory');
            const runId=safeId(run.name),summary=await storage.read(path.join(root,taskId,runId));
            if(summary.task.workspaceId!==this.workspaceId||summary.task.root!==workspace.entry.path||summary.task.taskId!==taskId||summary.runId!==runId)throw Error('identity mismatch');
            if((source==='member-run')!==!!summary.memberBinding)throw Error('run source mismatch');
            this.history?.restoreRun(summary,source==='member-run'?'member':'loop');
            this.global.restoreRun(this.workspaceId,this.epoch,summary);
          }catch(error){this.history?.issue(`${source}:${taskId}/${run.name}`,'部分运行记录不可读取或身份不匹配，Agent 历史可能不完整');this.issue(`${source}:${taskId}/${/^[\w-]+$/.test(run.name)?run.name:'unknown'}`,'运行记录不可读取或身份不匹配，用量统计可能不完整',error)}
        }
      }catch(error){this.history?.issue('runs','任务历史目录无法读取，Agent 历史可能不完整');this.issue('runs','任务历史目录无法读取，用量统计可能不完整',error)}
    }
  }

  /** 调用者先停止运行、排空日志和派发事务；最后一个完成事件仍会进入全局历史。 */
  close(){for(const unsubscribe of this.unsubscribers)unsubscribe();this.unsubscribers=[];this.global.detach(this.workspaceId,this.epoch)}
}
