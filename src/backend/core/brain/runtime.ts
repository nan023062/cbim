/**
 * 作用定位：大脑 执行层：LoopRuntime：任务租约、前置工具策略、运行终态与显式恢复。
 * 设计原因：先持久化工具决策再放行；主对话固定登记实例，续聊从原日志传递原生会话身份供引擎核实，避免同工作区误读其他历史。成员任务保持独立通道，回注来源单独保存，执行结束不等于验收。
 */
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {safeId} from '../foundation/identity';
import type {RunStorage} from './storage';
import {toolReceipt} from '../tools/receipts';
import {TaskProgressTools} from '../tasks/progress-tools';
import {checkedMemberRunLaunch,type MemberRunLaunch} from './member-run';
import {checkedRunInputSource,type RunInputSource} from './input-source';
import {checkedConversationAgentBinding,type ConversationAgentBinding} from './conversation-binding';
import type {AgentEngine,EngineEvent,RunSummary,StoredEvent,TaskSpec,ToolCall,ToolDecision} from './types';

/** 运行装配端口；可靠启动确认与只读事件观察分开，业务状态不能靠观察回调提交。 */
export interface RuntimeOptions {
  /** 应用注入的可靠存储；大脑不导入平台文件实现。 */
  storage:RunStorage;
  /** 本工作区的任务记录根目录，运行时按 taskId/runId 分层写入。 */
  directory:string;
  /** 由后端已登记主实例装配；只用于普通对话，不由模型或前端提供，不改写原生会话来源。 */
  conversationBinding?:ConversationAgentBinding;
  /** 返回覆盖完整运行生命周期的跨进程任务租约释放函数；拒绝时不创建运行日志或引擎。 */
  acquireLease(task:TaskSpec):Promise<()=>void>;
  /** 每轮创建独立引擎，并以已确定的任务/运行身份装配工具；不接受模型指定身份。 */
  createEngine(context:{task:TaskSpec;runId:string}):AgentEngine;
  /** 对当前调用返回可信授权；运行时先落盘决策再允许工具执行。 */
  toolPolicy(call:ToolCall):Promise<ToolDecision>;
  /** 引擎成功准备、模型生成前必须完成的可靠启动确认；失败中断本轮，不能由只读观察者代替。 */
  onEngineReady?(input:{taskId:string;runId:string;sessionFile?:string}):Promise<void>;
  /** 接收已落盘事件；异常被隔离，不能借此回调阻断运行或替代可靠提交。 */
  onEvent?(event:StoredEvent):void;
}
/** 管理任务级运行和日志；成员跨任务的互斥、通道复用及结果交接由外层调度负责。 */
export class LoopRuntime {
  /** taskId 为键；同任务在本运行时中只允许一个活动运行。 */
  private active=new Map<string,{runId:string;engine:AgentEngine;stop:()=>Promise<void>;done:Promise<RunSummary>}>();
  /** 绑定活动运行的持久化入口；插入回执保存在同一运行，关闭时一并清理。 */
  private injections=new Map<string,(message:string,images:import('./types').InputImage[])=>Promise<void>>();
  /** 关闭时先等待启动注册完成，防止启动/关闭竞争泄漏子进程。 */
  private starting=new Set<Promise<{runId:string;done:Promise<RunSummary>}>>();
  private closing=false;
  constructor(private options:RuntimeOptions){}
  /** 新建运行或显式恢复；可信 source 仅允许接续安全完成的主对话，返回句柄后仍需等待 done。 */
  async start(task:TaskSpec,message=task.goal,resume?:{runId:string;reconciledToolIds?:string[]},source?:RunInputSource):Promise<{runId:string;done:Promise<RunSummary>}>{
    if(this.closing)throw Error('Loop Engine 正在关闭');
    const pending=this.startInternal(task,message,resume,undefined,source);this.starting.add(pending);
    try{return await pending}finally{this.starting.delete(pending)}
  }
  /**
   * 启动已可靠领取的成员任务。只接收新业务 taskId；调用方负责成员互斥及前一通道运行的安全核实。
   * 本入口不绕过任务租约、工具门禁或日志，也不自动重试已存在任务。
   */
  async startMember(task:TaskSpec,message:string,launch:MemberRunLaunch):Promise<{runId:string;done:Promise<RunSummary>}>{
    if(this.closing)throw Error('Loop Engine 正在关闭');
    const prepared=checkedMemberRunLaunch(launch,task);
    const pending=this.startInternal(task,message,undefined,prepared);this.starting.add(pending);
    try{return await pending}finally{this.starting.delete(pending)}
  }
  private async startInternal(task:TaskSpec,message:string,resume?:{runId:string;reconciledToolIds?:string[]},member?:MemberRunLaunch,source?:RunInputSource):Promise<{runId:string;done:Promise<RunSummary>}>{
    task=structuredClone(task);
    const conversationBinding=this.options.conversationBinding===undefined?undefined:checkedConversationAgentBinding(this.options.conversationBinding,task);
    if(source){source=checkedRunInputSource(source);if(task.mode!=='chat'||!resume||member)throw Error('成员结果只能接续已有主对话');}
    safeId(task.taskId);safeId(task.workspaceId);
    if(!task.goal.trim()||!message.trim())throw Error('任务目标和执行消息不能为空');
    if(this.active.has(task.taskId))throw Error('任务正在执行');
    const release=await this.options.acquireLease(task);
    let previous:RunSummary|undefined;
    let nativeSessionId=member?.session.nativeSessionId;
    try{
      if(resume){
        previous=await this.inspect(task.taskId,resume.runId);
        if(source&&(previous.status!=='completed'||previous.unresolvedTools.length))throw Error('主对话上轮未安全完成，不能自动回注成员结果');
        if(previous.memberBinding)throw Error('成员任务不能通过普通对话恢复；请先由调度核实上次执行');
        // 已绑定历史不得改换或丢失登记身份；旧未绑定历史可在明确续聊时首次绑定，不重写旧记录。
        if(previous.conversationBinding&&(!conversationBinding||Object.entries(previous.conversationBinding).some(([key,value])=>conversationBinding[key as keyof ConversationAgentBinding]!==value)))throw Error('恢复必须使用原主对话实例与通道身份');
        if(previous.task.workspaceId!==task.workspaceId||previous.task.root!==task.root||JSON.stringify(previous.task)!==JSON.stringify(task))throw Error('恢复必须使用原任务定义与工作区');
        if(previous.unresolvedTools.some(id=>!resume.reconciledToolIds?.includes(id)))throw Error('存在结果未确认的工具操作，先核实产物再显式确认恢复');
        if(!previous.sessionFile)throw Error('缺少原生会话记录，不能伪装成恢复');
        // 文件位置与原生身份必须来自同一次可靠绑定；不能以逻辑 agentSessionId 或聊天 taskId 猜测旧原生 ID。
        const bound=[...previous.events].reverse().find(event=>event.type==='session.bound');
        if(bound?.data.sessionId!==undefined){
          if(typeof bound.data.sessionId!=='string'||bound.data.sessionFile!==previous.sessionFile)throw Error('原生会话身份记录与恢复文件不一致');
          nativeSessionId=safeId(bound.data.sessionId);
        }
        // 旧日志缺少原生 ID 时不补造；适配器决定是否支持无身份的历史，Pi 明确拒绝这种恢复。
      }else{
        await this.options.storage.reserveTask(this.options.directory,task.taskId); // 已存在任务只能经显式恢复入口继续。
      }
      const runId=member?.binding.runId??randomUUID(),directory=path.join(this.options.directory,safeId(task.taskId),runId);
      const journal=this.options.storage.createJournal(directory,task,runId);await journal.init();
      let boundSessionFile:string|undefined;
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
        if(event.type==='session.bound'&&typeof event.data.sessionFile==='string')boundSessionFile=event.data.sessionFile;
        if(event.type==='tool.finished'&&event.data.receipt)taskTools.record(event.data.receipt as import('../tools/types').ToolReceipt,calls.get(String(event.data.id))!.generation);
        if(event.type==='tool.allowed')pendingTools.add(String(event.data.id));
        if(event.type==='tool.finished')pendingTools.delete(String(event.data.id));
        if(event.type==='tool.denied')pendingTools.delete(String(event.data.id));
        try{void Promise.resolve(this.options.onEvent?.(saved)).catch(()=>{})}catch{/* observers cannot change durable execution */}
      };
      const engine=this.options.createEngine({task:structuredClone(task),runId});let stopping=false;
      this.injections.set(task.taskId,async(message,images)=>{
        if(stopping||!engine.steer)throw Error('当前执行不支持插入消息');
        await emit({type:'engine.status',data:{metric:'insertion',state:'requested',message,label:'正在插入用户补充'}});
        try{await engine.steer(message,images);await emit({type:'engine.status',data:{metric:'insertion',state:'accepted',message,label:'已插入，当前动作完成后处理'}})}
        catch(error){await emit({type:'engine.status',data:{metric:'insertion',state:'failed',message,label:'插入未确认，请核实后继续'}});throw error}
      });
      // 保存输入及可信来源，成员结果不能在恢复或界面投影中伪装成用户新指令。
      await emit({type:'run.started',data:{task,message,engine:engine.kind,resumeFrom:resume?.runId,reconciledToolIds:resume?.reconciledToolIds??[],...(conversationBinding?{conversationBinding}:{}),...(source?{source}:{}),...(member?{memberBinding:member.binding,nativeSessionId:member.session.nativeSessionId}:{})}});
      await taskTools.invalidate('新一轮执行需要重新核实产物与证据');
      const stop=async()=>{if(stopping)return;stopping=true;await emit({type:'run.stop_requested',data:{}});await engine.stop()};
      const done=(async()=>{
        let result:{status:'completed'|'cancelled'|'failed';error?:string}|undefined;
        let failure:unknown;
        try{
          await engine.start({task,runId,directory,sessionFile:member?.session.sessionFile??previous?.sessionFile,nativeSessionId,memberBinding:member?.binding,conversationBinding:conversationBinding?structuredClone(conversationBinding):undefined,source:source?structuredClone(source):undefined,taskTools,emit,beforeTool:async call=>{
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
          if(!stopping)await this.options.onEngineReady?.({taskId:task.taskId,runId,sessionFile:boundSessionFile});
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
  /** 读取指定轮次日志；本进程仍持有该轮次时将尚无终态的摘要呈现为 running，不触发恢复。 */
  async inspect(taskId:string,runId:string){
    const summary=await this.options.storage.read(path.join(this.options.directory,safeId(taskId),safeId(runId)));
    if(this.active.get(taskId)?.runId===runId&&summary.status==='interrupted')return {...summary,status:'running' as const};
    return summary;
  }
  /** 请求当前轮次停止；不存在活动运行时为空操作，最终状态仍须等待启动句柄的 done。 */
  async stop(taskId:string){await this.active.get(taskId)?.stop()}
  /** 只向当前活动运行注入；调用者负责按会话串行化，失败不得自动重放。 */
  async steer(taskId:string,message:string,images:import('./types').InputImage[]=[]){
    const inject=this.injections.get(taskId);if(!this.active.has(taskId)||!inject)throw Error('任务已结束，请继续队列');
    await inject(message,images);
  }
  /** 禁止新启动，等待在途注册后停止并收束活动运行；逐项失败不会阻止其余资源释放。 */
  async close(){this.closing=true;await Promise.allSettled([...this.starting]);const active=[...this.active.values()];await Promise.allSettled(active.map(x=>x.stop()));await Promise.allSettled(active.map(x=>x.done))}
}
