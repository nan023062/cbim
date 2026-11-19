export interface TeamDescription
{
  readonly id: string;

  readonly kind: 'team';

  readonly children: readonly (TeamDescription | TeamMember)[];
}

/** 办公室按工作区岗位登记构造组织视图；同一角色可在不同团队任职。 */
export interface TeamMember
{
  id: string;

  name: string;

  readonly kind: 'agent';

  agentId: string;

  position: string;

  model:
  {
    engine: string;

    profileId: string;

    modelId: string
  };

  available: boolean;

  reason?: string;
}

/** 团队的直属下级可以是子团队，也可以是具体岗位上的 Agent。 */
export class Team
{
  public readonly kind = 'team' as const;

  public readonly children: readonly (Team | TeamMember)[];

  public constructor(public readonly id: string, children: readonly (Team | TeamMember)[])
  {
    if (!children.length)
      throw new Error('团队至少需要一个子节点');

    this.children = Object.freeze(children.map(child => child.kind === 'team' ? child : Object.freeze({ ...child, model: Object.freeze({ ...child.model }) })));

    Object.freeze(this);
  }

  /** 按岗位实例查询；同一角色可以在不同岗位任职。 */
  public FindMember(memberId: string): TeamMember | undefined
  {
    for (const child of this.children)
    {
      if (child.kind === 'team')
      {
        const found = child.FindMember(memberId);

        if (found)
          return found;
      }
      else if (child.id === memberId)
        return child;
    }

    return undefined;
  }
}

