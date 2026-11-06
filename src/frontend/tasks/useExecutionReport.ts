/**
 * 作用定位：为选中成员任务装配只读核实控制器，将图/周期变化投影为报告过期提示。
 * 设计原因：挂载、页签显示和轮询都不触发核实；不同节点或轮次独立控制器，迟到结果不会覆盖新选择，报告读取不影响成员执行。
 */
import {useEffect,useMemo,useSyncExternalStore} from 'react';
import type {GraphCursor,ScopeSummary,TaskNode} from '../../bridge/contracts/dispatch';
import {ExecutionReportController,executionReportKey,executionReportStale,type ExecutionReportSelection} from './execution-report-state';

/** 只在调用 inspect/more 时访问只读 IPC；没有恢复、确认操作或自动刷新。 */
export function useExecutionReport(identity:ExecutionReportSelection,task:TaskNode,graphCursor?:GraphCursor,scope?:ScopeSummary){
  const key=executionReportKey(identity);
  const controller=useMemo(()=>new ExecutionReportController(identity,request=>window.cbim.call('dispatch.executionReport',request)),[key]);
  const state=useSyncExternalStore(controller.subscribe,()=>controller.snapshot,()=>controller.snapshot);
  useEffect(()=>()=>controller.cancel(),[controller]);
  const stale=executionReportStale(state.report,task,graphCursor,scope);
  return {...state,stale,inspect:()=>controller.inspect(),more:()=>stale?Promise.resolve():controller.more()};
}
