/**
 * 目录归属：logic/team/runtime；主运行与成员执行管理。
 * 作用定位：当前主调度为本周期最新安全检查点预约一次原任务续执行，逐段保留原预约和独立待领取信封。
 * 设计原因：主轮仍占执行资源时不能立刻启动成员；预约和真正领取分开，并各自在 Knowledge→模型→Store 顺序核原岗位。旧回执不重新解析来源，未确认补充阻止新预约，停止或重启不会自动重放。
 */
import {randomUUID} from 'node:crypto';
import {fail} from '../../../core/errors';
import {hash,json} from '../../../core/platform/node/serialization';
import {memberResumeCommand} from '../../tasks/runtime/main-command-request';
import type {KnowledgeWorkspace} from '../../knowledge/rules/ports';
import type {DispatchStore} from '../../dispatch/rules/dispatch-storage';
import type {GraphIdentity} from '../../tasks/rules/graph-types';
import {resumeMemberInputSchema,type ResumeMemberInput,type ResumeMemberReceipt} from '../../tasks/rules/queued-member-resume';
import {memberResumeSelection} from '../../tasks/rules/queued-member-resume-rules';
import {scopeHasUnresolvedActiveInput} from '../../tasks/rules/scope-active-input';
import {memberBatch} from './member-state';
import {verifyMemberCheckpointProof,type MemberCheckpointVerificationPorts} from './member-checkpoint-verifier';
import type {OwnerExecutionService} from '../../dispatch/runtime/owner-execution-service';
import {memberResumeRequests} from '../../tasks/rules/member-checkpoint-chain';

export class MemberResumeService {
  constructor(private readonly owner:KnowledgeWorkspace,private readonly store:DispatchStore,private readonly ports:MemberCheckpointVerificationPorts,private readonly owners?:OwnerExecutionService){}
  /** 同命令只返回已保存预约；新命令不复用旧回执冒领。assertCurrent覆盖所有异步核实至提交准备末端。 */
  async request(identity:GraphIdentity,scopeId:string,mainRunId:string,commandId:string,raw:ResumeMemberInput,assertCurrent:()=>void):Promise<ResumeMemberReceipt>{
    const parsed=resumeMemberInputSchema.safeParse(raw);if(!parsed.success)fail('MEMBER_RESUME_INPUT','续执行预约参数无效');
    const input=parsed.data,command=memberResumeCommand(identity,scopeId,mainRunId,commandId,input);
    if(!this.owners)fail('OWNER_EXECUTION_UNAVAILABLE','未装配岗位检查点核验');
    const old=await this.owners.replay<ResumeMemberReceipt>(command);if(old)return old.receipt;
    const check=()=>{this.owner.assert();assertCurrent();if(identity.workspaceId!==this.owner.entry.id)fail('GRAPH_IDENTITY_MISMATCH','检查点不属于当前工作区')};check();
    return this.owners.withContext(state=>this.owners!.selections([memberResumeSelection(state,identity,scopeId,mainRunId,input).task]),context=>this.store.transact(command,async state=>{
      check();const selected=memberResumeSelection(state,identity,scopeId,mainRunId,input),{graph,scope,task,run,checkpoint,trackedTaskIds}=selected;
      if(scopeHasUnresolvedActiveInput(scope))fail('GOAL_ACTIVE_INPUT_UNRESOLVED','运行中补充尚未核实，不能预约成员续执行');
      await this.owners!.verifyTask(state,context,task);check();
      await verifyMemberCheckpointProof(this.owner,task,run,this.ports,check,run.checkpointProof,state.runs);check();
      const requestId=randomUUID(),now=new Date().toISOString(),resumeFrom={checkpointId:checkpoint.checkpointId,runId:run.binding.runId};
      const resumeRequest={requestId,commandId,scopeId,mainRunId,...resumeFrom,requestedAt:now,reason:input.reason,graphCursor:{streamId:graph.cursor.streamId,seq:graph.cursor.seq},goalRevision:scope.goal!.revision,previousTaskRevision:task.revision,trackedTaskIds};
      const history=memberResumeRequests(task),updated={...task,status:'queued' as const,revision:task.revision+1,updatedAt:now,waitReason:input.reason,...(history.length?{resumeHistory:[...history]}:{}),resumeRequest};
      const batch=memberBatch(graph,commandId,'task.resume_requested',[{type:'task.upserted',task:updated}]);
      check();return {batch,messages:[{kind:'assignment' as const,messageId:requestId,commandId,identity:graph.identity,from:task.requester,to:task.assignee,taskId:task.taskId,planRevision:task.planRevision,createdAt:now,delivery:'pending' as const,resumeFrom}],receipt:{taskId:task.taskId,checkpointId:checkpoint.checkpointId,requestId,trackedTaskIds,cursor:{...identity,streamId:batch.streamId,seq:batch.seq}}};
    }),check);
  }
}
