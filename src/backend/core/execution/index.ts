/**
 * 目录归属：backend/core/execution；运行协议与计量。
 * 作用定位：大脑执行层：对外重导出 Loop 契约、主对话实例绑定、成员执行绑定、可信回注来源、存储端口与运行时。
 * 设计原因：公开引擎无关执行入口；具体引擎由装配层直接导入，避免普通领域消费者加载 Pi 依赖。
 */
export * from './types';
export type {RunStorage,ExecutionJournal} from './storage';
export * from './runtime/runtime';
export * from './member-run';
export * from './input-source';
export * from './conversation-binding';
