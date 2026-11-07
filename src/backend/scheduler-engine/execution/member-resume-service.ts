/**
 * 作用定位：当前主调度为本周期安全检查点预约一次原任务续执行，提交独立待领取信封。
 * 设计原因：主轮仍占执行资源时不能立刻启动成员；预约和真正领取分开，保留完整幂等审计，停止或重启不会自动重放。
 */
import {randomUUID} from 'node:crypto';
import {fail} from '../../core/foundation/errors';
import {hash,json} from '../../core/foundation/serialization';
import type {KnowledgeWorkspace} from '../../core/knowledge/ports';
import type {DispatchStore} from '../../core/tasks/dispatch-storage';
import type {GraphIdentity} from '../../core/tasks/graph-types';
import {resumeMemberInputSchema,type ResumeMemberInput,type ResumeMemberReceipt} from '../../core/tasks/queued-member-resume';
import {memberResumeSelection} from '../../core/tasks/queued-member-resume-rules';
import {memberBatch} from './member-state';
import {verifyMemberCheckpointProof,type MemberCheckpointVerificationPorts} from './member-checkpoint-verifier';

export class MemberResumeService {
  constructor(private readonly owner:KnowledgeWorkspace,private readonly store:DispatchStore,private readonly ports:MemberCheckpointVerificationPorts){}
  /** 同命令只返回已保存预约；新命令不复用旧回执冒领。assertCurrent覆盖所有异步核实至提交准备末端。 */
  async request(identity:GraphIdentity,scopeId:string,mainRunId:string,commandId:string,raw:ResumeMemberInput,assertCurrent:()=>void):Promise<ResumeMemberReceipt>{
    const parsed=resumeMemberInputSchema.safeParse(raw);if(!parsed.success)fail('MEMBER_RESUME_INPUT','续执行预约参数无效');
    const input=parsed.data,command={commandId,fingerprint:hash(json({operation:'member.resume.request',identity,scopeId,mainRunId,input}))};
    const check=()=>{this.owner.assert();assertCurrent();if(identity.workspaceId!==this.owner.entry.id)fail('GRAPH_IDENTITY_MISMATCH','检查点不属于当前工作区')};check();
    return this.store.transact(command,async state=>{
      check();const selected=memberResumeSelection(state,identity,scopeId,mainRunId,input),{graph,scope,task,run,checkpoint,trackedTaskIds}=selected;
      await verifyMemberCheckpointProof(this.owner,task,run,this.ports,check,run.checkpointProof);check();
      const requestId=randomUUID(),now=new Date().toISOString(),resumeFrom={checkpointId:checkpoint.checkpointId,runId:run.binding.runId};
      const resumeRequest={requestId,commandId,scopeId,mainRunId,...resumeFrom,requestedAt:now,reason:input.reason,graphCursor:{streamId:graph.cursor.streamId,seq:graph.cursor.seq},goalRevision:scope.goal!.revision,previousTaskRevision:task.revision,trackedTaskIds};
      const updated={...task,status:'queued' as const,revision:task.revision+1,updatedAt:now,waitReason:input.reason,resumeRequest};
      const batch=memberBatch(graph,commandId,'task.resume_requested',[{type:'task.upserted',task:updated}]);
      check();return {batch,messages:[{kind:'assignment' as const,messageId:requestId,commandId,identity:graph.identity,from:task.requester,to:task.assignee,taskId:task.taskId,planRevision:task.planRevision,createdAt:now,delivery:'pending' as const,resumeFrom}],receipt:{taskId:task.taskId,checkpointId:checkpoint.checkpointId,requestId,trackedTaskIds,cursor:{...identity,streamId:batch.streamId,seq:batch.seq}}};
    });
  }
}
