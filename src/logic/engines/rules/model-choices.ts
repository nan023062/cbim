/**
 * 作用定位：将开发者声明的各模型角色投影为已配置、启用且兼容的选择列表。
 * 设计原因：Agent 编辑、主对话与引擎能力列表共用规则；纯预览不解密或联网，保存和启动仍由配置服务复核。
 */
import {selectProviderConnection,type LlmSettings} from '../../models';
import {engineDescriptor,providerSupportsEngine} from './model-selection';
import type {LoopEngine} from '../catalog/supported-engines';
import {additionalRoleOperations} from './model-roles';
import type {ModelRoleDescriptor,ModelRolesSelection} from '../model-roles';
export interface ModelChoice {profileId:string;modelId:string;label:string}
/** 显式角色只能选择对应操作；型号白名单约束与服务的 additionalRoleOperations 相同。 */
export function modelRoleChoices(role:ModelRoleDescriptor,models:LlmSettings):ModelChoice[]{
  return models.profiles.flatMap(profile=>(role.kind==='embedding'?profile.embedding?.models??[]:profile.models).filter(model=>model.enabled&&(!role.modelIds||role.modelIds.includes(model.id))&&(role.kind==='embedding'||!!selectProviderConnection(profile,role.connection,model.id))).map(model=>({profileId:profile.id,modelId:model.id,label:profile.name+' / '+(model.name||model.id)})));
}
/** 可用于禁用保存/发送；不是后端授权，陈旧模型配置仍需服务复核。 */
export function engineSelectionAvailable(value:{engine:LoopEngine;profileId:string;modelId:string;modelRoles?:ModelRolesSelection}|undefined|null,models:LlmSettings|undefined):boolean{
  if(!value||!models)return false;const descriptor=engineDescriptor(value.engine),profile=models.profiles.find(profile=>profile.id===value.profileId);
  if(!profile?.models.some(model=>model.id===value.modelId&&model.enabled)||!providerSupportsEngine(value.engine,profile,value.modelId))return false;
  try{for(const operation of additionalRoleOperations(descriptor.additionalModelRoles??[],value.modelRoles)){const role=descriptor.additionalModelRoles!.find(role=>role.id===operation.slot)!;if(!modelRoleChoices(role,models).some(choice=>choice.profileId===operation.profileId&&choice.modelId===operation.modelId))return false}return true}catch{return false}
}
