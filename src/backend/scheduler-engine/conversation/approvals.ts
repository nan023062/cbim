/**
 * 作用定位：任务内操作确认及本次运行全部放行的生命周期。
 * 设计原因：从执行管理器拆离等待状态，结束和停止统一清理；不持久化授权，也不改变知识写权限。
 */
import {randomUUID} from 'node:crypto';
import {fail} from '../../core/foundation/errors';
import type {ChatApproval} from '../../core/policy/types';
import type {ToolCall,ToolDecision} from '../../core/tools/types';
export class ApprovalQueue {
 private approvedRuns=new Set<string>();
 /** 仅在当前运行中挂起调用；已获得本次放行时立即返回。 */
 async request(taskId:string,call:ToolCall):Promise<ToolDecision>{if(this.approvedRuns.has(taskId))return {allow:true,reason:'用户已允许本次运行的后续操作'};return new Promise(resolve=>{const id=randomUUID();this.approvals.set(id,{view:{id,taskId,name:call.name,input:call.input,createdAt:new Date().toISOString()},resolve})})}
  private approvals=new Map<string,{view:ChatApproval;resolve:(decision:ToolDecision)=>void}>();
  list(taskId:string){return [...this.approvals.values()].filter(a=>a.view.taskId===taskId).map(a=>a.view)}
  /** 审批身份绑定任务；单次答复只授权当前调用，本次全部通过仅放行同一任务当前运行中的待确认调用。 */
  answer(taskId:string,id:string,allow:boolean,allowAll=false){
    const pending=this.approvals.get(id);if(!pending||pending.view.taskId!==taskId)fail('APPROVAL_EXPIRED','审批已结束，请刷新对话');
    if(allowAll){if(allow!==true)fail('APPROVAL','全部通过必须由用户明确允许');this.approvedRuns.add(taskId);
      for(const [key,item] of this.approvals)if(item.view.taskId===taskId){this.approvals.delete(key);item.resolve({allow:true,reason:'用户已允许本次运行的后续操作'})}return;
    }
    if(this.approvals.get(id)!==pending)fail('APPROVAL_EXPIRED','审批已结束，请刷新对话');this.approvals.delete(id);pending.resolve({allow:allow===true,reason:allow?'用户允许本次调用':'用户拒绝本次调用'});
  }
  cancel(taskId?:string){if(taskId)this.approvedRuns.delete(taskId);else this.approvedRuns.clear();for(const [id,p] of this.approvals)if(!taskId||p.view.taskId===taskId){this.approvals.delete(id);p.resolve({allow:false,reason:'对话已停止'})}}
}
