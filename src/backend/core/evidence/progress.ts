/**
 * 目录归属：backend/core/evidence；产物与 Workflow 证据规则。
 * 完整出口另固定原成功清单的范围、内容和事件顺序，候选下游须重建并核当前全集合。
 * 作用定位：单 Agent 执行计划及交付候选的领域状态，独立于 Pi、磁盘和界面。
 * 设计原因：目标与步骤修订必须留痕；JSON 结构出口另存精确文件证明，工具成功或结构通过都不能由模型解释为人工验收。
 */
import type {WorkflowValidationCheck} from './validation';
import type {OutputManifestProof} from './output-manifest';
export interface TaskStep {
  id:string;
  title:string;
  /** 执行责任描述，不代表已认证的真人身份或实际多 Agent 派发。 */
  owner:string;
  state:'pending'|'working'|'reported_done';
  /** 仅允许引用本轮、最近一次副作用之后的成功工具回执。 */
  evidence:string[];
}
/** 程序按真实回执产生的 Workflow 条件结果；产物条件另绑定准确文件字节，二者都不代表人工验收。 */
export interface WorkflowEvidenceProof {
  /** 冻结代码检查与最终完整源码集合的对应证明。 */
  codeCheck?:import('./code-check').CodeCheckProof;
  version:1;
  /** 当前所有模块约定的稳定指纹，禁止借另一流程的命中结果交付。 */
  bindingsHash:string;
  checks:Array<{moduleId:string;workflowId:string;workflowVersion:string;requirementId:string;toolName:string;toolCallIds:string[]}>;
  /** 仅声明了 产物验证时存在；旧流程不补空数组。 */
  validationChecks?:WorkflowValidationCheck[];
  /** 仅明确要求完整出口时存在；固定原完整集合，不能由下游重选未变子集。 */
  manifest?:OutputManifestProof;
}
export interface TaskProgress {
  /** 每次修改递增，工具必须携带期望版本，拒绝覆盖过期计划。 */
  version:number;
  goal:string;
  acceptance:string[];
  steps:TaskStep[];
  state:'executing'|'awaiting_review';
  /** 修订原因和交付限制是模型声明；不能当作已核实事实。 */
  reason:string;
  delivery?:{summary:string;limitations:string[];workflow?:WorkflowEvidenceProof};
}
