/**
 * 作用定位：模块责任控制面四项工具的纯名称、效果及业务工作分类，供授权与周期收口共用。
 * 设计原因：责任提交必须审批并保留写入时序，但单独登记责任不等同派发业务；只为精确工具和范围设例外，不弱化其他知识写入。
 */
import type {ToolReceipt} from '../tools/types';

export const moduleOwnershipToolEffects={
  cbim_module_owner_inspect:'read',
  cbim_module_owner_change_preview:'preview',
  cbim_module_owner_change_commit:'knowledge-write',
  cbim_module_owner_receipt:'read',
} as const;
export type ModuleOwnershipToolName=keyof typeof moduleOwnershipToolEffects;
export const moduleOwnershipToolPrefix='cbim_module_owner_';
/** 只识别已定义的四项工具，不把相同前缀视作执行授权。 */
export function isModuleOwnershipToolName(name:string):name is ModuleOwnershipToolName{return Object.hasOwn(moduleOwnershipToolEffects,name)}
/** 控制面回执仍是知识写入；本判断只避免纯责任会话被强制当成业务目标，不能用于排除副作用。 */
export function isModuleOwnershipControlReceipt(receipt:ToolReceipt,workspaceId:string){
  return receipt.toolName==='cbim_module_owner_change_commit'&&receipt.workspaceId===workspaceId&&receipt.scope.kind==='knowledge'&&receipt.scope.workspaceId===workspaceId&&receipt.effects.length===1&&receipt.effects[0]==='knowledge-write';
}
