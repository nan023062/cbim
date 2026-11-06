/**
 * 作用定位：大脑 执行层：LoopRuntime：任务租约、前置工具策略、运行终态与显式恢复。
 * 设计原因：先持久化工具决策再放行；任务计划修订与调用事实保存在同一日志，副作用和跨轮次恢复使旧证据失效，执行结束仍不等于验收。
 */
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {safeId} from '../foundation/identity';
import type {RunStorage} from './storage';
import {toolReceipt} from '../tools/receipts';
import {TaskProgressTools} from '../tasks/progress-tools';
import type {AgentEngine,EngineEvent,RunSummary,StoredEvent,TaskSpec,ToolCall,ToolDecision} from './types';

export interface RuntimeOptions {
  /** 应用注入的可靠存储；大脑不导入平台文件实现。 */
  storage:RunStorage;
  /** 本工作区的任务记录根目录，运行时按 taskId/runId 分层写入。 */
  directory:string;
  /** Caller owns a cross-process workspace/task lease for the full run lifetime. */
  acquireLease(task:TaskSpec):Promise<()=>void>;
  createEngine():AgentEngine;
  toolPolicy(call:ToolCall):Promise<ToolDecision>;
  onEvent?(event:StoredEvent):void;
}
export class LoopRuntime {
  /** taskId 为键；同任务在本运行时中只允许一个活动运行。 */
  private active=new Map<string,{runId:string;engine:AgentEngine;stop:()=>Promise<void>;done:Promise<RunSummary>}>();
  /** 绑定活动运行的持久化入口；插入回执保存在同一运行，关闭时一并清理。 */
  private injections=new Map<string,(message:string,images:import('./types').InputImage[])=>Promise<void>>();
  /** 关闭时先等待启动注册完成，防止启动/关闭竞争泄漏子进程。 */
  private starting=new Set<Promise<{runId:string;done:Promise<RunSummary>}>>();
  private closing=false;
  constructor(private options:RuntimeOptions){}
  /** 新建运行或显式恢复；返回的是运行句柄，须等待 done 才能获知执行结果。 */
  async start(task:TaskSpec,message=task.goal,resume?:{runId:string;reconciledToolIds?:string[]}):Promise<{runId:string;done:Promise<RunSummary>}>{
    if(this.closing)throw Error('Loop Engine 正在关闭');
    const pending=this.startInternal(task,message,resume);this.starting.add(pending);
    try{return await pending}finally{this.starting.delete(pending)}
  }
  private async startInternal(task:TaskSpec,message:string,resume?:{runId:string;reconciledToolIds?:string[]}):Promise<{runId:string;done:Promise<RunSummary>}>{
    task=structuredClone(task);
    safeId(task.taskId);safeId(task.workspaceId);
    if(!task.goal.trim()||!message.trim())throw Error('任务目标和执行消息不能为空');
    if(this.active.has(task.taskId))throw Error('任务正在执行');
    const release=await this.options.acquireLease(task);
    let previous:RunSummary|undefined;
    try{
      if(resume){
        previous=await this.inspect(task.taskId,resume.runId);
        if(previous.task.workspaceId!==task.workspaceId||previous.task.root!==task.root||JSON.stringify(previous.task)!==JSON.stringify(task))throw Error('恢复必须使用原任务定义与工作区');
        if(previous.unresolvedTools.some(id=>!resume.reconciledToolIds?.includes(id)))throw Error('存在结果未确认的工具操作，先核实产物再显式确认恢复');
        if(!previous.sessionFile)throw Error('缺少原生会话记录，不能伪装成恢复');
      }else{
        await this.options.storage.reserveTask(this.options.directory,task.taskId); // Existing tasks require explicit resume.
      }
      const runId=randomUUID(),directory=path.join(this.options.directory,safeId(task.taskId),runId);
      const journal=this.options.storage.createJournal(directory,task,runId);await journal.init();
      const pendingTools=new Set<string>();
      const calls=new Map<string,{call:ToolCall;decision:ToolDecision;generation:number}>();
      const identity={workspaceId:task.workspaceId,taskId:task.taskId,runId};
      const taskTools=new TaskProgressTools(previous?.taskProgress,async state=>{await emit({type:'task.updated',data:{progress:state}})});
      const emit=async(event:EngineEvent)=>{
        if(event.type==='tool.finished'){
          const known=calls.get(String(event.data.id));
          const {receipt:_untrustedReceipt,...data}=event.data;
          // 被拒绝调用也可能收到 Pi 的失败结束事件；不能覆盖为成功，也不接受无 gate 的伪造回执。
          if(known){
            if(data.name!==undefined&&data.name!==known.call.name)throw Error('工具结果名称与已授权调用不一致');
            event={...event,data:{...data,receipt:toolReceipt(identity,known.call,known.decision,!known.decision.allow?'denied':data.isError?'failed':'succeeded',data.result)}};
          }else event={...event,data};
        }
        const saved=await journal.append(event);
        if(event.type==='tool.finished'&&event.data.receipt)taskTools.record(event.data.receipt as import('../tools/types').ToolReceipt,calls.get(String(event.data.id))!.generation);
        if(event.type==='tool.allowed')pendingTools.add(String(event.data.id));
        if(event.type==='tool.finished')pendingTools.delete(String(event.data.id));
        if(event.type==='tool.denied')pendingTools.delete(String(event.data.id));
        try{void Promise.resolve(this.options.onEvent?.(saved)).catch(()=>{})}catch{/* observers cannot change durable execution */}
      };
      const engine=this.options.createEngine();let stopping=false;
      this.injections.set(task.taskId,async(message,images)=>{
        if(stopping||!engine.steer)throw Error('当前执行不支持插入消息');
        await emit({type:'engine.status',data:{metric:'insertion',state:'requested',message,label:'正在插入用户补充'}});
        try{await engine.steer(message,images);await emit({type:'engine.status',data:{metric:'insertion',state:'accepted',message,label:'已插入，当前动作完成后处理'}})}
        catch(error){await emit({type:'engine.status',data:{metric:'insertion',state:'failed',message,label:'插入未确认，请核实后继续'}});throw error}
      });
      // 保存本轮用户消息，恢复后对话仍能区分最初目标和后续指令。
      await emit({type:'run.started',data:{task,message,engine:engine.kind,resumeFrom:resume?.runId,reconciledToolIds:resume?.reconciledToolIds??[]}});
      await taskTools.invalidate('新一轮执行需要重新核实产物与证据');
      const stop=async()=>{if(stopping)return;stopping=true;await emit({type:'run.stop_requested',data:{}});await engine.stop()};
      const done=(async()=>{
        let result:{status:'completed'|'cancelled'|'failed';error?:string}|undefined;
        let failure:unknown;
        try{
          await engine.start({task,runId,directory,sessionFile:previous?.sessionFile,taskTools,emit,beforeTool:async call=>{
            call=structuredClone(call);
            if(calls.has(call.id))return {allow:false,reason:'同一运行不能重复使用工具调用 ID'};
            calls.set(call.id,{call,decision:{allow:false},generation:taskTools.generation});
            await emit({type:'tool.proposed',data:{...call}});
            let decision=stopping?{allow:false,reason:'任务正在停止'}:await this.options.toolPolicy(structuredClone(call));
            if(stopping)decision={...decision,allow:false,reason:'任务正在停止'};
            if(decision.allow&&(decision.effects?.some(effect=>['business-write','knowledge-write','command'].includes(effect))||['write','edit','bash'].includes(call.name)))await taskTools.invalidate('即将执行可能改变产物的操作，需要重新验证');
            calls.set(call.id,{call,decision,generation:taskTools.generation});
            await emit({type:decision.allow?'tool.allowed':'tool.denied',data:{...call,...decision,...(!decision.allow?{receipt:toolReceipt(identity,call,decision,'denied')}: {})}});
            if(stopping&&decision.allow){
              decision={...decision,allow:false,reason:'任务正在停止'};calls.set(call.id,{call,decision,generation:taskTools.generation});
              await emit({type:'tool.denied',data:{...call,...decision,receipt:toolReceipt(identity,call,decision,'denied')}});
            }
            return decision;
          }});
          result=stopping?{status:'cancelled' as const}:await engine.run(message);
        }catch(error){
          failure=error;
        }finally{
          try{await engine.close()}catch(error){failure??=error}
          try{
            if(failure||pendingTools.size)await emit({type:'run.interrupted',data:{error:failure instanceof Error?failure.message:String(failure||'工具结果未确认'),unresolvedTools:[...pendingTools],receipts:[...pendingTools].map(id=>{const item=calls.get(id)!;return toolReceipt(identity,item.call,item.decision,'unknown')})}});
            else await emit({type:'run.settled',data:{...result,acceptance:'not_evaluated'}});
            await journal.flush();
          }finally{this.active.delete(task.taskId);this.injections.delete(task.taskId);release()}
        }
        return this.options.storage.read(directory);
      })();
      this.active.set(task.taskId,{runId,engine,stop,done});void done.catch(()=>{});
      return {runId,done};
    }catch(error){this.injections.delete(task.taskId);release();throw error}
  }
  async inspect(taskId:string,runId:string){
    const summary=await this.options.storage.read(path.join(this.options.directory,safeId(taskId),safeId(runId)));
    if(this.active.get(taskId)?.runId===runId&&summary.status==='interrupted')return {...summary,status:'running' as const};
    return summary;
  }
  async stop(taskId:string){await this.active.get(taskId)?.stop()}
  /** 只向当前活动运行注入；调用者负责按会话串行化，失败不得自动重放。 */
  async steer(taskId:string,message:string,images:import('./types').InputImage[]=[]){
    const inject=this.injections.get(taskId);if(!this.active.has(taskId)||!inject)throw Error('任务已结束，请继续队列');
    await inject(message,images);
  }
  async close(){this.closing=true;await Promise.allSettled([...this.starting]);const active=[...this.active.values()];await Promise.allSettled(active.map(x=>x.stop()));await Promise.allSettled(active.map(x=>x.done))}
}
