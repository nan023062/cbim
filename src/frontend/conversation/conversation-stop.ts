/**
 * 作用定位：为会话停止操作提供独立于发送/插入锁的在途去重标记。
 * 设计原因：插入等待附件或原生回包时仍须能停止；标记按原工作区和会话归属，迟到完成不能清除另一个会话的停止状态。
 * 职责边界：只管理本组件的请求状态，不执行停止、不推断运行终态或自动重试。
 */
export interface ConversationStopTarget {id:string;taskId:string}
type StopToken=Readonly<ConversationStopTarget&{generation:number}>;
const key=(target:ConversationStopTarget)=>JSON.stringify([target.id,target.taskId]);

export class ConversationStopGate {
  private requests=new Map<string,StopToken>();
  private target='';
  private generation=0;
  /** 每次呈现核对会话，离开后再返回也属于新的视图代次。 */
  observe(target:ConversationStopTarget|undefined):void{const next=target?key(target):'';if(next!==this.target){this.target=next;this.generation++}}
  /** 同一会话只有一个在途停止；切换到其他会话仍可发出它自己的停止。 */
  begin(target:ConversationStopTarget):StopToken|undefined{const id=key(target);if(id!==this.target||this.requests.has(id))return;const token=Object.freeze({...target,generation:this.generation});this.requests.set(id,token);return token}
  pending(target:ConversationStopTarget):boolean{return this.requests.has(key(target))}
  /** 迟到回包仅可更新原视图代次的错误和刷新状态；请求本身仍按原身份结束。 */
  isCurrent(token:StopToken):boolean{return key(token)===this.target&&token.generation===this.generation}
  /** 仅消费原标记，不能用迟到的旧请求清除同身份下一次请求。 */
  finish(token:StopToken):boolean{const id=key(token);if(this.requests.get(id)!==token)return false;this.requests.delete(id);return true}
}
