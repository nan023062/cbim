/**
 * 作用定位：岗位负责人派发的纯选择与冻结身份契约，供目标、任务、运行和公开视图共用。
 * 设计原因：请求只提交预期，实际绑定由登记重建；稳定岗位、静态角色与每次执行实例不能互相代替。
 * 职责边界：不读文件、模型或凭据，不声明来源当前有效；旧缺省仅用于历史读取，新许可由领域规则核实。
 */
import {z} from 'zod';
import {capabilitySourceRefSchema,knowledgeSourceRefSchema,sourceRefMatches} from '../workspace/knowledge-source';

const id=z.string().min(1).max(512).refine(value=>value.trim()===value&&!/[\x00-\x1f]/.test(value));
const uuid=z.string().uuid(),revision=z.number().int().positive().safe(),digest=z.string().regex(/^[a-f0-9]{64}$/);
export const expectedModuleOwnerSchema=z.object({moduleId:id,bindingId:uuid,revision,ownerMemberId:uuid}).strict();
export type ExpectedModuleOwner=z.infer<typeof expectedModuleOwnerSchema>;
/** 完整对应本次模块的预期；不接受角色正文、source proof、模型配置或密钥。 */
export const ownerExecutionSelectionSchema=z.object({version:z.literal(1),memberId:uuid,expectedMemberRevision:revision,expectedCapabilityHash:digest,expectedConfigurationHash:digest,expectedOwners:z.array(expectedModuleOwnerSchema).min(1).max(50)}).strict().superRefine((value,context)=>{
  if(new Set(value.expectedOwners.map(owner=>owner.moduleId)).size!==value.expectedOwners.length||value.expectedOwners.some(owner=>owner.ownerMemberId!==value.memberId))context.addIssue({code:'custom',message:'负责人选择须为同一岗位且模块不得重复'});
});
export type OwnerExecutionSelection=z.infer<typeof ownerExecutionSelectionSchema>;
/** 不可变运行依据；captureId 是采纳事实，sourceRef 才是受控来源身份。 */
export const ownerExecutionBindingSchema=z.object({version:z.literal(1),workspaceId:id,memberId:uuid,memberRevision:revision,memberHash:digest,
  capability:z.object({agentId:id,teamId:id,captureId:uuid,capabilityHash:digest,sourceRef:capabilitySourceRefSchema}).strict(),
  model:z.object({profileId:uuid,modelId:z.string().min(1).max(160),configurationHash:digest}).strict(),
  owners:z.array(expectedModuleOwnerSchema.extend({sourceRef:knowledgeSourceRefSchema}).strict()).min(1).max(50),
}).strict().superRefine((value,context)=>{
  const capability=value.capability;
  if(capability.agentId==='cbim:main'||!sourceRefMatches(capability.sourceRef,value.workspaceId,capability.agentId==='cbim:executor'?'cbim:executor':{kind:'agent',sourceId:capability.agentId})||new Set(value.owners.map(owner=>owner.moduleId)).size!==value.owners.length||value.owners.some(owner=>owner.ownerMemberId!==value.memberId||!sourceRefMatches(owner.sourceRef,value.workspaceId,{kind:'module',sourceId:owner.moduleId})))context.addIssue({code:'custom',message:'执行绑定的岗位、角色或模块来源不一致'});
});
export type OwnerExecutionBinding=z.infer<typeof ownerExecutionBindingSchema>;
/** 将已核实绑定投影为请求预期；不生成新身份或更改原记录。 */
export function ownerExecutionSelectionFor(binding:OwnerExecutionBinding):OwnerExecutionSelection{return {version:1,memberId:binding.memberId,expectedMemberRevision:binding.memberRevision,expectedCapabilityHash:binding.capability.capabilityHash,expectedConfigurationHash:binding.model.configurationHash,expectedOwners:binding.owners.map(({sourceRef:_,...owner})=>({...owner}))}}
const equal=(a:unknown,b:unknown):boolean=>{
  const order=(value:unknown):unknown=>Array.isArray(value)?value.map(order):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([key,item])=>[key,order(item)])):value;
  return JSON.stringify(order(a))===JSON.stringify(order(b));
};
/** 输入的 owners 次序不改变责任集合，输出仍保留原输入，不借比较裁剪或排序回包。 */
export function ownerExecutionSelectionMatches(selection:OwnerExecutionSelection,binding:OwnerExecutionBinding):boolean{
  if(!ownerExecutionSelectionSchema.safeParse(selection).success||!ownerExecutionBindingSchema.safeParse(binding).success)return false;
  const expected=ownerExecutionSelectionFor(binding),sort=(value:OwnerExecutionSelection)=>({...value,expectedOwners:[...value.expectedOwners].sort((a,b)=>a.moduleId.localeCompare(b.moduleId))});return equal(sort(selection),sort(expected));
}
/** 仅在原计划覆盖本次模块时比较其精确岗位与关系；缺省只等于缺省，不能作为新业务通配。 */
export function sameOwnerExecutionForModules(planned:OwnerExecutionBinding|undefined,actual:OwnerExecutionBinding|undefined,moduleIds:readonly string[]):boolean{
  if(!planned||!actual)return planned===actual;
  if(!ownerExecutionBindingSchema.safeParse(planned).success||!ownerExecutionBindingSchema.safeParse(actual).success||!moduleIds.length||new Set(moduleIds).size!==moduleIds.length)return false;
  const {owners:left,...a}=planned,{owners:right,...b}=actual;
  return equal(a,b)&&right.length===moduleIds.length&&moduleIds.every(id=>{const x=left.find(owner=>owner.moduleId===id),y=right.find(owner=>owner.moduleId===id);return !!x&&!!y&&equal(x,y)});
}
/** 局部身份校验不查询当前登记；历史展示必须与自身 workspace/Agent/模块对应。 */
export function ownerExecutionBindingMatches(binding:OwnerExecutionBinding,workspaceId:string,agentId:string,moduleIds:readonly string[]):boolean{return ownerExecutionBindingSchema.safeParse(binding).success&&binding.workspaceId===workspaceId&&binding.capability.agentId===agentId&&moduleIds.length===binding.owners.length&&new Set(moduleIds).size===moduleIds.length&&moduleIds.every(id=>binding.owners.some(owner=>owner.moduleId===id))}
