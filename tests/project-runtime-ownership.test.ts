import type { MainTaskCommands } from '../src/framework/office/office';
import { expect, test } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ProjectList } from '../src/logic/projects/project';
import { Paths } from '../src/logic/projects/paths';

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
    let main!: MainTaskCommands;
    let otherMain!: MainTaskCommands;
    const events: string[] = [];
    const factory = { parameters: 0, CreateEngine: async () => ({ session: {}, Close: async () => {} }) };
    await first.OpenMainAgent(factory, (_, port) => {
      main = port;
      return task => {
        events.push(task.id + ':' + task.state);
        if (task.id === 'bad' && task.state === 'suspended') port.Cancel(task.id);
      };
    });
    await sibling.OpenMainAgent(factory, (_, port) => { otherMain = port; return () => {}; });
    const request = { memberId: role, workspaceInstanceId: left.instanceId, goal: 'review' };
    expect(() => otherMain.DispatchTask(request, async () => {})).toThrow();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const work = main.DispatchTask(request, async (task, agent, desk) => {
      expect([task.goal, agent.id, desk.instanceId]).toEqual(['review', mine.id, left.instanceId]);
      await gate;
    });
    const queued = main.DispatchTask(request, async () => 'next');
    const independent = main.DispatchTask({ workspaceInstanceId: left.instanceId, goal: 'coordinate', parentTaskId: work.id }, async () => 'ready');
    expect(await independent.done).toBe('ready');
    expect(first.ListTasks().map(t => t.state)).toEqual(['running', 'queued', 'completed']);
    expect(sibling.ListTasks()).toEqual([]);
    main.Cancel(queued.id);
    await expect(queued.done).rejects.toThrow();
    release();
    await work.done;
    const node = (id: string, dependsOn: string[] = [], memberId?: string) => ({
      id, dependsOn, memberId, goal: id, workspaceInstanceId: left.instanceId,
    });
    const before = first.ListTasks();
    for (const invalid of [[node('A', ['missing'])], [node('A', ['B']), node('B', ['A'])], [node('A'), node('A')]]) {
      expect(() => main.SubmitTaskGraph(invalid, async () => {})).toThrow();
      expect(first.ListTasks()).toEqual(before);
    }
    expect(() => otherMain.SubmitTaskGraph([node('A')], async () => {})).toThrow();
    let finishBranch!: () => void;
    const holdBranch = new Promise<void>(resolve => { finishBranch = resolve; });
    const calls: string[] = [];
    const [join, branch, other, rootTask] = main.SubmitTaskGraph([
      node('D', ['B', 'C']), node('B', ['A'], role), node('C', ['A']), node('A'),
    ], async task => {
      calls.push(task.id);
      if (task.id === 'B') await holdBranch;
    });
    await rootTask.done;
    await other.done;
    expect(calls[0]).toBe('A');
    expect(calls.slice(1).sort()).toEqual(['B', 'C']);
    expect(first.ListTasks().find(t => t.id === join.id)?.state).toBe('waiting');
    finishBranch();
    await Promise.all([join.done, branch.done]);
    expect(calls.at(-1)).toBe('D');
    const attempted: string[] = [];
    const failed = main.SubmitTaskGraph([
      node('bad'), node('child', ['bad']), node('grandchild', ['child']), node('separate', [], role),
    ], async task => {
      attempted.push(task.id);
      if (task.id === 'bad') throw Error('failure');
    });
    await Promise.allSettled(failed.map(handle => handle.done));
    expect(attempted.sort()).toEqual(['bad', 'separate']);
    expect(first.ListTasks().slice(-4).map(task => task.state)).toEqual(['cancelled', 'blocked', 'blocked', 'completed']);
    let finishOld!: () => void;
    const old = new Promise<void>(resolve => { finishOld = resolve; });
    const retry = main.DispatchTask(request, async (task, agent) => {
      if (task.attempt === 1) { await old; return 'stale'; }
      expect(agent.id).toBe(first.mainAgentId);
      return task.instruction;
    });
    await Promise.resolve();
    main.Suspend(retry.id, 'needs review');
    main.Reassign(retry.id, left.instanceId);
    main.Resume(retry.id, 'approved');
    finishOld();
    expect(await retry.done).toBe('approved');
    expect(events).toContain('bad:suspended');
    const closing = main.DispatchTask(request, async (_task, _agent, _desk, signal) => {
      await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
    });
    await Promise.resolve();
    await first.Close();
    await expect(closing.done).rejects.toThrow();
    expect(() => main.Resume(retry.id)).toThrow();
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
