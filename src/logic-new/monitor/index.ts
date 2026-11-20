/** 从当前 Application 持有的运行时读取运行管理页的快照。 */
import { RuntimeMonitor } from '../../framework/monitor';

import type { CbimRuntime } from '../../framework/cbim-runtime';

export function createApplicationMonitor(runtime: Pick<CbimRuntime, 'ListOffices' | 'FindOffice' | 'Subscribe'>)
{
  return new RuntimeMonitor(runtime, () => { const cpu = process.cpuUsage(); return { pid: process.pid, rssBytes: process.memoryUsage.rss(), cpuMicros: cpu.user + cpu.system }; });
}
