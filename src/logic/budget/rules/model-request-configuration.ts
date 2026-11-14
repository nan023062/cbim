/**
 * 作用定位：从已冻结的执行快照派生单角色的请求计量参数，供预算服务与审计共同核对。
 * 设计原因：角色价格不能由引擎请求给出；附加角色指纹还绑定整个执行配置，防止把另一运行的同型号混入本次执行。
 * 职责边界：只读取公开快照，不接触凭据、配置服务、网络或注册引擎。
 */
import type {ResolvedEngineModel} from '../../engines';
import {workspaceMemberModelHash,workspaceMemberCanonical} from '../../team/rules/workspace-member-rules';
import {hash} from '../../../core/platform/node/serialization';
import {requestBudgetModelSchema,type RequestBudgetModel} from './model-request-budget';

/** 预算只消费公开配置，不需要任何角色凭据。 */
export type RequestBudgetExecutionModel=Pick<ResolvedEngineModel,'profile'>;

/** primary 保留原预算字段与 hash；额外角色同时冻结角色身份和全部选型的 hash。 */
export function requestBudgetModelFor(profile:ResolvedEngineModel['profile'],slot='primary'):RequestBudgetModel{
  const bindingHash=workspaceMemberModelHash(profile);
  if(slot==='primary')return requestBudgetModelSchema.parse({profileId:profile.id,modelId:profile.model,configurationHash:bindingHash,api:profile.api,contextWindow:profile.contextWindow,maxTokens:profile.maxTokens,...(profile.pricing?{pricing:profile.pricing}:{})});
  const value=Object.hasOwn(profile.modelRoles?.roles??{},slot)?profile.modelRoles!.roles[slot]:undefined;
  if(!value)throw Error('执行快照没有模型角色：'+slot);
  const p=value.profile,base={profileId:p.id,modelId:p.model,configurationHash:hash(workspaceMemberCanonical(p)),role:{slot,bindingHash},api:p.api};
  return requestBudgetModelSchema.parse(value.kind==='embedding'
    ?{...base,inputTokens:value.profile.inputTokens,dimensions:value.profile.dimensions,...(value.profile.inputPrice===undefined?{}:{inputPrice:value.profile.inputPrice})}
    :{...base,contextWindow:value.profile.contextWindow,maxTokens:value.profile.maxTokens,...(value.profile.pricing?{pricing:value.profile.pricing}:{})});
}
