/**
 * 目录归属：backend/core/tools/policy；工具契约与授权策略。

 * 范围读取和固定Node须精确匹配注册效果及版本；Node继续按command执行read拒绝/ask批准，不因LPAC隔离获得额外权限。
 * 受控文件边界：精确内部 business-write/workspace 能力沿同一批准策略；平台独立再次核实完整路径，不借 native:false 绕过权限。
 * 作用定位：内部 Loop 的统一工具授权策略，同时处理业务文件与正式知识写入。
 * 设计原因：权限来自可信运行配置，副作用、契约版本和仓库范围来自已注册工具的捕获描述；模型参数不能提高权限或把外部资料冒充项目文件。
 * 职责边界：原生路径检查先于人工确认；模块负责人四工具须精确匹配知识范围与效果，提交沿 read/ask/execute 门禁。产物验证只接受准确名称和 read 效果；未知命令范围不被描述为沙箱隔离。
 * 反馈边界：只有桌面明确连接并允许自动提交的精确 GitHub 范围可免逐条 ask；read 仍拒绝外部写。独立状态查询严格限制为工作区只读，不需要也不产生连接授权。
 * 岗位边界：只识别已声明的四项主岗位工具，知识范围与固定效果一致；预览不授予提交权限。
 */
import type {ChatPermission} from './types';
import type {ToolCall,ToolDecision,ToolEffect,ToolScope} from '../types';
import {toolScopeSchema} from '../scope-schema';
import {governanceToolEffects,isGovernanceToolName} from '../../governance/module-governance-tools';
import {isModuleOwnershipToolName,moduleOwnershipToolEffects,moduleOwnershipToolPrefix} from '../../workspace/module-ownership-tool-policy';
import {memberToolEffects,type MemberToolName} from '../../team/workspace-member-tools';
import {isDeepStrictEqual} from 'node:util';
import type {FeedbackScope} from '../../../../logic/feedback';

