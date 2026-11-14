/**
 * 作用定位：维护当前窗口共享的全局准入快照，供设置与会话提示订阅。
 * 设计原因：只轮询内存游标，无变化保持对象引用；所有订阅共用单次在途读取，隐藏页面停止计时，迟到结果不能覆盖新订阅代际。
 * 订阅边界：前端 SubscriptionSet 只持有监听器；通知时机、状态、轮询及销毁仍由本控制器决定。
 * 失效边界：首订阅和末退订推进代次，读取只捕获；pending 合并和重新挂载后的补读仍归本类。
 */
import {AsyncGeneration,SubscriptionSet} from '../foundations/utility';
import {admissionReadSchema,type AdmissionCursor,type AdmissionSnapshot} from '../../bridge/contracts/admission';

export interface AdmissionFeedState {data?:AdmissionSnapshot;error:string}
/** 本投影不启动任务、不持有票据，也不把取数失败解释为零占用。 */
export class AdmissionFeed {
  private value:AdmissionFeedState={error:''};
  private listeners=new SubscriptionSet();
  private timer?:ReturnType<typeof setTimeout>;
  private readonly generation=new AsyncGeneration();
  private pending?:Promise<void>;
  constructor(private read:(cursor?:AdmissionCursor)=>Promise<unknown>,private intervalMs=1000){}
  get snapshot(){return this.value}
  private emit(){this.listeners.notify()}
  /** 首订阅触发读取；末订阅离开后停止，已确认数据保留但不可启动历史等待。 */
  subscribe(listener:()=>void){
    const unsubscribe=this.listeners.subscribe(listener);
    if(this.listeners.size===1){this.generation.advance();void this.refresh()}
    return ()=>{unsubscribe();if(!this.listeners.size){this.generation.advance();clearTimeout(this.timer)}};
  }
  /** 串行读取，不按固定间隔堆积请求；保存配额后也可调用，未订阅时不创建常驻轮询。 */
  refresh():Promise<void>{
    if(this.pending)return this.pending;
    clearTimeout(this.timer);const generation=this.generation.capture();
    const pending=(async()=>{
      try{
        const response=admissionReadSchema.parse(await this.read(this.value.data?.cursor));
        if(!this.generation.isCurrent(generation))return;
        if(response.kind==='snapshot'){
          const old=this.value.data?.cursor,next=response.snapshot.cursor;
          if(old?.streamId===next.streamId&&old.revision>next.revision)throw Error('运行配额版本倒退，请重新读取');
          if(!old||old.streamId!==next.streamId||old.revision!==next.revision||this.value.error){this.value={data:response.snapshot,error:''};this.emit()}
        }else{
          const old=this.value.data?.cursor;
          if(!old||old.streamId!==response.cursor.streamId||old.revision!==response.cursor.revision)throw Error('运行配额游标不一致，请重新读取');
          if(this.value.error){this.value={...this.value,error:''};this.emit()}
        }
      }catch(error){if(this.generation.isCurrent(generation)){const message=error instanceof Error?error.message:String(error);if(message!==this.value.error){this.value={...this.value,error:message};this.emit()}}}
    })();
    this.pending=pending;
    void pending.finally(()=>{
      if(this.pending===pending)this.pending=undefined;
      // 即使旧请求跨越重新挂载才返回，也为当前订阅重新读取；不发布旧代数据。
      if(this.listeners.size)this.timer=setTimeout(()=>void this.refresh(),this.generation.isCurrent(generation)?this.intervalMs:0);
    });return pending;
  }
}

/** 使用当前主会话身份过滤进程票据；同工作区的其它会话不会出现在此会话提示中。 */
export function sessionAdmission(data:AdmissionSnapshot|undefined,workspaceId:string,rootSessionId?:string){
  const matches=(item:{workspaceId:string;rootSessionId:string})=>item.workspaceId===workspaceId&&item.rootSessionId===rootSessionId;
  const waiting=rootSessionId?data?.waiting.filter(matches)??[]:[],occupied=rootSessionId?data?.occupied.filter(matches)??[]:[];
  return {waiting,occupied,waitingOnly:waiting.length>0&&!occupied.length,waitingSince:waiting.length?waiting.reduce((earliest,item)=>earliest<item.requestedAt?earliest:item.requestedAt,waiting[0].requestedAt):undefined};
}
