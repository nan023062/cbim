/**
 * 作用定位：定义显式新周期共用的原生上下文隔离边界。
 * 设计原因：只读核实和正式业务重规划都新建原生链，但权限与证据契约各自独立；共享结构不能把旧未知运行重新带入新链。
 */
import {z} from 'zod';
const id=z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/);
/** ID 均来自可信运行时；nativeSessionId 是新链启动意图（Pi/Claude 可采用），Codex 实际 ID 另由 session.bound 固定。排除集合有界且不包含本次初始运行，不接受公开请求传入。 */
export const freshContextSchema=z.object({initialRunId:id,nativeSessionId:z.string().uuid(),excludedRunIds:z.array(id).max(4096).refine(ids=>new Set(ids).size===ids.length,'旧运行身份不能重复')}).strict().refine(value=>!value.excludedRunIds.includes(value.initialRunId),'新运行不能被排除');
export type FreshContext=z.infer<typeof freshContextSchema>;
/** 结构端口不依赖 DispatchScope，避免周期契约反向引用造成类型循环。 */
export function scopeFreshContext(scope:{recovery?:{context:FreshContext};replan?:{context:FreshContext}}):FreshContext|undefined{return scope.recovery?.context??scope.replan?.context}
