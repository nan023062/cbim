/** 宿主绑定待审批调用到原对话；只在用户选择长期允许时保存对应范围的摘要。 */
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { PendingOfficeApproval, OfficeApprovalChoice } from '../../contracts/discovery';

type Entry = { project: string; session: string; view: PendingOfficeApproval; finish(choice: OfficeApprovalChoice): void };

export class OfficeApprovals {
  private readonly pending = new Map<string, Entry>();
  constructor(private readonly directory: (project: string, session: string) => string) {}

  Request(project: string, session: string, tool: string, input: Record<string, unknown>, root: string, signal: AbortSignal): Promise<boolean> {
    signal.throwIfAborted();
    const change = input.change as Record<string, unknown> | undefined;
    const group = tool === 'cbim_project_write' && typeof input.resource === 'string' && typeof change?.action === 'string'
      ? [input.resource, change.action] : undefined;
    const scope = group ? [tool, ...group].join(' / ') : tool + '（相同参数）';
    const digest = createHash('sha256').update(JSON.stringify([root, tool, group ?? input])).digest('hex');
    const dir = this.directory(project, session), file = path.join(dir, digest);
    if (existsSync(file) && readFileSync(file, 'utf8') === 'allow') return Promise.resolve(true);
    const id = randomUUID();
    return new Promise<boolean>((resolve, reject) => {
      const cancel = () => finish('deny');
      const finish = (choice: OfficeApprovalChoice) => {
        if (!this.pending.delete(id)) return;
        signal.removeEventListener('abort', cancel);
        try {
          if (choice === 'always') { mkdirSync(dir, { recursive: true }); writeFileSync(file, 'allow', { mode: 0o600 }); }
          resolve(choice !== 'deny');
        } catch (error) { reject(error); throw error; }
      };
      this.pending.set(id, { project, session, view: { id, tool, root, scope, detail: JSON.stringify(input, null, 2) }, finish });
      signal.addEventListener('abort', cancel, { once: true });
    });
  }

  List(project: string, session: string) {
    return [...this.pending.values()].filter(x => x.project === project && x.session === session).map(x => x.view);
  }

  Decide(project: string, session: string, id: string, choice: OfficeApprovalChoice) {
    const entry = this.pending.get(id);
    if (!entry || entry.project !== project || entry.session !== session) throw Error('此审批已结束或不属于当前对话');
    entry.finish(choice);
  }

  Close() { for (const entry of this.pending.values()) entry.finish('deny'); }
}
