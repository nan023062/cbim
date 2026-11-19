/** Project definitions shared by the offices of one registered local project. */
import type { CbimRuntime } from '../../framework/cbim-runtime';
import type { TeamDescription } from '../../framework/cability/team';
import type { Workspace } from '../workspace/service/workspace';
import type { WorkspaceMembers } from '../team/service/workspace-members';
import { workspaceMemberEngine } from '../team/rules/workspace-member';

export async function openProjectOffice(runtime: CbimRuntime, workspace: Workspace, sessionId: string, members?: WorkspaceMembers, requireBusinessTree = false)
{
  const [snapshot, organization] = await Promise.all([workspace.Snapshot(), readProjectOrganization(workspace, members)]);
  workspace.Assert();
  if (requireBusinessTree && !snapshot.validation?.structural)
    throw new Error('Opening a workstation requires a valid project tree');
  const office = runtime.OpenOffice(workspace.entry.id, sessionId);
  if (snapshot.validation?.structural) office.project.UpdateTree(snapshot.validation.tree);
  office.members.SetMembers(organization.children);
  return office;
}

export async function readProjectOrganization(workspace: Workspace, members?: WorkspaceMembers, unsupportedBudget = false)
  {
    workspace.Assert();

    if (!members)
      return { children: [], items: [], reason: '当前宿主没有已配置的 Agent 目录' };

    const teams = new Map<string, Extract<TeamDescription['children'][number],
      {
        kind: 'agent'
      }>[]>();

    const items:
      {
        id: string;

        name: string;

        model:
        {
          engine: string;

          profileId: string;

          modelId: string
        };

        available: boolean;

        reason?: string
      }[] = [];

    let offset = 0,
      cursor: Awaited<ReturnType<WorkspaceMembers['List']>>['registryCursor'] | undefined;

    do
    {
      const page = await members.List({ workspaceId: workspace.entry.id, instanceId: workspace.instanceId, offset, ...(cursor ? { expectedRegistryCursor: cursor } : {}) });

      cursor = page.registryCursor;

      for (const item of page.items)
      {
        const detail = await members.Get({ workspaceId: workspace.entry.id, instanceId: workspace.instanceId, memberId: item.memberId }),
          policy = detail.member.runtimePolicy,
          model = { engine: workspaceMemberEngine(policy) ?? 'pi', profileId: policy.profileId, modelId: policy.modelId };

        const reason = item.state !== 'active' ? 'Agent 已暂停或退役' : detail.currentDiff.capability.status !== 'same' || detail.currentDiff.model.status !== 'same' ? '配置变化，需要先核实采纳' : unsupportedBudget ? '当前预算模式不能可靠计量子调用' : undefined;

        const children = teams.get(item.teamId) ?? [];

        teams.set(item.teamId, children);

        children.push({ kind: 'agent', id: item.memberId, agentId: item.agentId, name: detail.member.name, position: item.position, model, available: !reason, reason });

        items.push({ id: item.memberId, name: item.name, model, available: !reason, ...(reason ? { reason } : {}) });
      }

      if (page.nextOffset === undefined)
        break;

      offset = page.nextOffset;
    }
    while (true);

    const children = [...teams].map(([id, children]) => ({ kind: 'team' as const, id, children }));

    workspace.Assert();
    return { children, items };
  }
