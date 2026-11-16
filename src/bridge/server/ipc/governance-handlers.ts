/**
 * 作用定位：模块治理观察、提案、决定与实施的主进程处理器。
 * 设计原因：命令输出按对应回执种类核实；批准和实施分别提交，查询不会重放原事务。请求已在总分派中解析。
 */
import type { ApplicationServices } from './services';

import type { IpcHandlers } from '../../contracts/ipc-call';

import { governanceCommandReceipts, type GovernanceIpcResponses } from '../../contracts/ipc-governance';

/** 仅装配本业务组；每项实际实现都受对应请求／响应约束。 */
export function governanceIpcHandlers(app: ApplicationServices): IpcHandlers<keyof GovernanceIpcResponses>
{
  return {
    'governance.list': async args => { return app.Governance(args.workspaceId).List(args); },

    'governance.receipt': async args => { return app.Governance(args.workspaceId).Lookup(args); },

    'governance.unaccepted': async args => { return app.Governance(args.workspaceId).Unaccepted(args); },

    'governance.register': async args => { return governanceCommandReceipts.register.parse(await app.Governance(args.workspaceId).Register(args, { kind: 'local_desktop', interaction: 'explicit_submit' })); },

    'governance.observe': async args => { return governanceCommandReceipts.observe.parse(await app.Governance(args.workspaceId).Observe(args)); },

    'governance.propose': async args => { return governanceCommandReceipts.propose.parse(await app.Governance(args.workspaceId).Propose(args)); },

    'governance.decide': async args => { return governanceCommandReceipts.decide.parse(await app.Governance(args.workspaceId).Decide(args, { kind: 'local_desktop', interaction: 'explicit_submit' })); },

    'governance.apply': async args => { return governanceCommandReceipts.apply.parse(await app.Governance(args.workspaceId).Apply(args)); },
  };
}
