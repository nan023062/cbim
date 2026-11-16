/**
 * 作用定位：只读知识查询门面，取得快照并组合团队与业务模块读取模型。
 * 设计原因：查询只需要 snapshot，不能因为共用工作区而获得提交、维护任务或物理路径；刷新另由 KnowledgeRefresh 负责。
 */
import type { KnowledgeSnapshotReader } from './types';

import { Team, BusinessWorkspace } from './read-models';

export class KnowledgeQueries
{
  constructor(private readonly workspace: KnowledgeSnapshotReader)
  {
  }

  async Modules(query = '')
  {
    return new BusinessWorkspace(await this.workspace.Snapshot()).Modules(query)
  }

  async Module(id: string)
  {
    return new BusinessWorkspace(await this.workspace.Snapshot()).Module(id)
  }

  async Agents(query = '')
  {
    return new Team(await this.workspace.Snapshot()).Agents(query)
  }

  async Agent(id: string)
  {
    return new Team(await this.workspace.Snapshot()).Agent(id)
  }
}
