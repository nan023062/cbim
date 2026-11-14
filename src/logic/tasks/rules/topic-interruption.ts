/**
 * 作用定位：定义用户向指定话题提交补充的持久意图，供调度、记录和界面共用。
 * 设计原因：先保存原请求再停止参与者，停止与接收输入是两件事；状态由原等待/接续推导，不能用重试创建第二份指令。
 */
import {z} from 'zod';
import {goalContinuationRequestSchema} from './scope-continuation';

export const topicInterruptionRequestSchema=goalContinuationRequestSchema.omit({waitId:true,expectedGoalRevision:true}).strict();
export type TopicInterruptionRequest=z.infer<typeof topicInterruptionRequestSchema>;
export const topicInterruptionSchema=z.object({request:topicInterruptionRequestSchema,requestedAt:z.string().datetime()}).strict();
export type TopicInterruption=z.infer<typeof topicInterruptionSchema>;
/** 未消费意图占住原话题；不以请求已保存宣称进程退出，关闭后仍保留请求供核实。 */
export function pendingTopicInterruption(scope:{topicInterruptions?:readonly TopicInterruption[];continuations?:readonly {continuationId:string}[]}):TopicInterruption|undefined{
  const last=scope.topicInterruptions?.at(-1);
  return last&&!scope.continuations?.some(item=>item.continuationId===last.request.commandId)?last:undefined;
}
