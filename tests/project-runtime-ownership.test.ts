import { expect, test } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ProjectList } from '../src/logic-new/projects/project';
import { Paths } from '../src/logic-new/projects/paths';

test('project startup loads both trees once, isolates Offices, and retries invalid resources', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cbim-projects-'));
  const projects = new ProjectList(new Paths(root));
  try {
    const entries = ['a', 'b'].map(id => ({ id, name: id, path: path.join(root, id) }));
    await fs.writeFile(path.join(root, 'workspaces.json'), JSON.stringify({ version: 1, entries, recent: [] }));
    const workspace = '.cbim/workspace/site';
    const role = '.cbim/team/design/artist';
    for (const entry of entries) {
      await fs.mkdir(path.join(entry.path, workspace), { recursive: true });
      await fs.mkdir(path.join(entry.path, role), { recursive: true });
      await fs.writeFile(path.join(entry.path, role, 'agent.json'), JSON.stringify({ summary: entry.id }));
    }
    const moduleFile = (id: string) => path.join(root, id, workspace, 'module.json');
    const moduleText = (name: string) => JSON.stringify({ id: workspace, name, summary: name, children: [], sources: [] });
    await fs.writeFile(moduleFile('a'), moduleText('a'));
    await fs.writeFile(moduleFile('b'), 'invalid');
    await expect(projects.Open('b')).rejects.toThrow();
    await fs.writeFile(moduleFile('b'), moduleText('b'));
    const [a, again, b] = await Promise.all(['a', 'a', 'b'].map(id => projects.Open(id)));
    expect(a).toBe(again);
    expect(a.runtime).not.toBe(b.runtime);
    expect(a.runtime.organization?.FindMember(role)?.position).toBe('a');
    expect(b.runtime.project?.FindWorkspace(workspace)?.name).toBe('b');
    expect(() => a.runtime.OpenOffice('b', 'same')).toThrow();
    const first = a.runtime.OpenOffice('a', 'same');
    const second = b.runtime.OpenOffice('b', 'same');
    expect(first.organization.FindMember(role)?.position).toBe('a');
    expect(second.project.FindWorkspace(workspace)?.name).toBe('b');
    expect(new Set(projects.ListOffices())).toEqual(new Set([first, second]));
    const sibling = a.runtime.OpenOffice('a', 'another-session');
    expect(sibling.organization).toBe(first.organization);
    expect(sibling.project).toBe(first.project);
    expect(sibling.project).toBe(a.runtime.project);
    expect(second.organization).not.toBe(first.organization);
    expect(sibling.mainAgentId).not.toBe(first.mainAgentId);
    const artist = first.organization.FindMember(role)!;
    first.organization.ReplaceChildren([{ ...artist, available: true }]);
    const mine = first.members.GetMember(role);
    const theirs = sibling.members.GetMember(role);
    expect(mine.id).not.toBe(theirs.id);
    expect(sibling.FindAgent(mine.id)).toBeUndefined();

    const repo = a.entry.path;
    const git = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], { windowsHide: true });
    git('init', '--quiet');
    git('-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-qm', 'initial');
    const [left, right] = await Promise.all([first, sibling].map(office => office.OpenWorkspace(workspace, repo, '.')));
    expect(left.instanceId).not.toBe(right.instanceId);
    expect(left.directory).not.toBe(right.directory);
    await first.Close();
    expect(left.closed).toBe(true);
    expect(right.closed).toBe(false);
    expect(sibling.FindAgent(theirs.id)).toBe(theirs);
    expect(sibling.organization.FindMember(role)?.available).toBe(true);
    await projects.Close();
    expect(first.closed && second.closed).toBe(true);
    await expect(projects.Open('a')).rejects.toThrow();
  } finally {
    await projects.Close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
