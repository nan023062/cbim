/**
 * 作用定位：目标分配、派发和任务历史共用的 Workflow 选择叶子协议，不依赖知识或调度实现。
 * 设计原因：显式选择与旧默认首项是不同事实；只比较本次模块，不能把缺省理解为任意流程或在读取旧记录时补值。
 * 职责边界：这里核实结构、模块范围和已冻结 ID；是否真实挂载、正文版本及知识时效由知识解析器验证。
 */
import {z} from 'zod';
import {fail} from '../../../core/errors';

// 这里是知识逻辑 ID，允许 .cbim/... 路径式名称；不据此直接读取文件。
const logicalId=z.string().min(1).max(512).refine(value=>value.trim()===value&&!/[\x00-\x1f]/.test(value));
export const workflowSelectionSchema=z.object({moduleId:logicalId,workflowId:logicalId}).strict();
/** 存在即为明确非空选择；不默认空数组、不去重、不规范化或裁剪原输入。 */
export const workflowSelectionsSchema=z.array(workflowSelectionSchema).min(1).max(50).refine(values=>new Set(values.map(value=>value.moduleId)).size===values.length,'同一模块只能选择一份 Workflow');
export type WorkflowSelection=z.infer<typeof workflowSelectionSchema>;
const optionalSelections=workflowSelectionsSchema.optional();
const moduleIdsSchema=z.array(logicalId).max(100).refine(ids=>new Set(ids).size===ids.length);

/** 参数只列出显式覆盖，其余模块保持默认模式；缺省历史原样通过，不发生写入或补值。 */
export function validateWorkflowSelections(moduleIds:readonly string[],selections:readonly WorkflowSelection[]|undefined):void{
  if(!moduleIdsSchema.safeParse(moduleIds).success||!optionalSelections.safeParse(selections).success||selections?.some(value=>!moduleIds.includes(value.moduleId)))fail('WORKFLOW_SELECTION_INVALID','Workflow 选择必须唯一且属于本次分配的模块');
}

/**
 * 比较目标模块上的选择模式；双方均缺省才相等，显式 ID 只与同 ID 相等。
 * 允许 planned 包含目标之外的模块，用于原有检查点子集匹配；角色和模块集合规则仍由调用方保持。
 */
export function sameWorkflowSelectionsForModules(planned:readonly WorkflowSelection[]|undefined,actual:readonly WorkflowSelection[]|undefined,moduleIds:readonly string[]):boolean{
  if(!moduleIdsSchema.safeParse(moduleIds).success||!optionalSelections.safeParse(planned).success||!optionalSelections.safeParse(actual).success)return false;
  const left=new Map(planned?.map(value=>[value.moduleId,value.workflowId])),right=new Map(actual?.map(value=>[value.moduleId,value.workflowId]));
  return moduleIds.every(moduleId=>left.get(moduleId)===right.get(moduleId));
}

/** 公开节点的显式选择必须与冻结模块绑定一致；缺省并不声称已核实“当前首项”。 */
export function validateTaskWorkflowSelections(selections:readonly WorkflowSelection[]|undefined,modules:readonly {moduleId:string;workflow:{kind:'module'|'general';id:string}}[]):void{
  validateWorkflowSelections(modules.map(module=>module.moduleId),selections);
  for(const selection of selections??[]){const module=modules.find(value=>value.moduleId===selection.moduleId)!;if(module.workflow.kind!=='module'||module.workflow.id!==selection.workflowId)fail('WORKFLOW_SELECTION_INVALID','任务显式 Workflow 选择与已冻结模块流程不一致')}
}
