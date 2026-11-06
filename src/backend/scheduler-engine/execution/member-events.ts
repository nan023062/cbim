/**
 * 作用定位：将成员运行日志投影为可公开的连续事件流，并按 run 缓存首次恢复及后续已落盘增量。
 * 设计原因：节点详情高频轮询不能反复扫描日志；首次恢复失败可重试，成功后与实时事件合并去重。仅可信新运行尚未启动的空日志窗口可等待实时首条事件，已开始或损坏日志不能冒充空记录；公开投影排除原生绑定、冻结知识及工具正文。
 * 职责边界：不签发图状态、不启动或恢复执行；工具只公开身份、状态、工作区内业务路径与可信回执。公开对话和计划文本仅限长，不保证识别其中的敏感内容。
 */
import {fail} from '../../core/foundation/errors';
import type {RunSummary,StoredEvent,TaskSpec} from '../../core/brain/types';
import type {DispatchRun} from '../../core/tasks/dispatch-execution';
import type {TaskNode} from '../../core/tasks/graph-types';
import type {TaskProgress} from '../../core/tasks/progress';
import type {MemberEventCursor,MemberEventsRead,MemberRunView} from '../../core/tasks/member-events';
import {projectRunEvent} from './public-run-events';

/** 业务目标来自已派发节点；不传播完整角色/模块上下文或原生会话绑定。 */
export function memberPublicTask(task:TaskNode,root:string):TaskSpec{return {taskId:task.taskId,workspaceId:task.identity.workspaceId,root,goal:task.goal,moduleIds:task.modules.map(module=>module.moduleId),agentId:task.assignee.agentId,acceptance:task.acceptance.map(item=>item.text)}}

