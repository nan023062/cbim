/**
 * 作用定位：Workspace 声明业务 Workflow；其作用域覆盖所属节点和全部后代。
 * 设计原因：静态作用域计算保留祖先来源，避免将无关节点的流程混入当前业务工作区。
 */
import type { WorkspaceTree } from './workspace';

export class WorkflowScope
{
  private constructor()
  {
  }

  /** 收集当前节点及祖先的流程，并保留每项声明的来源。 */
  public static Resolve<T>(tree: WorkspaceTree, workspaceId: string, declared: (owner: string) => readonly T[])
  {
    const parents = new Map<string, string>();

    for (const node of Object.values(tree.nodes))
      for (const child of node.children)
        parents.set(child, node.id);

    const result:
      {
        workflow: T;

        owner: string;

        inherited: boolean
      }[] = [];

    const visited = new Set<string>();

    let owner: string | undefined = workspaceId;

    while (owner !== undefined && Object.hasOwn(tree.nodes, owner))
    {
      if (visited.has(owner))
        throw new Error('Workspace 组织存在循环');

      visited.add(owner);

      for (const workflow of declared(owner))
        result.push({ workflow, owner, inherited: owner !== workspaceId });

      owner = parents.get(owner);
    }

    return result;
  }
}
