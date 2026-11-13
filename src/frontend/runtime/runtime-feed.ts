/**
 * 作用定位：维护窗口内只读监管游标、最近确认快照和增量发布，供运行管理页面订阅。
 * 设计原因：单次在途查询避免每秒堆积回读；noop 和未变化行保留引用，离页后的迟到结果不能污染新订阅。
 * 生命周期：最后一个订阅退出即停止轮询，已确认快照可保留；重开只读，不触发任务恢复。
 * 订阅边界：前端 SubscriptionSet 只持有监听器；通知时机、状态、轮询及销毁仍由本控制器决定。
 */
import {SubscriptionSet} from '../foundations/utility';
import {runtimeReadSchema,type RuntimeCursor,type RuntimeSnapshot} from '../../bridge/contracts/runtime';
import {runtimeTaskKey,runtimeRunKey} from './runtime-view-state';
export interface RuntimeFeedState {data?:RuntimeSnapshot;error:string}
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
function rows<T>(previous:T[],next:T[],key:(item:T)=>string){const old=new Map(previous.map(item=>[key(item),item]));const result=next.map(item=>{const cached=old.get(key(item));return cached&&same(cached,item)?cached:item});return previous.length===result.length&&result.every((item,index)=>item===previous[index])?previous:result}
/** 同一进程中只替换变化行；新 stream 完整换入，避免沿用前一进程的身份与状态。 */
export function reconcileRuntime(previous:RuntimeSnapshot|undefined,next:RuntimeSnapshot):RuntimeSnapshot{
  if(!previous||previous.cursor.streamId!==next.cursor.streamId)return next;
  return {...next,workspaces:rows(previous.workspaces,next.workspaces,x=>x.workspaceId),members:rows(previous.members,next.members,x=>x.workspaceId+':'+x.agentInstanceId),tasks:rows(previous.tasks,next.tasks,runtimeTaskKey),scopes:rows(previous.scopes,next.scopes,x=>x.workspaceId+':'+x.scopeId),runs:rows(previous.runs,next.runs,runtimeRunKey),pressure:same(previous.pressure,next.pressure)?previous.pressure:next.pressure,usage:same(previous.usage,next.usage)?previous.usage:next.usage};
}
/** 一份页面事实流；transport 校验失败保留旧数据并明确过期，不解释成零负载。 */
export class RuntimeFeed {
  private value:RuntimeFeedState={error:''};private listeners=new SubscriptionSet();private timer?:ReturnType<typeof setTimeout>;private generation=0;private pending?:Promise<void>;
  constructor(private readonly read:(cursor?:RuntimeCursor)=>Promise<unknown>,private readonly intervalMs=1000){}
  get snapshot(){return this.value}
  private emit(){this.listeners.notify()}
  subscribe(listener:()=>void){const unsubscribe=this.listeners.subscribe(listener);if(this.listeners.size===1){this.generation++;void this.refresh()}return()=>{unsubscribe();if(!this.listeners.size){this.generation++;clearTimeout(this.timer)}}}
  /** 在途读取复用，完成后再计时；手动刷新也不会发起并行请求。 */
  refresh():Promise<void>{
    if(this.pending)return this.pending;
    clearTimeout(this.timer);const generation=this.generation;
    const pending=(async()=>{try{
      const parsed=runtimeReadSchema.safeParse(await this.read(this.value.data?.cursor));
      if(generation!==this.generation)return;
      if(!parsed.success)throw Error('运行监管数据格式异常，请刷新核实');
      const response=parsed.data,old=this.value.data?.cursor,next=response.cursor;
      if(response.mode==='snapshot'){
        if(next.streamId!==response.snapshot.cursor.streamId||next.revision!==response.snapshot.cursor.revision)throw Error('运行监管快照游标不一致，请刷新核实');
        if(old?.streamId===next.streamId&&old.revision>next.revision)throw Error('运行监管版本倒退，请刷新核实');
        if(old?.streamId===next.streamId&&old.revision===next.revision&&!same(this.value.data,response.snapshot))throw Error('同一运行监管版本出现矛盾内容，请刷新核实');
        if(!old||old.streamId!==next.streamId||old.revision!==next.revision){this.value={data:reconcileRuntime(this.value.data,response.snapshot),error:''};this.emit()}
        else if(this.value.error){this.value={...this.value,error:''};this.emit()}
      }else{
        if(!old||old.streamId!==next.streamId||old.revision!==next.revision)throw Error('运行监管游标不一致，请刷新核实');
        if(this.value.error){this.value={...this.value,error:''};this.emit()}
      }
    }catch(error){if(generation===this.generation){const message=error instanceof Error?error.message:'运行监管读取失败，请刷新';if(message!==this.value.error){this.value={...this.value,error:message};this.emit()}}}})();
    this.pending=pending;void pending.finally(()=>{if(this.pending===pending)this.pending=undefined;if(this.listeners.size)this.timer=setTimeout(()=>void this.refresh(),generation===this.generation?this.intervalMs:0)});return pending;
  }
}
