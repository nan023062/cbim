/**
 * 作用定位：定义共享运行展示向外层请求补充工具详情的最小输入。
 * 设计原因：展示只识别公开运行与原调用身份，恢复状态、查询、刷新和任务选择仍归外层业务控制者；不保存第二份运行状态。
 */
import type {ReactNode} from 'react';
import type {RunSummary} from '../../bridge/contracts/execution';

export interface ToolDetailsSelection {run:RunSummary;toolCallId:string;toolName:string}
/** 只组合展示；具体面板自行按显式用户操作查询，不因插槽执行而重放工具。 */
export type ToolDetailsRenderer=(selection:ToolDetailsSelection)=>ReactNode;
