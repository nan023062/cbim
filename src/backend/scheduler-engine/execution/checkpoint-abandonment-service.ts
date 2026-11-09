/**
 * 放弃核原完整运行链，只处置最新尚未领取的预约，不消耗历史已领取信封。
 * 作用定位：主调度明确放弃本周期尚未消费的检查点及可选恢复预约，保留旧执行与证明。
 * 设计原因：先查原回执，再在事务外核历史日志，最后仅作 Store CAS；处置不依赖当前知识、模型或文件仍可执行，避免反向锁和旧待办无法终止。
 * 职责边界：只取消原任务、递增租约并处理原恢复信封，不迁移负责人、不启动或回滚执行，也不确认业务完成。
 */
import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {z} from 'zod';
import {fail} from '../../core/foundation/errors';
import {hash,json} from '../../core/foundation/serialization';
import {contextualMainCommand} from './main-command-request';
import type {KnowledgeWorkspace} from '../../core/knowledge/ports';
import type {DispatchStore} from '../../core/tasks/dispatch-storage';
import type {GraphIdentity,TaskNode} from '../../core/tasks/graph-types';
import {abandonCheckpointInputSchema,type AbandonCheckpointInput,type AbandonCheckpointReceipt,type CheckpointAbandonment} from '../../core/tasks/checkpoint-handoff';
import {checkpointAbandonmentSelection} from '../../core/tasks/checkpoint-handoff-rules';
import {verifyMemberCheckpointHistory,type MemberCheckpointHistoryPorts} from './member-checkpoint-verifier';

// 与已有图及处置叶子的逻辑身份域一致；这里不是文件路径入口，不能额外缩窄历史身份。
const id=z.string().min(1).max(512).refine(value=>value.trim()===value&&!/[\x00-\x1f]/.test(value));
const contextSchema=z.object({workspaceId:id,rootSessionId:id,scopeId:id,mainRunId:id,commandId:id}).strict();

export class CheckpointAbandonmentService {
  constructor(private readonly owner:Pick<KnowledgeWorkspace,'entry'|'assert'>,private readonly store:DispatchStore,private readonly ports?:MemberCheckpointHistoryPorts){}
  private request(identity:GraphIdentity,scopeId:string,mainRunId:string,commandId:string,raw:AbandonCheckpointInput){
    const parsed=abandonCheckpointInputSchema.safeParse(raw),context=contextSchema.safeParse({...identity,scopeId,mainRunId,commandId});
    if(!parsed.success||!context.success)fail('CHECKPOINT_HANDOFF_INPUT','检查点放弃参数或主运行身份无效');
    const input=parsed.data,fixed=context.data,command=contextualMainCommand('member.checkpoint.abandon',fixed,input);
    return {input,fixed,command};
  }
  private async lookup(command:{commandId:string;fingerprint:string}):Promise<AbandonCheckpointReceipt|undefined>{
    const prior=await this.store.commandReceipt(command.commandId);
    if(prior){if(prior.fingerprint!==command.fingerprint)fail('COMMAND_ID_CONFLICT','相同命令 ID 已用于不同请求');return prior.receipt as AbandonCheckpointReceipt}
  }
  /** 只查原命令，供回包未知后的进程内撤票使用；不重新执行事务或要求当前来源仍有效。 */
  receipt(identity:GraphIdentity,scopeId:string,mainRunId:string,commandId:string,raw:AbandonCheckpointInput):Promise<AbandonCheckpointReceipt|undefined>{return this.lookup(this.request(identity,scopeId,mainRunId,commandId,raw).command)}
  /** 原命令先于生命周期和来源校验；新请求的所有等待后检查停止，提交后不反悔为“未发生”。 */
  async abandon(identity:GraphIdentity,scopeId:string,mainRunId:string,commandId:string,raw:AbandonCheckpointInput,assertCurrent:()=>void):Promise<AbandonCheckpointReceipt>{
    const {input,fixed,command}=this.request(identity,scopeId,mainRunId,commandId,raw),prior=await this.lookup(command);if(prior)return prior;
    const check=()=>{this.owner.assert();assertCurrent();if(fixed.workspaceId!==this.owner.entry.id)fail('GRAPH_IDENTITY_MISMATCH','检查点不属于当前工作区')};check();
    if(!this.ports)fail('CHECKPOINT_HANDOFF_UNAVAILABLE','未装配检查点历史核实端口');
    const observed=structuredClone(checkpointAbandonmentSelection(await this.store.read(),identity,scopeId,mainRunId,input));check();
    await verifyMemberCheckpointHistory(this.owner,observed.task,observed.run,this.ports,check,observed.runs);check();
    return this.store.transact(command,async state=>{
      check();const selected=checkpointAbandonmentSelection(state,identity,scopeId,mainRunId,input);
      // selector 不含原 checkpoint 结果信封，迟到的纯 ACK 不会冒充任务/运行变化，也不需要由本操作确认。
      if(!isDeepStrictEqual(selected,observed))fail('CHECKPOINT_HANDOFF_STALE','历史核实期间目标、任务、证明或原实例状态已经变化');
      const {graph,scope,task,member,run,checkpoint,resumeAssignment}=selected,now=new Date().toISOString();
      const abandonment:CheckpointAbandonment={kind:'abandoned_by_handoff',commandId,scopeId,mainRunId,graphCursor:{...input.expectedGraphCursor},goalRevision:scope.goal!.revision,previousTaskRevision:task.revision,planRevision:task.planRevision,checkpointId:checkpoint.checkpointId,sourceRunId:run.binding.runId,resumeRequestId:observed.currentRequest?.requestId??null,previousLeaseEpoch:member.leaseEpoch,nextLeaseEpoch:member.leaseEpoch+1,reason:input.reason,abandonedAt:now};
      const updated:TaskNode={...task,status:'cancelled',revision:task.revision+1,updatedAt:now,waitReason:input.reason,checkpointAbandonment:abandonment};
      const view=graph.agents.find(value=>value.agentInstanceId===member.agentInstanceId)!;
      const graphCursor={streamId:graph.cursor.streamId,seq:graph.cursor.seq+1};
      const receipt:AbandonCheckpointReceipt={...identity,scopeId,mainRunId,commandId,taskId:task.taskId,status:'cancelled',abandonment,graphCursor};
      check();return {members:[{...member,leaseEpoch:abandonment.nextLeaseEpoch}],...(resumeAssignment?{messages:[{...resumeAssignment,delivery:'processed' as const}]}:{}),batch:{version:1,identity:graph.identity,...graphCursor,eventId:randomUUID(),commandId,cause:'task.cancelled',committedAt:now,changes:[{type:'task.upserted',task:updated},{type:'agent.upserted',agent:{...view,revision:view.revision+1}}]},receipt};
    });
  }
}
