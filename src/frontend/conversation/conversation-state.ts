/**
 * 作用定位：把主模型运行、开放调度周期和普通消息队列转换为输入区操作状态。
 * 设计原因：持久等待保留目标与取消入口，但没有模型执行；排队不能冒充补充或人工验收。等待事实优先于另一轮询暂未追齐的 running 日志。
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
