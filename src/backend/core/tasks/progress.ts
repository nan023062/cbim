/**
 * 作用定位：单 Agent 执行计划及交付候选的领域状态，独立于 Pi、磁盘和界面。
 * 设计原因：目标与步骤修订必须留痕；工具成功只能作为可追溯证据，不能由模型自行签发业务验收。
 */
export interface TaskStep {
  id:string;
  title:string;
  /** 执行责任描述，不代表已认证的真人身份或实际多 Agent 派发。 */
  owner:string;
  state:'pending'|'working'|'reported_done';
  /** 仅允许引用本轮、最近一次副作用之后的成功工具回执。 */
  evidence:string[];
}
/** 程序按真实回执产生的 Workflow 条件结果；工具名称命中不等于专业语义或逐文件验收。 */
export interface WorkflowEvidenceProof {
  version:1;
  /** 当前所有模块约定的稳定指纹，禁止借另一流程的命中结果交付。 */
  bindingsHash:string;
  checks:Array<{moduleId:string;workflowId:string;workflowVersion:string;requirementId:string;toolName:string;toolCallIds:string[]}>;
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
