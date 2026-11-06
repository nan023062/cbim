/**
 * 作用定位：对话权限模式和单次人工确认契约。
 * 设计原因：内部 Loop 的原生与知识写入共用运行权限；外部 MCP 的凭据与知识写开关单独核验。
 */
/** 内部运行的统一策略；只读拒绝两类写入，ask 等待本轮确认，execute 仍受领域规则约束。 */
export type ChatPermission='read'|'ask'|'execute';
/** 单次工具调用的待授权快照；停止执行后失效，不携带界面状态。 */
export interface ChatApproval {id:string;taskId:string;name:string;input:Record<string,unknown>;createdAt:string}
