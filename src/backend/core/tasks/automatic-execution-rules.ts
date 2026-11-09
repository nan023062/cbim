/**
 * 作用定位：在同一派发存储前缀核实自动兜底与可信周期的关联。
 * 设计原因：工具输入不能选择模式或伪造岗位；当前已有负责人时不能借 auto 忽略失效配置。
 * 职责边界：历史校验只检查原周期，新增许可另核当前责任；真实知识与模型由服务持锁检查。
 */
import {fail} from '../foundation/errors';
import {automaticExecutionBindingMatches,type AutomaticExecutionBinding} from '../team/automatic-execution';
import type {DispatchState} from './dispatch-storage';

/** current 仅用于新计划、派发、领取与恢复；结算保留原事实，不受后来登记影响。 */
export function assertAutomaticExecution(state:DispatchState,binding:AutomaticExecutionBinding,rootSessionId:string,current=false):void{
  const scope=state.scopes?.find(item=>item.scopeId===binding.scopeId&&item.rootSessionId===rootSessionId&&item.workspaceId===binding.workspaceId),policy=scope?.executionPolicy;
  if(!automaticExecutionBindingMatches(binding,state.workspaceId,scope?.scopeId,'cbim:executor',binding.moduleIds)||policy?.mode!=='auto'||policy.model.profileId!==binding.model.profileId||policy.model.modelId!==binding.model.modelId||policy.model.configurationHash!==binding.model.configurationHash)fail('AUTO_BINDING_INVALID','自动兜底没有对应的原始用户模式与模型配置');
  if(current){
    if(scope?.status!=='active')fail('DISPATCH_SCOPE_CLOSED','自动执行周期已经关闭或等待');
    if(binding.moduleIds.some(id=>state.moduleOwnerships?.some(owner=>owner.moduleId===id&&owner.ownerMemberId)))fail('AUTO_OWNER_EXISTS','模块已有负责岗位，请查询真实岗位配置并重新规划');
  }
}
