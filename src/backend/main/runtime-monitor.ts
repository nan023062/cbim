/**
 * 作用定位：把一个工作区的派发事务、运行日志和对话队列接入应用级运行监管。
 * 设计原因：全局管理器不读取磁盘或持有工作区锁；这里在工作区打开时恢复一次历史，后续仅订阅成功提交的事实。
 * 生命周期：回调绑定本次打开的 epoch，关闭先排空业务服务再撤销订阅；重启后的旧回调不能污染新实例。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import type {Workspace} from './workspace/workspace';
import {FileRunStorage} from './persistence/tasks/run-storage';
import {safeId} from '../core/foundation/identity';
import type {DispatchObserver} from '../core/tasks/dispatch-storage';
import type {WorkspaceDispatchService} from '../scheduler-engine/execution/dispatch-service';
import type {WorkspaceExecutionManager} from '../scheduler-engine/execution/execution-manager';
import type {GlobalRuntimeManager} from '../scheduler-engine/runtime/global-runtime';

/** 只保留稳定错误码，不将磁盘路径、工具输出和异常堆栈复制进全局监控。 */
function diagnostic(label:string,error:unknown){
  const code=(error as {code?:unknown})?.code;
  return label+(typeof code==='string'&&/^[A-Z_0-9]{1,60}$/.test(code)?`（${code}）`:'');
}

export class WorkspaceRuntimeMonitor {
  readonly epoch:number;
  readonly dispatchObserver:DispatchObserver;
  private unsubscribers:Array<()=>void>=[];
  constructor(private readonly global:GlobalRuntimeManager,private readonly workspaceId:string,name:string){
    this.epoch=global.begin(workspaceId,name);
    this.dispatchObserver={
      loaded:state=>global.restoreDispatch(workspaceId,this.epoch,state),
      committed:mutation=>global.dispatchCommitted(workspaceId,this.epoch,mutation),
      failed:error=>this.issue('dispatch','派发记录不可用，成员和任务统计可能不完整',error),
    };
  }
  /** 工作区本身无法运行；与部分历史文件损坏的监控降级分开。 */
  unavailable(error:unknown){this.global.unavailable(this.workspaceId,this.epoch,diagnostic('工作区无法打开，请查看工作区错误',error))}
  private issue(source:string,label:string,error:unknown){this.global.issue(this.workspaceId,this.epoch,source,diagnostic(label,error))}

  /** 先接实时订阅，再恢复历史；管理器按 run/seq 去重，初始化不启动模型。 */
  async initialize(workspace:Workspace,dispatch:WorkspaceDispatchService,execution:WorkspaceExecutionManager){
    const id=this.workspaceId,epoch=this.epoch;
    this.unsubscribers.push(execution.subscribe(event=>{
      try{this.global.runEvent(id,epoch,event)}catch(error){this.issue('run','运行事实无法更新，当前统计可能不完整',error)}
    }));
    this.unsubscribers.push(execution.observeQueue(counts=>this.global.queue(id,epoch,counts),error=>this.issue('queue','对话队列记录不可用，排队统计可能不完整',error)));
    await Promise.all([
      dispatch.initialize().catch(error=>this.issue('dispatch','派发记录不可用，成员和任务统计可能不完整',error)),
      this.restoreRuns(workspace).catch(error=>this.issue('runs','运行历史无法完整读取，用量统计可能不完整',error)),
      execution.initializeQueueMonitoring().catch(error=>this.issue('queue','对话队列记录不可用，排队统计可能不完整',error)),
    ]);
    this.global.ready(id,epoch);
  }

  private async restoreRuns(workspace:Workspace){
    const root=path.join(workspace.paths.project(this.workspaceId),'loop-engine','tasks'),storage=new FileRunStorage();
    // 使用 Dirent 只跟随应用自己的目录，不跟随符号链接或任意名字构造路径。
    let directories;
    try{directories=await fs.readdir(root,{withFileTypes:true})}catch(error:any){if(error.code==='ENOENT')return;throw error}
    for(const task of directories){
      if(!task.isDirectory()){this.issue('runs','运行历史含无法识别的条目，统计可能不完整',undefined);continue}
      try{
        const taskId=safeId(task.name),runs=await fs.readdir(path.join(root,taskId),{withFileTypes:true});
        for(const run of runs){
          try{
            if(!run.isDirectory())throw Error('invalid directory');
            const runId=safeId(run.name),summary=await storage.read(path.join(root,taskId,runId));
            if(summary.task.workspaceId!==this.workspaceId||summary.task.root!==workspace.entry.path||summary.task.taskId!==taskId||summary.runId!==runId)throw Error('identity mismatch');
            this.global.restoreRun(this.workspaceId,this.epoch,summary);
          }catch(error){this.issue(`run:${taskId}/${/^[\w-]+$/.test(run.name)?run.name:'unknown'}`,'运行记录不可读取或身份不匹配，用量统计可能不完整',error)}
        }
      }catch(error){this.issue('runs','任务历史目录无法读取，用量统计可能不完整',error)}
    }
  }

  /** 调用者先停止运行、排空日志和派发事务；最后一个完成事件仍会进入全局历史。 */
  close(){for(const unsubscribe of this.unsubscribers)unsubscribe();this.unsubscribers=[];this.global.detach(this.workspaceId,this.epoch)}
}
