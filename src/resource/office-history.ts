/** 项目 Office 历史按会话和消息分别存储，独立消息写入不会覆盖其它轮次。 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { atomic, readJson } from '../core/io/text-files';

export class OfficeHistory
{
  public constructor(private readonly root: string) {}

  public async List()
  {
    const entries = await fs.readdir(this.root, { withFileTypes: true }).catch(error => {
      if (error.code === 'ENOENT') return [];
      throw error;
    });
    return entries.filter(e => e.isDirectory() && /^[0-9a-f-]{36}$/.test(e.name)).map(e => e.name);
  }

  public async Create(id: string)
  {
    await fs.mkdir(this.root, { recursive: true });
    await fs.mkdir(path.join(this.root, id));
  }

  public async Messages(id: string)
  {
    const dir = path.join(this.root, id);
    const files = (await fs.readdir(dir)).filter(file => file.endsWith('.json')).sort();
    return Promise.all(files.map(file => readJson<{ id: string; text: string; created: number }>(path.join(dir,file))));
  }

  public async Append(id: string, text: string)
  {
    const message = { id: crypto.randomUUID(), created: Date.now(), text };
    await atomic(path.join(this.root, id, message.created+'-'+message.id+'.json'), JSON.stringify(message));
    return message;
  }
}
