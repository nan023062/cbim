/**
 * 作用定位：定义用户选择的协作模式和自动兜底的冻结身份，供计划、任务与运行共用。
 * 设计原因：协作周期冻结主会话独立引擎与模型；旧兜底记录仅保留可读，未登记岗位的业务由主 Agent 执行。
 * 职责边界：纯数据契约，不授予工具权限；是否可兜底还须核实可信周期、当前模块与实际模型。
 */
import {z} from 'zod';
import {loopEngineSchema} from '../models/engine';
import {projectRootModuleId} from '../workspace/project-root';

const id=z.string().min(1).max(512),digest=z.string().regex(/^[a-f0-9]{64}$/);
const model=z.object({profileId:z.string().uuid(),modelId:z.string().min(1).max(160),configurationHash:digest,engine:loopEngineSchema.optional()}).strict();
/** 与始终可查询的项目根共用身份；旧自动委派契约仍仅在无任何正式模块时接受该范围。 */
export const implicitProjectModuleId=projectRootModuleId;
export const collaborationModeSchema=z.enum(['auto','team']);
export type CollaborationMode=z.infer<typeof collaborationModeSchema>;
/** 由桌面运行入口冻结；旧周期缺省按 team 解释，不追溯取得自动兜底资格。 */
export const collaborationPolicySchema=z.discriminatedUnion('mode',[
  z.object({mode:z.literal('team')}).strict(),
  z.object({mode:z.literal('auto'),model}).strict(),
]);
export type CollaborationPolicy=z.infer<typeof collaborationPolicySchema>;
export const automaticExecutionBindingSchema=z.object({version:z.literal(1),kind:z.literal('automatic'),scopeId:id,workspaceId:id,
  agentId:z.literal('cbim:executor'),teamId:id,capabilityHash:digest,knowledgeRevision:id,model,
  reason:z.enum(['unassigned_owner','no_modules']),moduleIds:z.array(id).min(1).max(50),
}).strict().superRefine((value,context)=>{
  if(new Set(value.moduleIds).size!==value.moduleIds.length||(value.reason==='no_modules'?(value.moduleIds.length!==1||value.moduleIds[0]!==implicitProjectModuleId):value.moduleIds.includes(implicitProjectModuleId)))context.addIssue({code:'custom',message:'自动兜底原因与模块范围不一致'});
});
export type AutomaticExecutionBinding=z.infer<typeof automaticExecutionBindingSchema>;
/** 不依赖字段序列化顺序；计划可以覆盖原任务的模块子集，不能换周期、模型或原因。 */
export function sameAutomaticExecutionForModules(a:AutomaticExecutionBinding|undefined,b:AutomaticExecutionBinding|undefined,ids:readonly string[]):boolean{
  if(!a||!b)return a===b;
  return automaticExecutionBindingSchema.safeParse(a).success&&automaticExecutionBindingSchema.safeParse(b).success&&
    a.scopeId===b.scopeId&&a.workspaceId===b.workspaceId&&a.agentId===b.agentId&&a.teamId===b.teamId&&a.capabilityHash===b.capabilityHash&&a.knowledgeRevision===b.knowledgeRevision&&a.reason===b.reason&&
    a.model.profileId===b.model.profileId&&a.model.modelId===b.model.modelId&&a.model.configurationHash===b.model.configurationHash&&b.moduleIds.length===ids.length&&ids.every(id=>a.moduleIds.includes(id)&&b.moduleIds.includes(id));
}
/** 历史的结构归属检查不读当前状态；不意味着现在仍允许领取。 */
export function automaticExecutionBindingMatches(binding:AutomaticExecutionBinding,workspaceId:string,scopeId:string|undefined,agentId:string,ids:readonly string[]):boolean{
  return automaticExecutionBindingSchema.safeParse(binding).success&&binding.workspaceId===workspaceId&&binding.scopeId===scopeId&&binding.agentId===agentId&&binding.moduleIds.length===ids.length&&new Set(ids).size===ids.length&&ids.every(id=>binding.moduleIds.includes(id));
}
