/**
 * 自动兜底单独冻结 fallbackBinding；仅无模块分支容许 cbim:project 的空维护清单，不伪造人工确认。
 * 显式executionScope的全模块一致性在准备与恢复共用校验；约定只限制原权限，不能扩大权限或自动升级旧快照。
 * 作用定位：成员业务执行所需的可持久化知识快照，以及存储与调度共用的完整性校验。
 * 设计原因：实际运行须冻结岗位适配及角色/Skill、模块和流程正文；能力 hash 必须对应原采纳岗位，避免重算上下文指纹掩盖未采纳内容，Core 不反向依赖调度实现。
 * 职责边界：这是执行知识而非权限快照，不含模型凭据；指纹只能证明内容一致，不能代替知识来源、权限和产物基线复核。
 * 历史维护字段仅兼容原记录；新执行资格不再依赖真人，岗位责任和冻结身份校验继续生效。
 * 机制边界：对象递归排序由 utility 提供，本模块保留历史比较器、字段省略和业务指纹规则。
 */
import {orderJsonValue} from '../../../foundations/utility';
import {automaticExecutionBindingSchema,automaticExecutionBindingMatches,type AutomaticExecutionBinding} from '../team/automatic-execution';
import {z} from 'zod';
import {hash} from '../foundation/serialization';
import {fail} from '../foundation/errors';
import type {AgentConfigurationSnapshot} from '../team/agent-types';
import type {ModuleBinding} from './graph-types';
import {parseWorkflowContract,workflowContractSchema,type WorkflowContract} from '../workspace/workflow-contract';
import {preparedArtifactScopes} from '../workspace/artifact-scope';
import {preparedExecutionScope} from '../workspace/execution-scope';
import {ownerExecutionBindingSchema,ownerExecutionBindingMatches,type OwnerExecutionBinding} from '../team/member-execution-binding';
import {workspaceMemberAdaptationSchema,type WorkspaceMemberAdaptation} from '../team/workspace-member';
import {workspaceMemberCapabilityHash} from '../team/workspace-member-rules';

/** 模块绑定与正文保持一一对应；通用流程也保存实际采用的正文，不借用其他模块流程。 */
export interface PreparedDispatchModule {
  binding:ModuleBinding;
  definition:Record<string,unknown>;
  overview:string;
  workflowText:string;
  /** 同一正文的可选程序约定；无声明不补默认规则，保存后必须与正文解析完全一致。 */
  workflowContract?:WorkflowContract;
}
/** 每份约定保留自己的模块与 Workflow 身份；合并检查不意味着证据具有逐模块覆盖能力。 */
export interface WorkflowContractBinding {moduleId:string;workflowId:string;workflowVersion:string;contract:WorkflowContract}
/** 从已经冻结的执行知识提取全部有效约定，不读取最新知识或继承父模块。 */
export function preparedWorkflowContracts(prepared:PreparedDispatchKnowledge):WorkflowContractBinding[]{return prepared.modules.flatMap(module=>module.workflowContract?[{moduleId:module.binding.moduleId,workflowId:module.binding.workflow.id,workflowVersion:module.binding.workflow.version,contract:structuredClone(module.workflowContract)}]:[])}
/** 后端内部的完整执行知识；不得整体放进公开任务图、全局监控或模型配置返回值。 */
export interface PreparedDispatchKnowledge {
  version:1;
  workspaceId:string;
  knowledgeRevision:string;
  agent:AgentConfigurationSnapshot;
  /** 自定义角色保存真实定义；内置角色保存明确标为 builtin 的定义，不伪造知识文件。 */
  agentDefinition:Record<string,unknown>;
  modules:PreparedDispatchModule[];
  standards:Array<{id:string;version:string;text:string}>;
  /** 岗位适配只加入这次冻结上下文，不改通用 Agent；旧执行缺省保留原状。 */
  memberContext?:{binding:OwnerExecutionBinding;name:string;position:string;adaptation:WorkspaceMemberAdaptation};
  /** 除本字段外所有冻结内容的稳定 JSON SHA-256；没有授权含义。 */
  /** 自动兜底不制造岗位适配；完整保留原模型、范围和原因。 */
  fallbackBinding?:AutomaticExecutionBinding;
  fingerprint:string;
}

