/**
 * 作用定位：公开岗位执行的选择、冻结绑定及纯身份校验，供任务和目标视图核对历史归属。
 * 设计原因：岗位、能力来源和模型版本必须来自同一原派发事实；Bridge 不公开登记解析器、配置锁或模型凭据。
 */
export {ownerExecutionBindingSchema,ownerExecutionSelectionSchema,ownerExecutionBindingMatches} from '../../logic/team/rules/member-execution-binding';
export type {OwnerExecutionBinding,OwnerExecutionSelection,ExpectedModuleOwner} from '../../logic/team/rules/member-execution-binding';
export {taskOwnerInspectInputSchema,taskOwnerInspectOutputSchema,ownerExecutionDiscoverySchema} from '../../logic/team/rules/owner-execution-discovery';
export type {TaskOwnerInspectInput,TaskOwnerInspectOutput,OwnerExecutionDiscovery} from '../../logic/team/rules/owner-execution-discovery';

/** 自动兜底是独立执行身份，不是长期岗位，也不代表权限批准。 */
export {automaticExecutionBindingMatches} from '../../logic/team/rules/automatic-execution';
export type {AutomaticExecutionBinding} from '../../logic/team/rules/automatic-execution';
