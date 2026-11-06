/**
 * 作用定位：内部 Loop 的统一工具授权策略，同时处理业务文件与正式知识写入。
 * 设计原因：权限来自可信运行配置，副作用来自已注册工具；模型参数不能提高权限。
 * 职责边界：原生路径检查先于人工确认；未知命令范围不被描述为沙箱隔离。
 */
import type {ChatPermission} from './types';
import type {ToolCall,ToolDecision,ToolEffect} from '../tools/types';

/** 已由调度层识别和解析的调用；不接受模型自行声明 effects 或权限。 */
export interface RunToolDescriptor {effects:readonly ToolEffect[];native:boolean}
export interface RunPolicyContext {
  workspaceId:string;permission:ChatPermission;
  /** 平台强制边界不可由“本次全部通过”跳过。 */
  guard(call:ToolCall):Promise<ToolDecision>;
  approve?(call:ToolCall):Promise<ToolDecision>;
}
/** 每次调用独立评估；审批缓存由运行所有者清理，本策略不持久化授权。 */
export async function authorizeRunTool(call:ToolCall,tool:RunToolDescriptor,context:RunPolicyContext):Promise<ToolDecision>{
  const scope={kind:tool.effects.includes('command')?'unknown' as const:tool.effects.includes('knowledge-write')?'knowledge' as const:'workspace' as const,workspaceId:context.workspaceId};
  const decision=(allow:boolean,reason?:string):ToolDecision=>({allow,reason,effects:tool.effects,scope});
  const writes=tool.effects.some(e=>['business-write','knowledge-write','command'].includes(e));
  if(writes&&context.permission==='read')return decision(false,'本轮为只读模式，禁止业务写入、知识写入与命令执行');
  if(tool.native){const guarded=await context.guard(call);if(!guarded.allow)return decision(false,guarded.reason)}
  if(writes&&context.permission==='ask'){
    if(!context.approve)return decision(false,'审批通道不可用');
    const approved=await context.approve(call);return decision(approved.allow,approved.reason);
  }
  return decision(true,writes?'本轮执行权限允许此操作':'本轮允许只读、预览及维护查询');
}
