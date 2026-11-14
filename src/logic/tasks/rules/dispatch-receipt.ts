/**
 * 作用定位：主调度与桌面内联任务共用的纯派发回执结构，不包含 IO、哈希或原命令核实。
 * 设计原因：可视化只需核对已保存信封与图游标，不能把主工具的后端业务核实依赖带进浏览器；实际提交与 canonical 关联仍由主工具装配校验。
 */
import {z} from 'zod';
import {automaticExecutionBindingSchema} from '../../team/rules/automatic-execution';
import {graphCursorSchema} from './graph-rules';
const id=z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/);
/** 只证明待办信封提交；没有 scope/run 字段，不补造归属、执行成功或业务验收。 */
export const dispatchTaskOutputSchema=z.object({commandId:id,taskId:id,messageId:id,cursor:graphCursorSchema,disposition:z.enum(['queued','waiting']),fallbackBinding:automaticExecutionBindingSchema.optional()}).strict();
