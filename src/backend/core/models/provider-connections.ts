/**
 * 作用定位：供应商到引擎的纯接口选择规则，供界面筛选、岗位采纳和实际启动共同使用。
 * 设计原因：保留主接口与旧 Pi 快照；只在原协议不兼容时选择显式接口或精确识别的官方预设。
 * 职责边界：不联网、不解密、不转换请求或模型 ID；协议可选不等于凭据或工具调用已经验证。
 */
import type {AlternateConnection,LlmDefinition} from './config';
import {engineApi,engineSupportsApi,type LoopEngine} from './engine';
import {identifyProvider} from './provider-presets';

export type ProviderConnections=Pick<LlmDefinition,'api'|'baseUrl'|'autoDetect'|'alternateConnections'>;
export interface SelectedConnection {api:LlmDefinition['api'];baseUrl:string;source:'primary'|'explicit'|'preset'}
const supportsModel=(connection:AlternateConnection,modelId?:string)=>!connection.modelIds||modelId!==undefined&&connection.modelIds.includes(modelId);

/** 主接口优先，显式配置覆盖该协议的预设；无兼容接口时返回 undefined，调用者不得静默降级引擎。 */
export function connectionForEngine(profile:ProviderConnections,engine:LoopEngine,modelId?:string):SelectedConnection|undefined {
  if(engineSupportsApi(engine,profile.api))return {api:profile.api,baseUrl:profile.baseUrl,source:'primary'};
  const api=engineApi(engine);
  const explicit=profile.alternateConnections?.find(connection=>connection.api===api);
  if(explicit)return supportsModel(explicit,modelId)?{api:explicit.api,baseUrl:explicit.baseUrl,source:'explicit'}:undefined;
  const preset=profile.autoDetect!==false?identifyProvider(profile.baseUrl)?.connections.find(connection=>connection.api===api):undefined;
  return preset&&supportsModel(preset,modelId)?{api:preset.api,baseUrl:preset.baseUrl,source:'preset'}:undefined;
}

/** 界面必须传真实模型 ID，以应用供应商或自定义接口声明的模型范围。 */
export function providerSupportsEngine(engine:LoopEngine,profile:ProviderConnections,modelId:string):boolean {
  return !!connectionForEngine(profile,engine,modelId);
}
