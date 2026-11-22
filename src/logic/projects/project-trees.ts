/**
 * 作用定位：当前项目唯一的组织、业务及岗位设置存储。旧用户目录仅供首次导入，不做双写。
 * 设计原因：项目快照可迁移，旧文件仅作导入。
 */
import type { ProjectCache } from './project-cache';

import fs from 'node:fs/promises';

import path from 'node:path';

import { atomic } from '../../core/io/text-files';

import { hash } from '../../core/io/serialization';

import type { ProjectResources } from '../../framework/project';

import type { TeamDescription } from '../../framework/cability/team';

import type { WorkspaceTree } from '../../framework/business';

import { z } from 'zod';

import { agentConfigurationSchema } from './agent-configuration';

import { organizationSnapshotSchema, type OrganizationSnapshot, type OrganizationNode } from './organization-contract';

import { businessSnapshotSchema, type BusinessSnapshot } from './business-contract';

export function describeOrganization(snapshot: OrganizationSnapshot): TeamDescription['children']
{
  const children = (parentId: string | null): TeamDescription['children'] => snapshot.nodes.filter(node => node.parentId === parentId).map(node => node.kind === 'team' ? { id: node.id, kind: 'team', name: node.name, position: node.position, children: children(node.id) } : { id: node.id, agentId: node.id, kind: 'agent', name: node.name, position: node.position, ...node.configuration, model: node.configuration?.model ?? { engine: '', profileId: '', modelId: '' }, available: !!node.configuration?.model, reason: node.configuration?.model ? undefined : '岗位尚未绑定执行配置' });

  return children(null);
}

export function describeBusiness(snapshot: BusinessSnapshot): WorkspaceTree
{
  return { roots: snapshot.nodes.filter(node => node.parentId === null).map(node => node.id), nodes: Object.fromEntries(snapshot.nodes.map(node => [node.id, { id: node.id, kind: 'workspace', name: node.name, summary: node.summary, sources: node.sources, virtual: node.virtual, children: snapshot.nodes.filter(child => child.parentId === node.id).map(child => child.id) }])) };
}

function initialOrganization(resources: ProjectResources)
{
  const nodes: OrganizationNode[] = [];

  const visit = (children: TeamDescription['children'], parentId: string | null) => { for (const node of children) { nodes.push(node.kind === 'team' ? { id: node.id, kind: 'team', parentId, name: node.name ?? node.id.split('/').at(-1)!, position: node.position ?? '' } : { id: node.id, kind: 'agent', parentId, name: node.name, position: node.position, configuration: { ...(node.model.engine && { model: node.model }), skills: [...(node.skills ?? [])], connectorIds: [...(node.connectorIds ?? [])] } }); if (node.kind === 'team') visit(node.children, node.id); } };

  visit(resources.organization, null);

  return organizationSnapshotSchema.parse({ revision: 0, nodes });
}

async function optional(file: string)
{
  try
  {
    return JSON.parse(await fs.readFile(file, 'utf8')) as unknown;
  }
  catch (e)
  {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT')
      return undefined;

    throw e;
  }
}

export class ProjectTrees
{
  constructor(private root: string, private cache: ProjectCache)
  {
  }

  private async File(folder: 'cability' | 'bussinss', name: string)
  {
    let target = this.root;

    for (const part of ['.cbim', folder])
    {
      target = path.join(target, part);

      await fs.mkdir(target, { recursive: true });

      const stat = await fs.lstat(target);

      if (!stat.isDirectory() || stat.isSymbolicLink())
        throw Error('项目知识目录不能为链接：' + target);
    }

    target = path.join(target, name);

    const stat = await fs.lstat(target).catch(e => { if (e.code !== 'ENOENT') throw e; });

    if (stat && (!stat.isFile() || stat.isSymbolicLink()))
      throw Error('项目知识文件无效：' + target);

    return target;
  }

  async Organization()
  {
    return organizationSnapshotSchema.parse(await optional(await this.File('cability', 'organization.json')));
  }

  async Business()
  {
    return businessSnapshotSchema.parse(await optional(await this.File('bussinss', 'business.json')));
  }

  async SaveOrganization(value: OrganizationSnapshot)
  {
    await atomic(await this.File('cability', 'organization.json'), JSON.stringify(organizationSnapshotSchema.parse(value), null, 2));
  }

  async SaveBusiness(value: BusinessSnapshot)
  {
    await atomic(await this.File('bussinss', 'business.json'), JSON.stringify(businessSnapshotSchema.parse(value), null, 2));
  }

  async MemberFile(id: string)
  {
    return this.File('cability', 'member-' + hash(JSON.stringify({ kind: 'member', id })) + '.json');
  }

  async Load(readSeeds: (needOrg: boolean, needBiz: boolean) => Promise<ProjectResources>)
  {
    const currentOrg = await optional(await this.File('cability', 'organization.json'));

    const currentBiz = await optional(await this.File('bussinss', 'business.json'));

    const rawOrg = currentOrg === undefined ? await optional(this.cache.legacyOrganization) : currentOrg;

    const rawBiz = currentBiz === undefined ? await optional(this.cache.legacyBusiness) : currentBiz;

    const resources = await readSeeds(rawOrg === undefined, rawBiz === undefined);

    const org = rawOrg === undefined ? initialOrganization(resources) : organizationSnapshotSchema.parse(rawOrg);

    const nodes = Object.values(resources.business.nodes);

    const biz = businessSnapshotSchema.parse(rawBiz === undefined ? { revision: 0, nodes: nodes.map(n => ({ id: n.id, name: n.name, summary: n.summary, virtual: n.virtual ?? false, sources: n.sources, parentId: nodes.find(p => p.children.includes(n.id))?.id ?? null })) } : rawBiz);

    const roles = structuredClone(org);

    for (const node of roles.nodes.filter(n => n.kind === 'agent'))
    {
      const file = await this.MemberFile(node.id);

      let saved = await optional(file);

      if (saved === undefined && currentOrg === undefined)
      {
        saved = await optional(this.cache.LegacyMember(node.id));

        if (saved !== undefined)
          await atomic(file, JSON.stringify(z.object({ revision: z.number().int().nonnegative(), configuration: agentConfigurationSchema }).parse(saved)));
      }

      if (saved !== undefined)
        node.configuration = z.object({ configuration: agentConfigurationSchema }).parse(saved).configuration;
    }

    if (currentOrg === undefined)
      await this.SaveOrganization(org);

    if (currentBiz === undefined)
      await this.SaveBusiness(biz);

    return { ...resources, organization: describeOrganization(roles), business: describeBusiness(biz) };
  }
}
