/** 工作区登记身份；path 为规范化实际路径，previousIds 仅关联旧身份历史，不合并数据。 */
export interface WorkspaceEntry
{
  id: string;

  path: string;

  name: string;

  lastOpened?: string;

  previousIds?: string[]
}

/** 本机登记清单；内部工作区运行时的启动集合直接取 entries。 */
export interface Catalog
{
  version: 1;

  entries: WorkspaceEntry[];

  recent: string[];
}
