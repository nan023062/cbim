/**
 * 作用定位：Project 组织整棵 Workspace 树，负责跨节点查找及 Workflow 继承，并提供打开指定工作区的入口。
 * 设计原因：由项目实例统一解析业务树与继承范围，实际工作目录的打开方式通过工厂注入。
 */
import type { WorkflowDefinition } from '../skills';

import { WorkflowScope } from './workflow';

import { projectRootModuleId } from './project-root';

import type { Workspace, WorkspaceTree } from './workspace';

import { WorkspaceInstance, type WorkspaceOpenContext, type WorkspaceInstanceFactory } from './workspace-instance';

/** 一个项目是一棵业务树的根；旧知识索引的 roots 为直属工作区。 */
export class Project
{
  public readonly kind = 'project';

  public readonly id = projectRootModuleId;

  public constructor(private _tree: WorkspaceTree)
  {
  }

  public UpdateTree(tree: WorkspaceTree): void
  {
    this._tree = structuredClone(tree);
  }

  public get children(): readonly string[]
  {
    return [...this._tree.roots];
  }

  private SelectableWorkspaces()
  {
    return Object.values(this._tree.nodes).filter(node => node.id !== this.id && !node.virtual).map(({ id, name }) => ({ id, name }));
  }

  /** 当前业务树的层级与职责索引，供助理在每轮任务定位时读取。 */
  public DescribeWorkspaces()
  {
    return {
      roots: [...this._tree.roots],
      selectable: this.SelectableWorkspaces(),
      nodes: Object.values(this._tree.nodes).map(({ id, name, summary, children }) => ({ id, name, summary, children: [...children] })),
    };
  }

  public FindWorkspace(id: string): Workspace | undefined
  {
    if (id === this.id || !Object.hasOwn(this._tree.nodes, id))
      return undefined;

    const node = this._tree.nodes[id];

    return { ...node, children: [...node.children], sources: node.sources.map(source => ({ ...source })) };
  }

  /** 沿真实 children 关系从当前工作区向上读取各节点的 Workflow。 */
  public ResolveWorkflows<T extends WorkflowDefinition>(workspaceId: string, declared: (owner: string) => readonly T[])
  {
    return WorkflowScope.Resolve(this._tree, workspaceId, declared);
  }

  /** 从当前项目选择物理业务节点，再由宿主打开对应目录。 */
  public async OpenWorkspace(id: string, context: WorkspaceOpenContext, factory: WorkspaceInstanceFactory): Promise<WorkspaceInstance>
  {
    const description = this.FindWorkspace(id);

    if (!description || description.virtual)
    {
      const choices = this.SelectableWorkspaces().map(node => node.name + ' (' + node.id + ')');
      throw new Error('派发需要物理工作区的 workspaceId，当前值无效：' + id + '\n' + (choices.length ? '可选工作区：\n' + choices.join('\n') : '项目中尚无可选工作区，请先创建物理业务节点。'));
    }

    return WorkspaceInstance.Open(description, context, factory);
  }
}
