/** 能力层的节点技能声明与继承规则。组织关系由调用方提供。 */
import type { SkillDefinition } from '../skills';

export type { SkillDefinition } from '../skills';

/** 岗位采纳时固定的技能正文与定义来源。 */
export interface EffectiveSkill
{
  skillId: string;

  ownerId: string;

  inherited: boolean;

  content: string;
}

/** 从 Agent 叶子到根团队逐级收集声明，记录每项技能的实际所属节点。 */
export class SkillScope
{
  private constructor()
  {
  }

  public static Resolve(agentId: string, inventories: ReadonlyMap<string, readonly SkillDefinition[]>, parentTeam: (id: string) => string | undefined)
  {
    const chain: string[] = [];

    const entries: (SkillDefinition &
    {
      owner: string;

      scope: 'agent' | 'team'
    })[] = [];

    const visited = new Set<string>();

    for (let owner: string | undefined = agentId; owner !== undefined; owner = parentTeam(owner))
    {
      if (visited.has(owner))
        throw new Error('Skill 所属组织存在循环');

      visited.add(owner);

      chain.push(owner);

      for (const skill of inventories.get(owner) ?? [])
        entries.push({ ...skill, owner, scope: owner === agentId ? 'agent' : 'team' });
    }

    return { chain, entries };
  }
}