const id=z.string().min(1).max(512).refine(value=>value.trim()===value&&!/[\x00-\x1f]/.test(value));
const text=z.string().min(1).max(2*1024*1024).refine(value=>!!value.trim());
const jsonValue:z.ZodType<unknown>=z.lazy(()=>z.union([z.null(),z.string(),z.number().finite(),z.boolean(),z.array(jsonValue),z.record(jsonValue)]));
const definition=z.record(jsonValue);
const moduleBinding=z.object({moduleId:id,name:text,knowledgeRevision:id,maintenanceBindingId:id.optional(),maintainerPersonIds:z.array(id).optional(),workflow:z.discriminatedUnion('kind',[
  z.object({kind:z.literal('module'),id,version:id}).strict(),
  z.object({kind:z.literal('general'),id,version:id,reason:text}).strict(),
])}).strict();
const shape=z.object({version:z.literal(1),workspaceId:id,knowledgeRevision:id,
  agent:z.object({workspaceId:id,teamId:id,agentId:id,knowledgeRevision:id,name:text,source:z.enum(['builtin','workspace']),principles:text,
    effectiveSkills:z.array(z.object({skillId:id,ownerId:id,inherited:z.boolean(),content:text}).strict()),
  }).strict(),agentDefinition:definition,
  modules:z.array(z.object({binding:moduleBinding,definition,overview:text,workflowText:text,workflowContract:workflowContractSchema.optional()}).strict()).min(1).max(100),
  standards:z.array(z.object({id,version:id,text}).strict()).min(1),memberContext:z.object({binding:ownerExecutionBindingSchema,name:z.string().min(1).max(100),position:z.string().min(1).max(500),adaptation:workspaceMemberAdaptationSchema}).strict().optional(),fallbackBinding:automaticExecutionBindingSchema.optional(),fingerprint:z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

/** 为序列化字段排序，数组顺序仍有业务含义；调用者须先保证输入为可序列化快照。 */
/** 保留本模块历史键排序与 undefined 规则；utility 只提供递归复制机制。 */
const ordered=(value:unknown):unknown=>orderJsonValue(value,{compareKeys:(a,b)=>a<b?-1:a>b?1:0,omitUndefinedProperties:false});
/** 创建或复核指纹；仅排除根 fingerprint，不排除正文中的同名知识字段。 */
export function dispatchKnowledgeFingerprint(value:Omit<PreparedDispatchKnowledge,'fingerprint'>|PreparedDispatchKnowledge):string{
  const {fingerprint:_,...body}=value as PreparedDispatchKnowledge;
  return hash(JSON.stringify(ordered(body)));
}
/**
 * 新提交与恢复共用的结构/指纹校验。失败不回显知识正文，不修改输入，也不授予权限。
 * workspace/角色/模块均须属于同一基线，专属 Workflow 和内置规范的正文须与冻结版本匹配。
 */
export function validatePreparedDispatchKnowledge(value:unknown):asserts value is PreparedDispatchKnowledge{
  const result=shape.safeParse(value);
  if(!result.success)fail('EXECUTION_CONTEXT_INVALID','成员执行知识快照结构无效：'+(result.error.issues[0]?.path.join('.')||'root'));
  const prepared=value as PreparedDispatchKnowledge;
  const invalid=(condition:boolean,reason:string)=>{if(condition)fail('EXECUTION_CONTEXT_INVALID',reason)};
  invalid(prepared.agent.workspaceId!==prepared.workspaceId||prepared.agent.knowledgeRevision!==prepared.knowledgeRevision,'成员与执行知识基线不一致');
  if(prepared.fallbackBinding){const b=prepared.fallbackBinding;invalid(!!prepared.memberContext||!automaticExecutionBindingMatches(b,prepared.workspaceId,b.scopeId,prepared.agent.agentId,prepared.modules.map(m=>m.binding.moduleId))||b.knowledgeRevision!==prepared.knowledgeRevision||b.teamId!==prepared.agent.teamId||b.capabilityHash!==workspaceMemberCapabilityHash(prepared.agent),'自动兜底身份或冻结能力不一致');}
  if(prepared.memberContext){const binding=prepared.memberContext.binding;invalid(!ownerExecutionBindingMatches(binding,prepared.workspaceId,prepared.agent.agentId,prepared.modules.map(module=>module.binding.moduleId))||binding.capability.teamId!==prepared.agent.teamId||workspaceMemberCapabilityHash(prepared.agent)!==binding.capability.capabilityHash,'岗位冻结身份、能力正文或模块与执行知识不一致');}
  invalid(new Set(prepared.modules.map(module=>module.binding.moduleId)).size!==prepared.modules.length,'执行模块不能重复');
  // 各模块声明单独有效仍可能重叠或合计超限；准备时核完整集合，不能领取后再裁剪范围。
  try{preparedArtifactScopes(preparedWorkflowContracts(prepared))}catch{fail('EXECUTION_CONTEXT_INVALID','冻结模块的完整产物范围重叠、数量超限或无效')}
  try{preparedExecutionScope(prepared.modules.map(module=>({contract:module.workflowContract})))}catch{fail('EXECUTION_CONTEXT_INVALID','冻结模块的执行范围混合、冲突或超限')}
  invalid(new Set(prepared.standards.map(standard=>standard.id)).size!==prepared.standards.length,'内置规范不能重复');
  invalid(new Set(prepared.agent.effectiveSkills.map(skill=>skill.skillId)).size!==prepared.agent.effectiveSkills.length,'角色有效 Skill 不能重复');
  invalid(prepared.agentDefinition.name!==prepared.agent.name,'冻结角色定义与角色名称不一致');
  const standardIds=['business-execution','common-rules'];
  invalid(prepared.standards.length!==standardIds.length||!standardIds.every(id=>prepared.standards.some(standard=>standard.id===id)),'内置执行规范清单不完整或不受支持');
  for(const module of prepared.modules){
    invalid(JSON.stringify(ordered(parseWorkflowContract(module.workflowText)))!==JSON.stringify(ordered(module.workflowContract)),'冻结 Workflow 执行约定与正文不一致');
    invalid(module.binding.knowledgeRevision!==prepared.knowledgeRevision||module.definition.id!==module.binding.moduleId,'模块定义与执行知识基线不一致');
    if(module.binding.workflow.kind==='module')invalid(hash(module.workflowText)!==module.binding.workflow.version,'模块 Workflow 正文与冻结版本不一致');
    else {
      invalid(module.binding.workflow.id!=='cbim:general'||module.binding.workflow.version!=='1','不支持的通用任务流程');
      invalid(module.workflowText!==prepared.standards.find(standard=>standard.id==='business-execution')!.text,'通用任务流程正文与内置执行规范不一致');
    }
  }
  for(const standard of prepared.standards)invalid(hash(standard.text)!==standard.version,'内置规范正文与冻结版本不一致');
  invalid(dispatchKnowledgeFingerprint(prepared)!==prepared.fingerprint,'成员执行知识快照指纹不一致');
}
