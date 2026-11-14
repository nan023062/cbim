/**
 * 作用定位：把主进程队列增量合并为稳定的消息数组，供轮询与操作后刷新共同使用。
 * 设计原因：无变化保留数组和条目身份，排序只移动对象；拒绝旧版本，避免异步响应回滚列表。
 */
import type {QueueCursor,QueueDelta,QueuedMessage} from '../../bridge/contracts/execution';
export class QueueProjection {
 cursor?:QueueCursor;
 items:QueuedMessage[]=[];
 /** 作用域由调用方按工作区/会话隔离；重启 epoch 改变时接收完整重置。 */
 apply(delta:QueueDelta){
  if(delta.epoch===this.cursor?.epoch&&delta.revision<=this.cursor.revision)return this.items;
  if(!delta.order)return this.items;
  const versions=delta.reset?{}:{...this.cursor?.items},byId=new Map((delta.reset?[]:this.items).map(x=>[x.id,x]));
  for(const change of delta.upserts??[]){byId.set(change.item.id,change.item);versions[change.item.id]=change.version}
  const next=delta.order.map(id=>{const item=byId.get(id);if(!item)throw Error('队列增量不完整，请重新打开会话');return item});
  this.cursor={epoch:delta.epoch,revision:delta.revision,items:Object.fromEntries(delta.order.map(id=>[id,versions[id]]))};
  if(next.length!==this.items.length||next.some((x,i)=>x!==this.items[i]))this.items=next;
  return this.items;
 }
}
