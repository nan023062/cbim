/**
 * 作用定位：Codex 官方包的版本化工厂入口。
 * 设计原因：宿主提供已冻结依赖和可信端口，App Server 协议与原生工具适配由包独立维护。
 */
import {CodexEngine} from './engine';
import type {EngineAdapter,EngineAdapterOptions} from '../../rules/engine-adapter';
export const engineAdapter:EngineAdapter=Object.freeze({protocol:1,id:'codex',version:'1.0.0',create:(options:EngineAdapterOptions)=>new CodexEngine(options)});
