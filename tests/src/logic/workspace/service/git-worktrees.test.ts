import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';
import { fixture } from '../../application/support/helpers';
import { seedTeam } from '../../knowledge/service/support/team-fixture';

it('同办公室并发打开共用真实 worktree，不同办公室隔离，重新打开保留修改', async () => {
  const f = await fixture();
  const git = (...args: string[]) => promisify(execFile)('git', ['-C', f.a, ...args]);
  try {
    await git('init');
    await fs.mkdir(path.join(f.a, 'Art'));
    await fs.writeFile(path.join(f.a, 'Art', 'model.txt'), 'original');
    await git('add', 'Art');
    await git('-c', 'user.name=test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-m', 'initial');
    const entry = await f.app.Dispatch('add', { path: f.a });
    const { input, child } = await seedTeam(f.app.Workspace(entry.id));
    const open = (office: string, node = input.moduleId, relative = 'Art') => f.app.OpenWorkspaceInstance(entry.id, office, node, relative);
    let updates = 0, liveWorkspaces = -1;
    const cancel = f.app.monitor.Subscribe(snapshot => { updates++; liveWorkspaces = snapshot.counts.workspaces; });
    expect(liveWorkspaces).toBe(0);
    const [first, second, other] = await Promise.all([open('a'), open('a', child, '.'), open('b')]);
    expect(f.app.monitor.GetSnapshot().counts).toMatchObject({ offices: 2, workspaces: 3, engines: 0 });
    expect(f.app.monitor.GetSnapshot().host?.rssBytes).toBeGreaterThan(0);
    expect(liveWorkspaces).toBe(3);
    expect(first.directory).toBe(path.join(second.directory, 'Art'));
    expect(first.directory).not.toBe(other.directory);
    const file = (dir: string) => path.join(dir, 'model.txt');
    await fs.writeFile(file(first.directory), 'draft');
    expect(await fs.readFile(file(other.directory), 'utf8')).toBe('original');
    expect(await fs.readFile(file(path.join(f.a, 'Art')), 'utf8')).toBe('original');
    await Promise.all([first.Close(), second.Close(), other.Close()]);
    expect(f.app.monitor.GetSnapshot().counts.workspaces).toBe(0);
    expect(liveWorkspaces).toBe(0);
    cancel();
    const before = updates;
    const reopened = await open('a');
    expect(await fs.readFile(file(reopened.directory), 'utf8')).toBe('draft');
    await reopened.Close();
    expect(updates).toBe(before);
    await expect(open('a', child, '../')).rejects.toThrow();
    expect((await git('worktree', 'list', '--porcelain')).stdout.match(/^worktree /gm)).toHaveLength(3);
  } finally {
    await f.cleanup();
  }
});
