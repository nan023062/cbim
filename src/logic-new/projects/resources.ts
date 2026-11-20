/** 将项目的静态描述装配为 Framework 的启动契约。 */
import path from 'node:path';

import type { ProjectResources } from '../../framework/cbim-runtime';

import type { TeamMember, TeamDescription } from '../../framework/cability/team';

import type { Workspace } from '../../framework/business';

import { readArchitectureFiles } from '../../resource/project-architecture';

export async function readProjectResources(projectId: string, root: string): Promise<ProjectResources>
{
  const { roles, modules } = await readArchitectureFiles(root);

  type Children = (TeamMember | TeamDescription)[];

  const groups = new Map<string, Children>();

  function group(id: string): Children
  {
    const known = groups.get(id);

    if (known)
      return known;

    const children: Children = [];

    groups.set(id, children);

    if (id !== '.cbim/team')
    {
      if (roles.has(id))
        throw Error('Agent 必须位于团队叶子节点 ' + id);

      group(path.posix.dirname(id)).push({ id, kind: 'team', children });
    }

    return children;
  }

  for (const [id, text] of roles)
  {
    const role = JSON.parse(text);

    if (id === '.cbim/team' || typeof role.summary !== 'string')
      throw Error('无效的角色定义 ' + id);

    group(path.posix.dirname(id)).push({
      kind: 'agent', id, agentId: id, name: role.name ?? path.posix.basename(id), position: role.summary,
      model: { engine: '', profileId: '', modelId: '' }, available: false, reason: '岗位尚未绑定执行配置',
    });
  }

  const nodes: Record<string, Workspace> = {};

  const children = new Set<string>();

  for (const [id, text] of modules)
  {
    const data = JSON.parse(text);

    if (data.id !== id || typeof data.name !== 'string' || typeof data.summary !== 'string' ||
      !Array.isArray(data.children) || !Array.isArray(data.sources) ||
      !data.sources.every((s: Workspace['sources'][number]) => s && typeof s.location === 'string' && typeof s.scope === 'string'))
      throw Error('无效的工作区定义 ' + id);

    for (const child of data.children)
    {
      if (!modules.has(child) || path.posix.dirname(child) !== id || children.has(child))
        throw Error('无效的工作区子节点 ' + child);

      children.add(child);
    }

    nodes[id] = { id, kind: 'workspace', name: data.name, summary: data.summary, children: data.children, sources: data.sources };
  }

  const roots = [...modules.keys()].filter(id => !children.has(id));

  for (const id of roots)
    if (modules.has(path.posix.dirname(id)))
      throw Error('父工作区未声明子节点 ' + id);

  return { projectId, organization: group('.cbim/team'), business: { roots, nodes } };
}
