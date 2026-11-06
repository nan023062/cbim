/**
 * 作用定位：主会话派发图的前端增量投影，核对身份和游标后原子合并完整提交。
 * 设计原因：轮询无变化时保留对象引用，断档时保留上一张可信图；不让半批节点或晚到的其他会话响应污染画面。
 */
import {applyGraphBatch,validateGraph} from '../../bridge/contracts/dispatch';
import type {GraphCursor,GraphDelta,GraphIdentity,GraphSnapshot} from '../../bridge/contracts/dispatch';

function sameCursor(a:GraphCursor,b:GraphCursor){return a.workspaceId===b.workspaceId&&a.rootSessionId===b.rootSessionId&&a.streamId===b.streamId&&a.seq===b.seq}
/** 仅接受本会话的完整响应；失败不会推进游标，下次由 Hook 请求权威快照恢复。 */
export class SessionGraphProjection {
  /** 仅持有本实例最后完整校验通过的快照；首次成功读取前缺省。 */
  private value?:GraphSnapshot;
  constructor(readonly identity:GraphIdentity){}
  get snapshot(){return this.value}
  get cursor(){return this.value?.cursor}
  /** 在组合响应中先验证候选；fork 共用不可变快照，不复制整张图，成功后调用方才替换投影。 */
  fork(){const next=new SessionGraphProjection(this.identity);next.value=this.value;return next}
  /** 整个响应校验成功后才替换投影；中途批次失败保持旧值，noop 保留原对象引用。 */
  apply(response:GraphDelta):GraphSnapshot {
    const cursor=response.cursor;
    if(cursor.workspaceId!==this.identity.workspaceId||cursor.rootSessionId!==this.identity.rootSessionId)throw Error('任务图响应属于其他会话');
    let next=this.value;
    if(response.mode==='reset'){
      validateGraph(response.snapshot);
      if(!sameCursor(response.snapshot.cursor,cursor))throw Error('任务图快照与游标不一致');
      if(next&&next.cursor.streamId===cursor.streamId&&cursor.seq<next.cursor.seq)throw Error('任务图快照版本回退，需要重新同步');
      if(next&&sameCursor(next.cursor,cursor)){
        if(JSON.stringify(next)!==JSON.stringify(response.snapshot))throw Error('相同任务图版本的内容不一致');
      }else next=response.snapshot;
    }else if(response.mode==='noop'){
      if(!next||!sameCursor(next.cursor,cursor))throw Error('任务图无变化响应与本地游标不一致');
    }else{
      if(!next||!sameCursor(next.cursor,response.from)||!response.batches.length)throw Error('任务图增量断档，需要重新同步');
      for(const batch of response.batches)next=applyGraphBatch(next,batch);
      if(!sameCursor(next.cursor,cursor))throw Error('任务图增量未到达响应游标');
    }
    this.value=next;
    return next;
  }
}
