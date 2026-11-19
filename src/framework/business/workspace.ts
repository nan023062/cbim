/** Workspace 描述一个业务目录的范围、来源及直属子工作区；这些静态节点构成 Project 的业务树。 */
export interface Workspace
{
  readonly kind: 'workspace';

  id: string;

  name: string;

  summary: string;

  sources:
  {
    location: string;

    scope: string
  }[];

  children: string[];

  virtual?: boolean
}

export interface WorkspaceTree
{
  nodes: Record<string, Workspace>;

  roots: string[];
}
