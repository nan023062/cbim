/**
 * 作用定位：把主模型运行、开放调度周期和普通消息队列转换为输入区操作状态。
 * 设计原因：普通发送始终是新任务，开放话题（包括持久等待）期间排队；补充必须走显式话题入口。等待事实优先于迟到 running 日志。
 */
import type {RunSummary} from '../../bridge/contracts/execution';
import type {ScopeSummary} from '../../bridge/contracts/dispatch';

/** openScope 来自当前会话的自动跟随状态，与用户正在浏览的历史周期无关；不执行或恢复任务。 */
export function conversationExecutionState(latest:Pick<RunSummary,'status'>|undefined,openScope?:ScopeSummary,queuedCount=0){
  const waiting=openScope?.status==='waiting';
  const mainRunning=latest?.status==='running'&&!waiting;
  const executing=!waiting&&(mainRunning||openScope?.status==='active');
  const taskOpen=mainRunning||!!openScope;
  return {waiting,mainRunning,executing,taskOpen,canInsert:mainRunning,canContinueQueue:!waiting,shouldQueue:taskOpen||queuedCount>0};
}
