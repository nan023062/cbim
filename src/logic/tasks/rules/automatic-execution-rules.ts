/**
 * 作用定位：在同一派发存储前缀核实自动兜底与可信周期的关联。
 * 设计原因：旧默认执行者的原绑定只用于历史校验；新业务由主 Agent 或自定义岗位执行，不能用旧自动绑定重启成员。
 * 职责边界：历史校验只检查原周期，新增许可另核当前责任；真实知识与模型由服务持锁检查。
 */
import {fail} from '../../../core/errors';
import {automaticExecutionBindingMatches,type AutomaticExecutionBinding} from '../../team/rules/automatic-execution';
import type {DispatchState} from '../../dispatch/rules/dispatch-storage';

/** current 仅用于新计划、派发、领取与恢复；结算保留原事实，不受后来登记影响。 */
export function assertAutomaticExecution(state:DispatchState,binding:AutomaticExecutionBinding,rootSessionId:string,current=false):void{
  const scope=state.scopes?.find(item=>item.scopeId===binding.scopeId&&item.rootSessionId===rootSessionId&&item.workspaceId===binding.workspaceId),policy=scope?.executionPolicy;
  if(!automaticExecutionBindingMatches(binding,state.workspaceId,scope?.scopeId,'cbim:executor',binding.moduleIds)||policy?.mode!=='auto'||policy.model.profileId!==binding.model.profileId||policy.model.modelId!==binding.model.modelId||policy.model.configurationHash!==binding.model.configurationHash)fail('AUTO_BINDING_INVALID','自动兜底没有对应的原始用户模式与模型配置');
  if(current){
    fail('AGENT_RETIRED','内置默认执行 Agent 已退役；保留历史记录，请由主 Agent 在当前会话执行未配置自定义岗位的工作');
  }
}
