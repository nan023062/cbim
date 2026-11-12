/**
 * 作用定位：从一次派发存储读取投影目标版本、可引用候选和撤销/等待清单。
 * 设计原因：预览复用提交规则，但绝不修改图、领取任务或把预检当执行许可；正式提交仍按原 CAS 核验。
 */
import {z} from 'zod';
import {fail,Fault} from '../foundation/errors';
import type {DispatchState} from '../dispatch/dispatch-storage';
import type {DispatchScope} from './dispatch-scope';
import type {GraphSnapshot} from './graph-types';
import {cancelQueuedTasksInputSchema,type CancelQueuedTasksInput} from './queued-task-cancel';
import {queuedCancellationSelection} from './queued-task-cancel-rules';
import {memberPauseSchema} from './member-pause';
import {memberPauseSelection} from './member-pause-rules';
import type {MainToolScope} from './main-tool-scope';

const cursor=z.object({streamId:z.string(),seq:z.number().int().nonnegative()}).strict();
/** 可提交清单只在完整规则通过时存在；issues 同时保留不能处理的原因。 */
export const coordinationPreviewSchema=z.object({
  status:z.literal('preview'),readOnly:z.literal(true),requiresConfirmation:z.literal(true),
  workspaceId:z.string(),rootSessionId:z.string(),scopeId:z.string(),graphCursor:cursor,
  goalRevision:z.number().int().positive().nullable(),
  affectedTaskIds:z.array(z.string()),retainedTaskIds:z.array(z.string()),
  issues:z.array(z.object({code:z.string(),message:z.string()}).strict()),
  cancel:cancelQueuedTasksInputSchema.optional(),memberPause:memberPauseSchema.optional(),
}).strict();
export type CoordinationPreview=z.infer<typeof coordinationPreviewSchema>;

/** 所有版本、候选都来自传入的同一 scope/graph；候选仍须经原日志与业务验收复核。 */
export function coordinationVersions(scope:MainToolScope,graph:GraphSnapshot){
  return {
    goalRevision:scope.goal?.revision??null,planRevision:scope.goal?.plan?.revision??null,
    graphCursor:{streamId:graph.cursor.streamId,seq:graph.cursor.seq},
    tasks:graph.tasks.map(task=>({taskId:task.taskId,scopeId:task.scopeId??null,revision:task.revision,planRevision:task.planRevision,status:task.status})),
    evidence:graph.tasks.filter(task=>task.scopeId===scope.scopeId&&task.result).map(task=>({
      kind:'member-result' as const,taskId:task.taskId,runId:task.result!.runId,resultId:task.result!.resultId,
      planRevision:task.result!.planRevision,toolCallIds:task.result!.evidenceRefs,
    })),
    evidenceNotice:'候选引用不是验收；toolCallIds 沿原交付保存，审阅仍核实真实工具、日志与当前文件。',
  };
}

/** includeClosure 只生成完整预览，不能隐式扩大一次写入的授权集合。 */
export function coordinationPreview(state:DispatchState,scope:DispatchScope,graph:GraphSnapshot,input?:CancelQueuedTasksInput):CoordinationPreview{
  const scoped=graph.tasks.filter(task=>task.scopeId===scope.scopeId);
  const result:CoordinationPreview={status:'preview',readOnly:true,requiresConfirmation:true,
    workspaceId:scope.workspaceId,rootSessionId:scope.rootSessionId,scopeId:scope.scopeId,
    graphCursor:{streamId:graph.cursor.streamId,seq:graph.cursor.seq},goalRevision:scope.goal?.revision??null,
    affectedTaskIds:[],retainedTaskIds:[],issues:[]};
  try{
    if(input){
      const nodes=new Set(input.targets.map(target=>{
        const task=scoped.find(task=>task.taskId===target.taskId);
        if(!task)fail('CANCEL_NOT_ALLOWED','撤销目标不属于本周期：'+target.taskId);
        if(task.revision!==target.expectedRevision)fail('CANCEL_TASK_STALE','任务版本已变化：'+target.taskId);
        return task.nodeId;
      })),queue=[...nodes];
      for(let i=0;i<queue.length;i++)for(const edge of graph.edges){
        if(edge.enabled&&edge.kind==='dependency'&&edge.fromNodeId===queue[i]&&!nodes.has(edge.toNodeId)){
          nodes.add(edge.toNodeId);queue.push(edge.toNodeId);
        }
      }
      const selected=graph.tasks.filter(task=>nodes.has(task.nodeId)&&task.status!=='cancelled');
      result.affectedTaskIds=selected.map(task=>task.taskId);
      result.retainedTaskIds=scoped.filter(task=>!result.affectedTaskIds.includes(task.taskId)).map(task=>task.taskId);
      const draft=cancelQueuedTasksInputSchema.parse({...input,targets:selected.map(task=>({taskId:task.taskId,expectedRevision:task.revision}))});
      queuedCancellationSelection(state,graph.identity,scope.scopeId,draft);
      result.cancel=draft;
    }else{
      const pending=scoped.filter(task=>['planned','queued','running','waiting','checkpointed'].includes(task.status)||!task.runIds.length&&task.status==='blocked');
      result.retainedTaskIds=pending.map(task=>task.taskId);
      const draft=memberPauseSchema.parse({version:1,expectedGraphCursor:result.graphCursor,tasks:pending.map(task=>({
        taskId:task.taskId,expectedRevision:task.revision,expectedPlanRevision:task.planRevision,
        ...(task.status==='checkpointed'?{kind:'checkpoint',checkpointId:task.checkpoints?.at(-1)?.checkpointId}:{kind:'unstarted'}),
      }))});
      memberPauseSelection(state,scope,draft);
      result.memberPause=draft;
    }
  }catch(error){
    result.issues.push({code:error instanceof Fault?error.code:'CLOSURE_UNAVAILABLE',message:error instanceof Fault?error.message:'当前集合不满足清单约束，请核实任务状态、数量及可靠检查点。'});
  }
  return coordinationPreviewSchema.parse(result);
}
