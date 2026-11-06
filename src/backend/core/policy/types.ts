/**
 * 作用定位：对话权限模式和单次人工确认契约。
 * 设计原因：原生执行与知识写入共用本次运行权限；授权由执行边界核验，模型参数不能提升权限。
 */
/** 内部运行的统一策略；只读拒绝两类写入，ask 等待本轮确认，execute 仍受领域规则约束。 */
export type ChatPermission='read'|'ask'|'execute';
/** 单次工具调用的待授权快照；停止执行后失效，不携带界面状态。 */
export interface ChatApproval {id:string;taskId:string;name:string;input:Record<string,unknown>;createdAt:string}