/** 已由调度层识别和解析的调用；不接受模型自行声明 effects 或权限。 */
export interface RunToolDescriptor {effects:readonly ToolEffect[];native:boolean;
  /** 实际注册表的契约版本，仅供可信运行边界记录；缺省表示旧/未声明协议，不从模型参数补齐。 */
  contractVersion?:number;
  /** 仅可信装配提供；仓库分支须绑定实际注册操作、链接器和工作区，不由模型填写。 */
  scope?:ToolScope;
}
export interface RunPolicyContext {
  workspaceId:string;permission:ChatPermission;
  /** 平台强制边界不可由“本次全部通过”跳过。 */
  guard(call:ToolCall):Promise<ToolDecision>;
  approve?(call:ToolCall):Promise<ToolDecision>;
  /** 来自桌面设置和本轮端口的窄授权；不存在时，任何 external-write 都拒绝。 */
  feedbackGrant?:FeedbackScope;
}
/** 每次调用独立评估；审批缓存由运行所有者清理，本策略不持久化授权。 */
export async function authorizeRunTool(call:ToolCall,tool:RunToolDescriptor,context:RunPolicyContext):Promise<ToolDecision>{
  const governance=call.name.startsWith('cbim_governance_'),ownership=call.name.startsWith(moduleOwnershipToolPrefix),member=call.name.startsWith('cbim_member_change_')||['cbim_member_inspect','cbim_member_receipt'].includes(call.name);
  let scope:ToolScope={kind:governance||ownership||member||tool.effects.includes('command')?'unknown':tool.effects.includes('knowledge-write')?'knowledge':'workspace',workspaceId:context.workspaceId};
  const decision=(allow:boolean,reason?:string):ToolDecision=>({allow,reason,effects:tool.effects,scope});
  if(call.name.startsWith('cbim_scoped_')&&(!['cbim_scoped_read','cbim_scoped_node'].includes(call.name)||tool.native||tool.effects.length!==1||tool.effects[0]!== (call.name==='cbim_scoped_read'?'read':'command')||tool.contractVersion!==1))return decision(false,'范围工具缺少本轮真实注册或副作用分类不一致');
  // 内部受控写不经过 native guard，必须由实际成员工厂分类且平台独立检查完整路径。
  if(call.name.startsWith('cbim_file_')&&(call.name!=='cbim_file_write_controlled'||tool.native||tool.effects.length!==1||tool.effects[0]!=='business-write'||tool.scope?.kind!=='workspace'))return decision(false,'受控文件写缺少本轮真实注册或业务写作用域');
  // 验证只读固定文件，注册与参数由正式成员装配核对；不得借此名称要求命令或知识写入。
  if(call.name.startsWith('cbim_validation_')&&(call.name!=='cbim_validation_run'||tool.native||tool.effects.length!==1||tool.effects[0]!=='read'))return decision(false,'产物验证工具必须是本轮实际注册的只读能力');
  // 这四项由真实主运行注册；保存私有观察/提案不等于正式知识写入，也不能伪装为业务文件读取。
  if(governance&&(!isGovernanceToolName(call.name)||tool.native||tool.effects.length!==1||tool.effects[0]!==governanceToolEffects[call.name]||tool.scope?.kind!=='knowledge'))return decision(false,'治理工具缺少本轮真实注册的知识作用域或效果不一致');
  // 责任治理只允许实际主运行注册的固定效果；read/preview 不因知识范围自动获得写权。
  if(ownership&&(!isModuleOwnershipToolName(call.name)||tool.native||tool.effects.length!==1||tool.effects[0]!==moduleOwnershipToolEffects[call.name]||tool.scope?.kind!=='knowledge'))return decision(false,'模块责任工具缺少本轮真实知识范围或效果不一致');
  if(member&&(!Object.hasOwn(memberToolEffects,call.name)||tool.native||tool.effects.length!==1||tool.effects[0]!==memberToolEffects[call.name as MemberToolName]||tool.scope?.kind!=='knowledge'))return decision(false,'岗位工具缺少本轮真实知识范围或效果不一致');
  if(call.name.startsWith('cbim_repository_')&&tool.scope?.kind!=='repository')return decision(false,'仓库工具缺少本轮可信捕获范围');
  const feedbackStatus=call.name==='cbim_feedback_status';
  if(feedbackStatus&&(tool.native||tool.contractVersion!==1||tool.effects.length!==1||tool.effects[0]!=='read'||tool.scope?.kind!=='workspace'))return decision(false,'反馈状态查询必须是本轮注册的工作区只读工具');
  const feedback=call.name.startsWith('cbim_feedback_')&&!feedbackStatus;
  if(feedback||tool.effects.includes('external-write')||tool.scope?.kind==='github-feedback'){
    if(!['cbim_feedback_submit','cbim_feedback_receipt'].includes(call.name)||tool.native||tool.contractVersion!==1||tool.effects.length!==1||tool.effects[0]!== (call.name==='cbim_feedback_submit'?'external-write':'read')||!context.feedbackGrant||!isDeepStrictEqual(tool.scope,context.feedbackGrant))return decision(false,'GitHub 反馈缺少本轮明确授权的固定目标');
  }
  if(tool.scope!==undefined){
    const captured=toolScopeSchema.safeParse(tool.scope);
    if(!captured.success||captured.data.workspaceId!==context.workspaceId)return decision(false,'工具捕获范围与本轮工作区不一致');
    if(governance||ownership||member){
      if(captured.data.kind!=='knowledge')return decision(false,'治理工具必须使用本轮知识作用域');
      scope=captured.data;
    }else if(captured.data.kind==='github-feedback'){
      scope=captured.data;
    }else if(captured.data.kind==='repository'){
      if(tool.native||tool.effects.length!==1||tool.effects[0]!=='read'||call.name!==`cbim_repository_${captured.data.operation}`||call.input.connectorId!==captured.data.connectorId)return decision(false,'仓库工具仅允许真实已捕获目标的只读操作');
      scope=captured.data;
    }else if(captured.data.kind!==scope.kind)return decision(false,'工具范围与真实副作用分类不一致');
  }
  const writes=tool.effects.some(e=>['business-write','knowledge-write','external-write','command'].includes(e));
  if(writes&&context.permission==='read')return decision(false,'本轮为只读模式，禁止业务写入、知识写入、外部提交与命令执行');
  if(feedback)return decision(true,'本机已明确允许向捕获的 GitHub 仓库自动提交反馈，或核实原提交');
  if(tool.native){const guarded=await context.guard(call);if(!guarded.allow)return decision(false,guarded.reason)}
  if(writes&&context.permission==='ask'){
    if(!context.approve)return decision(false,'审批通道不可用');
    const approved=await context.approve(call);return decision(approved.allow,approved.reason);
  }
  return decision(true,writes?'本轮执行权限允许此操作':'本轮允许只读、预览及维护查询');
}
