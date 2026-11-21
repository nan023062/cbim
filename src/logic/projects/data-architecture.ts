/**
 * 作用定位：Logic 实例服务：拥有项目本机数据目录，以版本检查和原子写入保存定义；不修改真实数据库。
 * 设计原因：本机结构定义独立持久化，版本冲突保留现有事实，不将保存定义解释为建表或迁移。
 */
import fs from 'node:fs/promises';

import path from 'node:path';

import { atomic } from '../../core/io/text-files';

import type { ProjectList } from './project';

import { dataArchitectureSchema, dataArchitectureChangeSchema, type DataArchitectureSnapshot, type DataArchitectureChange } from './data-architecture-contract';

export class DataArchitecture
{
  /** 同一宿主的项目写入互斥；失败后释放，不把失败版本视为已保存。 */
  private readonly _writing = new Set<string>();

  /** 项目目录及身份由项目服务提供，客户端不能选择任意存储路径。 */
  public constructor(private readonly _projects: ProjectList)
  {
  }

  /** 仅缺失文件视为空目录；格式损坏明确返回错误。 */
  public async Read(projectId: string): Promise<DataArchitectureSnapshot>
  {
    await this._projects.Open(projectId);

    try
    {
      return dataArchitectureSchema.parse(JSON.parse(await fs.readFile(path.join(this._projects.paths.Project(projectId), 'data-architecture.json'), 'utf8')));
    }
    catch (error)
    {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        throw error;

      return { revision: 0, nodes: [] };
    }
  }

  /** 单节点 CRUD，非空容器禁止删除；重命名和移动不会改变身份或子节点。 */
  public async Change(projectId: string, input: DataArchitectureChange): Promise<DataArchitectureSnapshot>
  {
    const change = dataArchitectureChangeSchema.parse(input);

    if (this._writing.has(projectId))
      throw Error('数据架构正在保存，请稍后重试');

    this._writing.add(projectId);

    try
    {
      const previous = await this.Read(projectId);

      if (previous.revision !== change.revision)
        throw Error('数据架构已更新，请刷新后重试');

      let nodes = structuredClone(previous.nodes);

      if (change.action === 'create')
        nodes.push({ ...change.definition, id: 'data:' + crypto.randomUUID() });
      else
      {
        const index = nodes.findIndex(node => node.id === change.id);

        if (index < 0)
          throw Error('数据节点不存在');

        if (change.action === 'delete')
        {
          if (nodes.some(node => node.parentId === change.id))
            throw Error('不能删除非空节点，请先移除或调整下级节点');

          nodes = nodes.filter(node => node.id !== change.id);
        }
        else
        {
          if (nodes[index].kind !== change.definition.kind)
            throw Error('不能改变已有节点的类别');

          nodes[index] = { ...change.definition, id: change.id };
        }
      }

      const result = dataArchitectureSchema.parse({ revision: previous.revision + 1, nodes });

      await atomic(path.join(this._projects.paths.Project(projectId), 'data-architecture.json'), JSON.stringify(result, null, 2));

      return result;
    }
    finally
    {
      this._writing.delete(projectId);
    }
  }
}
