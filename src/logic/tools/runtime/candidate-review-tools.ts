/**
 * 作用定位：仅向主运行提供精确成员候选审阅入口。
 * 设计原因：批准依赖必须有持久记录，工具成功只代表审阅保存，不代表后继已运行或用户验收。
 */
import {zodToJsonSchema} from 'zod-to-json-schema';
import {candidateReviewInputSchema,type CandidateReviewInput} from '../../tasks/rules/candidate-review';
import {taskNodeSchema} from '../../tasks/rules/graph-rules';
import {checkedJsonToolResult} from '../rules/results';
import {fail} from '../../../core/errors';
import type {TaskNode} from '../../tasks/rules/graph-types';
import type {MainToolOutputBinding} from '../../tasks/rules/main-tool-output';
export class CandidateReviewTools {
  constructor(private binding:MainToolOutputBinding,private save:(input:CandidateReviewInput,callId:string,signal:AbortSignal)=>Promise<TaskNode>){}
  has(name:string){return name==='cbim_dispatch_review'}
  list(){return [{name:'cbim_dispatch_review',description:'主 Agent 核对成员交付的证据、限制及任务验收要求后，按 taskId/expectedRevision/resultId 保存 accept 或 reject 及理由。accept 只允许后继使用此候选，不代表最终目标完成或用户验收；reject 保留原候选，须明确取消/替换未启动后继并派发返工任务。成功后结束主轮，调度才继续；结果未知先用 cbim_dispatch_inspect 查该任务 candidateReview，不重发。',inputSchema:zodToJsonSchema(candidateReviewInputSchema) as Record<string,unknown>,outputSchema:zodToJsonSchema(taskNodeSchema) as Record<string,unknown>}];}
  describe(_name:string,input:unknown){candidateReviewInputSchema.parse(input);return {effects:['maintenance'] as const,native:false}}
  async call(name:string,input:unknown,signal:AbortSignal,id?:string){
    signal.throwIfAborted();if(!id)fail('DISPATCH_CALL_ID_REQUIRED','审阅缺少可信调用身份');
    const request=candidateReviewInputSchema.parse(input),parsed=taskNodeSchema.safeParse(await this.save(request,id,signal));
    if(!parsed.success)fail('TOOL_OUTPUT_INVALID','审阅回执无效，请查询原任务核实，不重复提交');
    const value=parsed.data;
    if(value.identity.workspaceId!==this.binding.workspaceId||value.identity.rootSessionId!==this.binding.rootSessionId||value.scopeId!==this.binding.scopeId||value.candidateReview?.mainRunId!==this.binding.runId||value.taskId!==request.taskId||value.revision!==request.expectedRevision+1||value.result?.resultId!==request.resultId||value.candidateReview.resultId!==request.resultId||value.candidateReview.decision!==request.decision||value.candidateReview.reason!==request.reason)fail('TOOL_OUTPUT_INVALID','审阅回执与请求或当前主运行不一致，请查询原任务核实，不重复提交');
    return checkedJsonToolResult(name,value,taskNodeSchema);
  }
}
