/**
 * 作用定位：为选中成员任务装配只读核实控制器，将图/周期变化投影为报告过期提示。
 * 设计原因：挂载、页签显示和轮询都不触发核实；不同节点或轮次独立控制器。提供稳定的 invalidate 回调，在新草稿准备后清旧报告且忽略其迟到结果，不自动请求后端。
 */
import {useCallback,useEffect,useMemo,useSyncExternalStore} from 'react';
import type {GraphCursor,ScopeSummary,TaskNode} from '../../bridge/contracts/dispatch';
import {ExecutionReportController,executionReportKey,executionReportStale,type ExecutionReportSelection} from './execution-report-state';

/** 只在调用 inspect/more 时访问只读 IPC；没有恢复、确认操作或自动刷新。 */
export function useExecutionReport(identity:ExecutionReportSelection,task:TaskNode,graphCursor?:GraphCursor,scope?:ScopeSummary){
  const key=executionReportKey(identity);
  const controller=useMemo(()=>new ExecutionReportController(identity,request=>window.cbim.call('dispatch.executionReport',request)),[key]);
  const state=useSyncExternalStore(controller.subscribe,()=>controller.snapshot,()=>controller.snapshot);
  useEffect(()=>()=>controller.cancel(),[controller]);
  const stale=executionReportStale(state.report,task,graphCursor,scope);
  const invalidate=useCallback(()=>controller.invalidate(),[controller]);
  return {...state,stale,invalidate,inspect:()=>controller.inspect(),more:()=>stale?Promise.resolve():controller.more()};
}
