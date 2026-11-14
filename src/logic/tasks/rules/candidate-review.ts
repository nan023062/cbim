/**
 * 作用定位：成员候选的主调度审阅协议与依赖放行谓词。
 * 设计原因：候选产生和主调度接受是不同事实；审阅绑定原结果与计划，不代替最终目标及人工验收。
 */
import {z} from 'zod';
const id=z.string().trim().min(1).max(512),revision=z.number().int().positive().safe();
export const candidateReviewInputSchema=z.object({taskId:id,expectedRevision:revision,resultId:id,decision:z.enum(['accept','reject']),reason:z.string().trim().min(1).max(16000)}).strict();
export type CandidateReviewInput=z.infer<typeof candidateReviewInputSchema>;
/** 一次不可改写的审阅；拒绝后须新任务产出新候选，不将旧拒绝翻为批准。 */
export const candidateReviewSchema=z.object({resultId:id,runId:id,planRevision:revision,mainRunId:id,decision:z.enum(['accept','reject']),reason:z.string().trim().min(1).max(16000),recordedAt:z.string().datetime()}).strict();
export type CandidateReview=z.infer<typeof candidateReviewSchema>;
/** 仅判断精确候选已接受；文件、岗位、目标及权限仍由领取服务核实。 */
export function candidateAccepted(task:{planRevision:number;result?:{resultId:string;runId:string;planRevision:number};candidateReview?:CandidateReview}):boolean{
  const r=task.result,a=task.candidateReview;
  return !!r&&a?.decision==='accept'&&a.resultId===r.resultId&&a.runId===r.runId&&a.planRevision===r.planRevision&&r.planRevision===task.planRevision;
}
