import type { AgentConfigurationSnapshot } from './identity';

export interface AgentDescription
{
  id: string;

  name: string;

  position: string;

  principles: string;

  instructions: string;

  references: readonly string[];

  effectiveSkills: ReadonlyArray<Readonly<AgentConfigurationSnapshot['effectiveSkills'][number]>>;

  /** 已解析、无凭据的执行选择；不允许子调用静默使用另一个模型。 */
  model?: Readonly<
    {
      engine: string;

      profileId: string;

      modelId: string
    }>;
}

/** 旧调用可以仅提供指令；新岗位装配必须提供完整描述。 */
export type AgentDefinition = Omit<AgentDescription, 'position' | 'principles' | 'references' | 'effectiveSkills'> & Partial<Pick<AgentDescription, 'position' | 'principles' | 'references' | 'effectiveSkills'>>;

export function agentRoleInstructions(role: AgentDefinition): string
{
  const sections = [role.position && '岗位职责：' + role.position, role.principles, role.instructions];

  if (role.references?.length)
    sections.push('岗位参考：\n' + role.references.join('\n'));

  for (const skill of role.effectiveSkills ?? [])
    sections.push('技能 ' + skill.skillId + '\n' + skill.content);

  return sections.filter(Boolean).join('\n\n');
}

/** 只从本次运行已采纳的岗位快照取技能，避免读取更新后的目录或其他岗位的配置。 */
export function readRoleSkill(role: AgentDefinition, skillId: string)
{
  const skill = role.effectiveSkills?.find(item => item.skillId === skillId);

  if (!skill)
    throw new Error('当前岗位没有采用该技能');

  return skill;
}
