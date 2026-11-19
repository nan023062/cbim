/** 仅为已登记项目打开 Office，将持久会话身份映射到当前运行时实例。 */
import path from 'node:path';
import { OfficeHistory } from '../../resource/office-history';
import type { ProjectList } from './project';

export class ProjectOffices
{
  public constructor(private readonly projects: ProjectList) {}

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

  public async Send(projectId: string, id: string, input: string)
  {
    if (typeof input !== 'string' || !input.trim() || input.length > 32000) throw Error('消息长度须为 1 至 32000 个字符');
    const { project, history } = await this.History(projectId);
    if (!(await history.List()).includes(id)) throw Error('会话不属于该项目');
    project.runtime.OpenOffice(projectId, id);
    return history.Append(id, input.trim());
  }
}
