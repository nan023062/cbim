/** 创建由一个 Application 持有的仓库、运行时和监控器。 */
import path from 'node:path';

import { CbimRuntime } from '../../../framework/cbim-runtime';

import { RuntimeMonitor } from '../../../framework/monitor';

import { ResourceRepositories } from '../../../resource/service';

import { GitWorktrees } from '../../workspace/service/git-worktrees';

import type { Paths } from '../../workspace/service/paths';

export function createApplicationInstances(paths: Paths)
{
  const resources = new ResourceRepositories(paths);

  const cbimRuntime = new CbimRuntime(new GitWorktrees(path.join(paths.userRoot, 'worktrees')));

  const monitor = new RuntimeMonitor(cbimRuntime, () => { const cpu = process.cpuUsage(); return { pid: process.pid, rssBytes: process.memoryUsage.rss(), cpuMicros: cpu.user + cpu.system }; });

  return { resources, cbimRuntime, monitor };
}
