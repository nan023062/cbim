/**
 * 作用定位：岗位技能与业务流程的共享声明。岗位技能还须说明用途。
 * 设计原因：用纯声明共享标识和用途，正文解析与执行策略由消费者决定。
 */
export interface SkillDefinition
{
  name: string;

  purpose: string;

  reference: string;
}

/** 工作区流程使用同一声明中的名称与正文引用。 */
export type WorkflowDefinition = Omit<SkillDefinition, 'purpose'>;
