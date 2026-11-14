/**
 * 作用定位：官方引擎身份校验及引擎到模型连接需求的纯投影。
 * 设计原因：把引擎偏好与模型供应商配置分开；界面筛选、岗位登记和执行准备使用同一份静态声明。
 * 职责边界：不联网、不解密、不切换引擎，不把可选协议当作真实模型能力验证。
 */
import {z} from 'zod';
import {selectProviderConnection,type ModelConnectionRequirement,type ProviderConnections} from '../../models';
import {supportedEngines,type LoopEngine,type EngineDescriptor} from '../catalog/supported-engines';

/** 非空静态元组生成校验枚举，新增引擎不再修改第二份 ID 列表。 */
export const loopEngineSchema=z.enum(supportedEngines.map(engine=>engine.id) as [LoopEngine,...LoopEngine[]]);
/** 只返回已静态声明的官方引擎；未知身份拒绝，不默认为其他实现。 */
export function engineDescriptor(engine:LoopEngine):EngineDescriptor{
  const id=loopEngineSchema.parse(engine);return supportedEngines.find(item=>item.id===id)!;
}
export const engineLabel=(engine:LoopEngine)=>engineDescriptor(engine).label;
export const engineApi=(engine:LoopEngine)=>engineDescriptor(engine).fallbackApi;
export const engineSupportsApi=(engine:LoopEngine,api:string)=>engineDescriptor(engine).supportedApis.some(item=>item===api);
/** 返回模型模块能理解的协议约束；模型模块无需知道引擎身份。 */
export function engineModelRequirement(engine:LoopEngine):ModelConnectionRequirement{
  const descriptor=engineDescriptor(engine);return {supportedApis:descriptor.supportedApis,fallbackApi:descriptor.fallbackApi};
}
/** 预览与启动共用实际接口选择；无兼容接口返回 undefined，不改供应商设置。 */
export function connectionForEngine(profile:ProviderConnections,engine:LoopEngine,modelId?:string){
  return selectProviderConnection(profile,engineModelRequirement(engine),modelId);
}
/** 调用者传真实模型 ID，以应用显式接口或官方预设限定的模型范围。 */
export function providerSupportsEngine(engine:LoopEngine,profile:ProviderConnections,modelId:string):boolean{
  return !!connectionForEngine(profile,engine,modelId);
}
