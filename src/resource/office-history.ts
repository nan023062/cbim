/** 项目 Office 历史按会话和消息分别存储，独立消息写入不会覆盖其它轮次。 */
import fs from 'node:fs/promises';

import path from 'node:path';

import { atomic, readJson } from '../core/io/text-files';

type Usage =
  {
    elapsed: number;

    model: string;

    capacity: number;

    used?: number;

    output?: number;

    cost?: number
  };

export class OfficeHistory
{
  public constructor(private readonly root: string)
  {
  }

  public async List()
  {
    const entries = await fs.readdir(this.root, { withFileTypes: true }).catch(error => { if (error.code === 'ENOENT') return []; throw error; });

    return entries.filter(e => e.isDirectory() && /^[0-9a-f-]{36}$/.test(e.name)).map(e => e.name);
  }

  public async Create(id: string)
  {
    await fs.mkdir(this.root, { recursive: true });

    await fs.mkdir(path.join(this.root, id));
  }

  public async Files(id: string)
  {
    return (await fs.readdir(path.join(this.root, id))).filter(file => file.endsWith('.json')).sort();
  }

  public async Messages(id: string, files?: string[])
  {
    const dir = path.join(this.root, id);
    files ??= await this.Files(id);
    if (files.some(file => !/^[a-zA-Z0-9_-]+\.json$/.test(file))) throw Error('Invalid history file');

    type Message =
      {
        metrics?: Usage;

        id: string;

        role?: 'user' | 'assistant';

        text: string;

        created: number
      };

    const turns = await Promise.all(files.map(file => readJson<Message | Message[]>(path.join(dir, file))));

    // 早期版本可能只写入助手消息的身份。跳过空记录，保留同轮有效的用户输入。
    return turns.flat().filter(message => typeof message?.text === 'string' && message.text.trim()).map(message => ({ ...message, role: message.role ?? 'user' as const }));
  }

  /** Cache totals for the immutable prefix independently of the visible transcript. */
  public async EarlierUsage(id: string, files: string[])
  {
    const totals = { elapsed: 0, cost: 0, complete: true };
    if (!files.length) return totals;
    const cache = path.join(this.root, id, 'usage-cache');
    const saved = await readJson<{ through: string; count: number; totals: typeof totals }>(cache).catch(() => undefined);
    let offset = 0;
    if (saved && files[saved.count - 1] === saved.through)
    {
      Object.assign(totals, saved.totals);
      offset = saved.count;
    }
    if (offset === files.length) return totals;
    for (; offset < files.length; offset += 32)
    {
      const messages = await this.Messages(id, files.slice(offset, offset + 32));
      for (const message of messages)
      {
        if (message.role !== 'assistant') continue;
        totals.elapsed += message.metrics?.elapsed ?? 0;
        totals.cost += message.metrics?.cost ?? 0;
        if (message.metrics?.cost == null) totals.complete = false;
      }
    }
    await atomic(cache, JSON.stringify({ through: files.at(-1), count: files.length, totals })).catch(() => {});
    return totals;
  }

  public async AppendTurn(id: string, input: string, reply: string, metrics: Usage)
  {
    if (!input?.trim() || !reply?.trim())
      throw Error('无法保存缺少正文的对话');

    const created = Date.now();

    const messages = [
      { id: crypto.randomUUID(), role: 'user' as const, created, text: input },
      { id: crypto.randomUUID(), role: 'assistant' as const, created, text: reply, metrics },
    ];

    await atomic(path.join(this.root, id, created + '-' + messages[0].id + '.json'), JSON.stringify(messages));

    return messages;
  }
}
