/**
 * 作用定位：从项目目录读取团队角色与业务节点描述，装配运行时的静态初始化数据。
 * 设计原因：文件读取只产出描述数据，组织和业务的运行实例由上层装配，扫描排除缓存及归档目录。
 */
import fs from 'node:fs/promises';

import path from 'node:path';

const ignored = new Set(['archive', '_unassigned', '__pycache__', 'node_modules']);

async function descriptions(root: string, folder: string, filename: string)
{
  const result = new Map<string, string>();

  async function visit(id: string)
  {
    const entries = await fs.readdir(path.join(root, id), { withFileTypes: true });

    if (entries.some(entry => entry.isFile() && entry.name === filename))
      result.set(id, await fs.readFile(path.join(root, id, filename), 'utf8'));

    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name)))
      if (entry.isDirectory() && !entry.name.startsWith('.') && !ignored.has(entry.name))
        await visit(id + '/' + entry.name);
  }

  try
  {
    await fs.access(path.join(root, folder));
  }
  catch (error)
  {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      return result;

    throw error;
  }

  await visit(folder);

  return result;
}

export async function readArchitectureFiles(root: string, org = true, biz = true)
{
  await fs.access(root);

  const [roles, modules] = await Promise.all([
    org ? descriptions(root, '.cbim/team', 'agent.json') : new Map<string, string>(),
    biz ? descriptions(root, '.cbim/workspace', 'module.json') : new Map<string, string>(),
  ]);

  return { roles, modules };
}
