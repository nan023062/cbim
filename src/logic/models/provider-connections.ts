/**
 * 作用定位：供应商到协议需求的纯接口选择规则，供界面筛选、岗位采纳和实际启动共同使用。
 * 设计原因：保留主接口与旧 Pi 快照；只在原协议不兼容时选择显式接口或精确识别的官方预设。
 * 职责边界：不联网、不解密、不转换请求或模型 ID；协议可选不等于凭据或工具调用已经验证。
 */
import type {AlternateConnection,LlmDefinition,LlmApi} from './config';

import {identifyProvider} from './provider-presets';

export type ProviderConnections=Pick<LlmDefinition,'api'|'baseUrl'|'autoDetect'|'alternateConnections'>;
/** 调用方提供协议需求，模型模块不认识引擎或业务角色。无 fallbackApi 时只使用兼容主接口。 */
export interface ModelConnectionRequirement {supportedApis:readonly LlmApi[];fallbackApi?:LlmApi}
export interface SelectedConnection {api:LlmDefinition['api'];baseUrl:string;source:'primary'|'explicit'|'preset'}
const supportsModel=(connection:AlternateConnection,modelId?:string)=>!connection.modelIds||modelId!==undefined&&connection.modelIds.includes(modelId);

/** 主接口优先，显式配置覆盖该协议的预设；无兼容接口时返回 undefined，调用者不得静默绕过协议需求。 */
export function selectProviderConnection(profile:ProviderConnections,requirement:ModelConnectionRequirement,modelId?:string):SelectedConnection|undefined {
  if(requirement.supportedApis.includes(profile.api))return {api:profile.api,baseUrl:profile.baseUrl,source:'primary'};
  const api=requirement.fallbackApi;
  if(!api||!requirement.supportedApis.includes(api))return undefined;
  const explicit=profile.alternateConnections?.find(connection=>connection.api===api);
  if(explicit)return supportsModel(explicit,modelId)?{api:explicit.api,baseUrl:explicit.baseUrl,source:'explicit'}:undefined;
  const preset=profile.autoDetect!==false?identifyProvider(profile.baseUrl)?.connections.find(connection=>connection.api===api):undefined;
  return preset&&supportsModel(preset,modelId)?{api:preset.api,baseUrl:preset.baseUrl,source:'preset'}:undefined;
}
