/**
 * 本包版本携带静态能力声明，随完整文件清单验签并在创建实例前核对。
 * 作用定位：Codex 官方包的版本化工厂入口。
 * 设计原因：宿主提供已冻结依赖和可信端口，App Server 协议与原生工具适配由包独立维护。
 */
import {CodexEngine} from './engine';
import {engineDescriptor} from '../../../engines';
import type {EngineAdapter,EngineAdapterOptions} from '../../rules/engine-adapter';
export const engineAdapter:EngineAdapter=Object.freeze({protocol:1,id:'codex',version:'1.1.0',descriptor:engineDescriptor('codex'),create:(options:EngineAdapterOptions)=>new CodexEngine({...options,nativeToolsRuntime:options.runtime?.dependencies?.pi??options.nativeToolsRuntime})});
