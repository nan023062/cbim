/**
 * 作用定位：引擎无关的工具调用、副作用、策略决策及运行回执契约。
 * 设计原因：不同工具共用可追溯身份与结果语义；回执区分拒绝、失败与未知，不依赖具体知识服务。
 */
import type {ToolScope} from './scope-schema';
export type {ToolScope} from './scope-schema';
export interface ToolCall {id: string; name: string; input: Record<string, unknown>}
/** 声明操作事实，不表示已经获得权限；preview 不提交正式知识，可维护实例内预览缓存。 */
export type ToolEffect='read'|'preview'|'maintenance'|'business-write'|'knowledge-write'|'command';
/** 范围由可信装配提供；外部仓库读取不等于工作区文件或知识写入。 */
export interface ToolDecision {allow: boolean; reason?: string;effects?:readonly ToolEffect[];scope?:ToolScope}
/** 由运行时生成的单次调用回执；成功只表示工具返回成功，不等于业务验收或回滚。 */
export interface ToolReceipt {
  version:1;toolCallId:string;toolName:string;workspaceId:string;taskId:string;runId:string;
  outcome:'succeeded'|'failed'|'denied'|'unknown';
  /** 参数与返回结果的 SHA-256；不把哈希当作产物验证证据。 */
  inputHash:string;resultHash?:string;
  effects:readonly ToolEffect[];scope:ToolScope;recordedAt:string;
}
