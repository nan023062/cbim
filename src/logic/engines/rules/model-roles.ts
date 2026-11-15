/**
 * 作用定位：把官方模型角色声明与用户 V2 选型投影为有序操作引用。
 * 设计原因：保存、岗位采纳、执行准备共用同一必填/能力/型号规则；实际存储与凭据仍由模型服务负责。
 */
import {modelRolesSelectionSchema,type ModelRolesSelection,type ModelRoleDescriptor} from '../model-roles';
import type {ModelConnectionRequirement} from '../../models';

export interface RoleOperation {slot:string;profileId:string;modelId:string;kind:'generation'|'embedding';connection?:ModelConnectionRequirement}
/** primary 在旧字段中有唯一事实；额外角色必须完全匹配官方声明，不接受未登记字段或能力降级。 */
export function additionalRoleOperations(declarations:readonly ModelRoleDescriptor[],selection:ModelRolesSelection|undefined):RoleOperation[]{
  const roles=selection?modelRolesSelectionSchema.parse(selection).roles:{};
  for(const slot of Object.keys(roles))if(!declarations.some(declaration=>declaration.id===slot))throw Error('引擎未声明模型角色：'+slot);
  const operations:RoleOperation[]=[];
  for(const declaration of declarations){
    const ref=roles[declaration.id];
    if(!ref){if(declaration.required)throw Error('请配置模型角色：'+declaration.label);continue}
    if(ref.kind!==declaration.kind)throw Error(declaration.label+' 的模型能力不匹配');
    if(declaration.modelIds&&!declaration.modelIds.includes(ref.modelId))throw Error(declaration.label+' 不支持所选型号');
    operations.push({slot:declaration.id,...ref,...(declaration.kind==='generation'?{connection:declaration.connection}:{})});
  }
  return operations;
}
