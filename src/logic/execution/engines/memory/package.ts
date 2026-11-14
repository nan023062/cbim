/**
 * 本包版本携带静态能力声明，随完整文件清单验签并在创建实例前核对。
 * 作用定位：CBIM 自定义记忆引擎的独立官方包入口，运行库与适配器同版，无外部 Agent SDK。
 * 设计原因：验证开发者定义的领域 Loop 也可经统一协议独立构建、安装与调度，冷壳无需认识本实现。
 */
import {engineDescriptor} from '../../../engines';
import type {EngineAdapter,EngineAdapterOptions} from '../../rules/engine-adapter';
import {MemoryEngine} from './engine';
export const engineAdapter:EngineAdapter=Object.freeze({protocol:1,id:'memory',version:'1.1.0',descriptor:engineDescriptor('memory'),create:(options:EngineAdapterOptions)=>new MemoryEngine(options)});
