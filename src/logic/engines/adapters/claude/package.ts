/**
 * 1.1.1 冻结递归 Agent 请求预算协议；与已公开 1.1.0 使用不同制品身份，旧会话不被静默改投。
 * 本包版本携带静态能力声明，随完整文件清单验签并在创建实例前核对。
 * 作用定位：Claude Code 官方包的版本化工厂入口。
 * 设计原因：包只获得统一模型、工具和预算端口，SDK 加载、会话与停止细节封装在适配器内。
 */
import { ClaudeCodeEngine } from './engine';

import { engineDescriptor } from '../..';

import type { PublishedEngineAdapter, EngineAdapterOptions } from '../../../execution/rules/engine-adapter';

export const engineAdapter: PublishedEngineAdapter = Object.freeze({ protocol: 1, supportsBeforeToolCall: true, id: 'claude-code', version: '1.1.1', descriptor: engineDescriptor('claude-code'), create: (options: EngineAdapterOptions) => new ClaudeCodeEngine(options) });
