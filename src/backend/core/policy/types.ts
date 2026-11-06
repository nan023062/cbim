/**
 * 作用定位：对话权限模式和单次人工确认契约。
 * 设计原因：权限定义独立于具体引擎；保持当前原生权限与知识写开关语义，本次目录迁移不扩大授权。
 */
/** 原生工具的执行策略；知识写入仍由独立的知识服务授权。 */
export type ChatPermission='read'|'ask'|'execute';
/** 单次工具调用的待授权快照；停止执行后失效，不携带界面状态。 */
export interface ChatApproval {id:string;taskId:string;name:string;input:Record<string,unknown>;createdAt:string}
