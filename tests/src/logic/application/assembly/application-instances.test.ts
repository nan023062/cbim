import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';
import { fixture } from '../support/helpers';
import { seedTeam } from '../../knowledge/service/support/team-fixture';

async function prepareApplication(f: Awaited<ReturnType<typeof fixture>>)
{
  const git = (...args: string[]) => promisify(execFile)('git', ['-C', f.a, ...args]);
  await git('init');
  await git('-c', 'user.name=test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-m', 'initial');
  const entry = await f.app.Dispatch('add', { path: f.a });
  const { input } = await seedTeam(f.app.Workspace(entry.id));
  const location = path.join(f.temp, 'resources');
  await fs.mkdir(location);
  await f.app.resources.Configure({ mode: 'local', location });
  return (session: string) => f.app.OpenWorkspaceInstance(entry.id, session, input.moduleId, '.');
}

it('two offices are visible to one application monitor and retain the application repository', async () => {
  const f = await fixture();
  try {
    const open = await prepareApplication(f);
    const resources = f.app.resources;
    const before = await resources.Read();
    await open('first');
    await open('second');
    expect(f.app.monitor.GetSnapshot().offices.map(office => office.rootSessionId).sort()).toEqual(['first', 'second']);
    expect(f.app.resources).toBe(resources);
    expect(await f.app.resources.Read()).toEqual(before);
  } finally {
    await f.cleanup();
  }
});

it('closing one application leaves the other repository and runtime available', async () => {
  const first = await fixture();
  try {
    const second = await fixture();
    try {
      const openFirst = await prepareApplication(first);
      const openSecond = await prepareApplication(second);
      await openFirst('first-only');
      expect(second.app.monitor.GetSnapshot().counts.offices).toBe(0);
      const before = await second.app.resources.Read();
      expect((await first.app.resources.Read()).repositoryId).not.toBe(before.repositoryId);
      await first.app.Shutdown();
      expect(await second.app.resources.Read()).toEqual(before);
      await openSecond('second-only');
      expect(second.app.monitor.GetSnapshot().offices.map(office => office.rootSessionId)).toEqual(['second-only']);
    } finally {
      await second.cleanup();
    }
  } finally {
    await first.cleanup();
  }
});
