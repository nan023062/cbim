/**
 * 作用定位：McpMonitor：维护健康、请求、错误、耗时及上下行统计快照。
 * 设计原因：健康检查与业务流量分开统计，避免心跳使空闲服务看起来持续工作。
 */
import type {McpStatus} from '../../../../bridge/contracts/workspace';

// HTTP body bytes only; heartbeat traffic is excluded. Rates use a rolling 5s window.
export class McpMonitor {
  private samples:{time:number;received:number;sent:number}[]=[];
  private value:McpStatus;
  constructor(instanceId:string,private now=()=>Date.now()){
    this.value={health:'starting',instanceId,startedAt:new Date(now()).toISOString(),requests:0,errors:0,inFlight:0,receivedBytes:0,sentBytes:0,receiveRate:0,sendRate:0};
  }
  start(){this.value.requests++;this.value.inFlight++;this.activity()}
  finish(failed:boolean){this.value.inFlight=Math.max(0,this.value.inFlight-1);if(failed)this.value.errors++;this.activity()}
  bytes(received:number,sent:number){
    this.value.receivedBytes+=received;this.value.sentBytes+=sent;const time=Math.floor(this.now()/1000)*1000;
    let bucket=this.samples.at(-1);if(!bucket||bucket.time!==time){bucket={time,received:0,sent:0};this.samples.push(bucket)}
    bucket.received+=received;bucket.sent+=sent;this.prune();this.activity();
  }
  private activity(){this.value.lastActivityAt=new Date(this.now()).toISOString()}
  private prune(){this.samples=this.samples.filter(s=>s.time>this.now()-5000)}
  checked(latencyMs:number,error?:string){this.value.checkedAt=new Date(this.now()).toISOString();this.value.latencyMs=latencyMs;this.value.error=error;this.value.health=error?'degraded':'online'}
  stopped(){this.value.health='stopped';this.value.inFlight=0}
  view():McpStatus {this.prune();return {...this.value,receiveRate:this.samples.reduce((sum,s)=>sum+s.received,0)/5,sendRate:this.samples.reduce((sum,s)=>sum+s.sent,0)/5}}
}