interface Stream {
  /** 首次登记时固定的身份与任务；read 使用传入的最新 DispatchRun 生成公开运行状态。 */
  run:DispatchRun;task:TaskSpec;
  /** 本实例已通过 begin 登记的新运行，不表示现在仍在执行；仅用于识别尚未创建首条日志的窗口。 */
  live:boolean;
  /** 首次恢复的共享承诺；成功后保留，失败时由 read 释放供后续请求重试。 */
  load?:Promise<void>;
  /** 实时观察发现的身份、序号或内容损坏；本实例后续查询持续失败，不能以重读清空掩盖。 */
  failure?:Error;
  /** 只缓存已脱敏事件；ordered 为连续前缀，pending 仅容纳恢复读与观察事件交错产生的暂存。 */
  ordered:StoredEvent[];pending:Map<number,StoredEvent>;unresolved:Set<string>;progress?:TaskProgress;
}
/** 工作区执行管理器拥有的脱敏事件缓存；不承担请求授权，调用方先核验图、任务、run 及游标身份。 */
export class MemberEventStreams {
  /** runId 在一个工作区内唯一；clear 随该工作区执行服务退役释放全部缓存。 */
  private streams=new Map<string,Stream>();
  constructor(private inspect:(run:DispatchRun)=>Promise<RunSummary>){}
  /** 在新执行开始前登记，允许其尚未创建日志时返回空前缀；历史日志损坏不能走该例外。 */
  begin(run:DispatchRun,task:TaskSpec){this.stream(run,task).live=true}
  private stream(run:DispatchRun,task:TaskSpec){
    let stream=this.streams.get(run.binding.runId);
    if(!stream){stream={run:structuredClone(run),task:structuredClone(task),live:false,ordered:[],pending:new Map(),unresolved:new Set()};this.streams.set(run.binding.runId,stream)}
    return stream;
  }
  /** 输入必须是日志成功落盘后的原事件；失败只污染查询流，不能改变真实执行或全局监控。 */
  append(run:DispatchRun,task:TaskSpec,event:StoredEvent){const stream=this.stream(run,task);try{this.accept(stream,event)}catch(error){stream.failure=error instanceof Error?error:Error('成员事件流无效')}}
  private accept(stream:Stream,event:StoredEvent){
    const binding=stream.run.binding;
    if(event.version!==1||event.workspaceId!==binding.workspaceId||event.taskId!==binding.taskId||event.runId!==binding.runId||!Number.isSafeInteger(event.seq)||event.seq<1)fail('MEMBER_EVENT_STREAM_INVALID','成员事件身份或序号无效');
    const value=projectRunEvent(event,stream.run.binding,stream.task),old=stream.ordered[event.seq-1]??stream.pending.get(event.seq);
    if(old){if(JSON.stringify(old)!==JSON.stringify(value))fail('MEMBER_EVENT_STREAM_INVALID','同一成员事件序号出现不同内容');return}
    stream.pending.set(event.seq,value);
    while(stream.pending.has(stream.ordered.length+1)){
      const next=stream.pending.get(stream.ordered.length+1)!;stream.pending.delete(next.seq);stream.ordered.push(next);
      if(next.type==='tool.allowed')stream.unresolved.add(String(next.data.id));
      if(next.type==='tool.finished'||next.type==='tool.denied')stream.unresolved.delete(String(next.data.id));
      if(next.type==='task.updated'&&next.data.progress)stream.progress=next.data.progress as TaskProgress;
    }
  }
  private async restore(stream:Stream,observed:DispatchRun){
    const initiallyEmpty=stream.ordered.length===0&&stream.pending.size===0;
    try{
      const summary=await this.inspect(stream.run),binding=stream.run.binding;
      if(summary.runId!==binding.runId||summary.task.workspaceId!==binding.workspaceId||summary.task.taskId!==binding.taskId||summary.task.agentId!==binding.agentId||summary.task.root!==stream.task.root||!summary.memberBinding||Object.entries(binding).some(([key,value])=>summary.memberBinding![key as keyof typeof binding]!==value))fail('MEMBER_EVENT_STREAM_INVALID','成员运行记录不属于请求身份');
      for(const event of summary.events)this.accept(stream,event);
      if(stream.pending.size)fail('MEMBER_EVENT_STREAM_INVALID','成员事件序号不连续，不能跳过缺失记录');
    }catch(error:any){
      // 新进程正在创建第一条记录，或启动失败发生在日志创建前；只允许空前缀等待已登记的实时观察。
      const beforeStart=!observed.startedAt&&!observed.session.sessionFile&&observed.status!=='completed';
      const unavailable=error?.code==='ENOENT'&&beforeStart||error?.code==='RUN_LOG_EMPTY'&&stream.live&&observed.status==='starting'&&beforeStart;
      if(unavailable&&initiallyEmpty)return;
      throw error;
    }
  }
  /**
   * 每个 run 首次成功恢复后只读内存；失败仅释放本次 load 供重试，已记录的流损坏不会被清除。
   * limit 按事件条数分页；缺省或超前游标重置到序号 0，返回副本，调用方不得跨 run 复用游标。
   */
  async read(run:DispatchRun,task:TaskSpec,cursor:MemberEventCursor|undefined,limit:number):Promise<MemberEventsRead>{
    const stream=this.stream(run,task);if(stream.failure)throw stream.failure;
    const loading=stream.load??=this.restore(stream,structuredClone(run));
    try{await loading}catch(error){if(stream.load===loading)stream.load=undefined;throw error}
    if(stream.failure)throw stream.failure;if(stream.pending.size)fail('MEMBER_EVENT_STREAM_INVALID','成员事件序号不连续，不能跳过缺失记录');
    const view:MemberRunView={task:stream.task,runId:run.binding.runId,status:run.status==='starting'?'running':run.status,acceptance:'not_evaluated',unresolvedTools:[...stream.unresolved],...(stream.progress?{taskProgress:stream.progress}:{})};
    const reset=!cursor||cursor.seq>stream.ordered.length,from=reset?0:cursor.seq;
    const events=stream.ordered.slice(from,from+limit),next={runId:run.binding.runId,seq:from+events.length};
    return structuredClone(!reset&&!events.length?{mode:'noop',run:view,cursor:next}:{mode:reset?'reset':'delta',run:view,cursor:next,events,hasMore:next.seq<stream.ordered.length});
  }
  /** 工作区退役后释放公开投影；权威日志仍由存储保留。 */
  clear(){this.streams.clear()}
}
