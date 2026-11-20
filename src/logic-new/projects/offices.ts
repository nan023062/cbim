/** 仅为已登记项目打开 Office，将持久会话身份映射到当前运行时实例。 */
import path from 'node:path';
import { OfficeHistory } from '../../resource/office-history';
import type { ProjectList } from './project';

export interface TurnMetrics {
  elapsed: number;
  model: string;
  capacity: number;
  used?: number;
  output?: number;
  cost?: number;
}
export type ChatProgress = { phase: 'connecting' | 'thinking' | 'writing'; model: string; rate?: number; estimated?: boolean };
export type OfficeChat = (instructions: string, messages: readonly { role: 'user' | 'assistant'; content: string }[], signal: AbortSignal, progress: (sample: ChatProgress) => void) => Promise<{text: string; metrics: TurnMetrics}>;

export class ProjectOffices
{
  private readonly controllers = new Map<string, AbortController>();

  public Stop(project: string, session: string) {
    this.controllers.get(JSON.stringify([project,session]))?.abort();
  }

  private readonly busy = new Set<string>();

  public constructor(private readonly projects: ProjectList, private readonly chat?: OfficeChat) {}

  private async History(projectId: string)
  {
    const project = await this.projects.Open(projectId);
    return { project, history: new OfficeHistory(path.join(this.projects.paths.Project(projectId), 'office-conversations')) };
  }

  public async Open(projectId: string, action: 'latest' | 'create' | 'select', selected?: string)
  {
    const { project, history } = await this.History(projectId);
    const ids = await history.List();
    const sessions = await Promise.all(ids.map(async id => {
      const messages = await history.Messages(id);
      return { id, title: messages[0]?.text.slice(0,32) || '新对话', updated: messages.at(-1)?.created ?? 0 };
    }));
    sessions.sort((a,b) => b.updated-a.updated);
    let id = action === 'select' ? selected : sessions[0]?.id;
    if (action === 'select' && (!id || !ids.includes(id))) throw Error('会话不属于该项目');
    if (!id || action === 'create') {
      id = crypto.randomUUID();
      await history.Create(id);
      sessions.unshift({ id, title: '新对话', updated: Date.now() });
    }
    const office = project.runtime.OpenOffice(projectId, id);
    return { id, officeId: office.id, sessions, messages: await history.Messages(id) };
  }

  public async Send(projectId: string, id: string, input: string, progress: (sample: ChatProgress) => void = () => {}, permission: 'read' | 'ask' | 'execute' = 'ask')
  {
    if (typeof input !== 'string' || !input.trim() || input.length > 32000) throw Error('消息长度须为 1 至 32000 个字符');
    const { project, history } = await this.History(projectId);
    if (!(await history.List()).includes(id)) throw Error('会话不属于该项目');
    const chat = this.chat;
    if (!chat) throw Error('Office chat service is unavailable');
    const office = project.runtime.OpenOffice(projectId, id);
    if (this.busy.has(office.id)) throw Error('A reply is already in progress');
    office.permission = permission;
    this.busy.add(office.id);
    const key = JSON.stringify([projectId,id]);
    const controller = new AbortController();
    this.controllers.set(key, controller);
    try {
      const context = (await history.Messages(id)).map(m => ({ role: m.role, content: m.text }));
      context.push({ role: 'user', content: input.trim() });

      const reply = await office.OpenMainAgent({ parameters: controller.signal, CreateEngine: async signal => ({
        session: () => chat(office.mainRole.definition.instructions, context, signal, progress),
        Close: async () => { controller.abort(); },
      }) });
      try {
        const result = await reply();
        return await history.AppendTurn(id, input.trim(), result.text, result.metrics);
      } finally { await office.CloseMainEngine(); }
    } finally { this.busy.delete(office.id); this.controllers.delete(key); }
  }
}
