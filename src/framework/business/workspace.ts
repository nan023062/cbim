/**
 * 作用定位：Workspace 描述一个业务目录的范围、来源及直属子工作区；这些静态节点构成 Project 的业务树。
 * 设计原因：以纯接口表达业务结构，使树查询无需创建工作副本或启动 Agent。
 */
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
