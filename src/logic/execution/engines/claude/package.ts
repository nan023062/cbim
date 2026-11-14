/**
 * 作用定位：Claude Code 官方包的版本化工厂入口。
 * 设计原因：包只获得统一模型、工具和预算端口，SDK 加载、会话与停止细节封装在适配器内。
 */
import {ClaudeCodeEngine} from './engine';
import type {EngineAdapter,EngineAdapterOptions} from '../../rules/engine-adapter';
export const engineAdapter:EngineAdapter=Object.freeze({protocol:1,id:'claude-code',version:'1.0.0',create:(options:EngineAdapterOptions)=>new ClaudeCodeEngine(options)});
