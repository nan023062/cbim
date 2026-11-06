/**
 * 作用定位：引擎无关的工具调用及策略返回契约。
 * 设计原因：为不同工具适配共享调用身份和决策结构；机制类型不依赖具体知识服务。
 */
export interface ToolCall {id: string; name: string; input: Record<string, unknown>}
export interface ToolDecision {allow: boolean; reason?: string}
