/**
 * 目录归属：backend/scheduler-engine/goals；目标状态与核证恢复服务。
 * 作用定位：主调度在单个派发事务中撤销明确的一组尚未启动任务。
 * 设计原因：领取与撤销共用存储锁；只有完整依赖后继集合可以取消，原任务、实例和信封一起保留审计，不发送 abort 或创建运行日志。
 */
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {fail} from '../../../core/errors';
import {hash,json} from '../../../core/platform/node/serialization';
import {contextualMainCommand} from './main-command-request';
import type {KnowledgeWorkspace} from '../../../logic/knowledge/rules/ports';
import type {DispatchStore} from '../../../logic/dispatch/rules/dispatch-storage';
import type {GraphIdentity,GraphChange,TaskNode} from '../../../logic/tasks/rules/graph-types';
import {cancelQueuedTasksInputSchema,type CancelQueuedTasksInput,type CancelQueuedTasksReceipt} from '../../../logic/tasks/rules/queued-task-cancel';
import {queuedCancellationSelection} from '../../../logic/tasks/rules/queued-task-cancel-rules';

const id=z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/);
const contextSchema=z.object({workspaceId:id,rootSessionId:id,scopeId:id,runId:id,commandId:id}).strict();
/** 只依赖当前工作区有效性与派发存储；不读取模型密钥、知识正文或运行工具。 */
export class QueuedTaskCancelService {
  constructor(private readonly owner:Pick<KnowledgeWorkspace,'entry'|'assert'>,private readonly store:DispatchStore){}
  /**
   * scope/run/command 来自主运行闭包；模型仅提供 targets、图游标及原因。同命令返回原回执，变参拒绝；校验失败不取消任何节点。
   * 实例仅转 idle，生命周期仍 active；旧审阅因图游标变化失效，业务完成仍需真实后续候选替代。
   */
  async cancel(identity:GraphIdentity,scopeId:string,runId:string,commandId:string,raw:CancelQueuedTasksInput):Promise<CancelQueuedTasksReceipt>{
    const parsed=cancelQueuedTasksInputSchema.safeParse(raw),context=contextSchema.safeParse({...identity,scopeId,runId,commandId});
    if(!parsed.success||!context.success)fail('CANCEL_INPUT_INVALID','撤销参数或主调度运行身份无效');
    const input=parsed.data,fixed=context.data;this.owner.assert();
    if(fixed.workspaceId!==this.owner.entry.id)fail('GRAPH_IDENTITY_MISMATCH','撤销目标不属于当前工作区');
    const command=contextualMainCommand('dispatch.cancelQueued',fixed,input);
    return this.store.transact(command,async state=>{
      this.owner.assert();const selected=queuedCancellationSelection(state,fixed,fixed.scopeId,input),{graph,tasks,assignments,members}=selected;
      const now=new Date().toISOString(),changes:GraphChange[]=[];
      for(const task of tasks){
        const updated:TaskNode={...task,revision:task.revision+1,status:'cancelled',updatedAt:now,waitReason:input.reason,cancelledBeforeStart:{commandId:fixed.commandId,scopeId:fixed.scopeId,mainRunId:fixed.runId,reason:input.reason,cancelledAt:now,previousRevision:task.revision,graphCursor:{...input.expectedGraphCursor}}};
        changes.push({type:'task.upserted',task:updated});
      }
      const idle=members.map(member=>({...member,activity:'idle' as const,waitingTaskIds:[],communicatingMessageIds:[]}));
      for(const member of idle){const view=graph.agents.find(item=>item.agentInstanceId===member.agentInstanceId)!;changes.push({type:'agent.upserted',agent:{...view,revision:view.revision+1,state:'idle',waitingTaskIds:[],runningTaskId:undefined}})}
      const graphCursor={streamId:graph.cursor.streamId,seq:graph.cursor.seq+1};
      return {members:idle,messages:assignments.map(message=>({...message,delivery:'processed' as const})),batch:{version:1,identity:graph.identity,...graphCursor,eventId:randomUUID(),commandId:fixed.commandId,cause:'task.cancelled',committedAt:now,changes},receipt:{workspaceId:fixed.workspaceId,rootSessionId:fixed.rootSessionId,scopeId:fixed.scopeId,mainRunId:fixed.runId,commandId:fixed.commandId,cancelledTaskIds:tasks.map(task=>task.taskId),graphCursor}};
    });
  }
}
