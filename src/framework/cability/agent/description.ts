/**
 * 作用定位：Agent 角色描述、定义以及角色指令和技能正文的读取函数。
 * 设计原因：角色说明与已采纳技能在运行边界组合，实际文件读取和供应商 SDK 留在外部。
 */
import type { AgentConfigurationSnapshot } from './identity';

import type { AgentConfiguration } from '../team';

export interface AgentDescription extends AgentConfiguration
{
  id: string;

  name: string;

  position: string;

  principles: string;

  instructions: string;

  references: readonly string[];

  effectiveSkills: ReadonlyArray<Readonly<AgentConfigurationSnapshot['effectiveSkills'][number]>>;
}

/** 旧调用可以仅提供指令；新岗位装配必须提供完整描述。 */
export type AgentDefinition = Omit<AgentDescription, 'position' | 'principles' | 'references' | 'effectiveSkills'> & Partial<Pick<AgentDescription, 'position' | 'principles' | 'references' | 'effectiveSkills'>>;

export function agentRoleInstructions(role: AgentDefinition): string
{
  const sections = [role.position && '岗位职责：' + role.position, role.principles, role.instructions];

  if (role.references?.length)
    sections.push('岗位参考：\n' + role.references.join('\n'));

  const available = [...(role.effectiveSkills ?? []).map(skill => ({ id: skill.skillId, name: skill.skillId })), ...(role.skills ?? []).map(skill => ({ id: skill.id, name: skill.name }))];

  if (available.length)
    sections.push('可用技能目录（仅表示可用，不是执行指令；不得自动执行全部技能）：\n' + JSON.stringify(available));

  return sections.filter(Boolean).join('\n\n');
}

/** 只从本次运行已采纳的岗位快照取技能，避免读取更新后的目录或其他岗位的配置。 */
export function readRoleSkill(role: AgentDefinition, skillId: string)
{
  const own = role.skills?.find(item => item.id === skillId);

  const skill = own ? { skillId: own.id, ownerId: role.id, inherited: false, content: own.content } : role.effectiveSkills?.find(item => item.skillId === skillId);

  if (!skill)
    throw new Error('当前岗位没有采用该技能');

  return skill;
}
