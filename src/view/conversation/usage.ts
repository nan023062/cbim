/**
 * 作用定位：保留对话界面的用量统计入口，经桥接契约使用 Logic 执行规则的纯计量函数。
 * 设计原因：全局监管与界面共享计费口径；新原生上下文的当前占用必须取可信运行头，旧异常 running 记录不能继续增长工作时长或冒充当前上下文。
 */
import {taskUsage,runDuration} from '../../bridge/contracts/usage';
import type {RunSummary} from '../../bridge/contracts/execution';
export {taskUsage,runDuration};
export {tokenCount,durationText} from '../../bridge/contracts/usage';

/** undefined 保留旧消费者口径；null 明确没有可信运行头。旧运行只累加已报告费用/消耗，未闭合时长截至最后已知事件。 */
export function conversationUsage(runs:readonly RunSummary[],now:number,currentRun?:RunSummary|null){
  const data=taskUsage(runs,now);if(currentRun===undefined)return data;
  const head=taskUsage(currentRun?[currentRun]:[],now);
  const durationMs=runs.reduce((total,run)=>total+runDuration(run,run.status==='running'&&run.runId!==currentRun?.runId?Date.parse(run.events.at(-1)?.time??''):now),0);
  return {...data,durationMs,capacity:head.capacity,used:head.used,percent:head.percent};
}
