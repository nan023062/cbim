/** WorkspaceInstance 表示一个已打开的 Workspace，供 Office 工位访问该业务目录，并管理本次使用的生命周期。 */
import { changeEvents } from '../events';
import type { Workspace } from './workspace';

/** 宿主定位 Office 专属工作副本所需的身份及目录。 */
export interface WorkspaceOpenContext
{
  readonly officeId: string;

  readonly repositoryRoot: string;

  /** 业务目录相对于仓库根目录的位置，仓库根本身用 "."。 */
  readonly relativeDirectory: string;
}

/** 一次 worktree 使用权。宿主解析并核实目录位于该工作树内。 */
export interface WorkspaceWorktree
{
  ResolveDirectory(relativeDirectory: string): Promise<string>;

  /** 释放本次使用权，保留共享工作树和未提交修改。 */
  Release(): Promise<void>;
}

/** 宿主按 Office 和仓库取得工作树，同一工作树可以服务多个业务节点。 */
export interface WorkspaceInstanceFactory
{
  OpenWorktree(officeId: string, repositoryRoot: string): Promise<WorkspaceWorktree>;
}

/** 工作区实例封装 Git worktree 的使用权，工位只访问已经打开的业务目录。 */
export class WorkspaceInstance
{
  private readonly released = changeEvents<void>();
  public readonly OnClosed = this.released.Subscribe;

  private _closed = false;

  public get closed() { return this._closed; }

  private _closing?: Promise<void>;

  private constructor(public readonly instanceId: string, public readonly description: Workspace, public readonly directory: string, private readonly _worktree: WorkspaceWorktree)
  {
  }

  public static async Open(description: Workspace, context: WorkspaceOpenContext, factory: WorkspaceInstanceFactory): Promise<WorkspaceInstance>
  {
    if (description.virtual)
      throw new Error('虚拟工作区没有物理目录');

    const worktree = await factory.OpenWorktree(context.officeId, context.repositoryRoot);

    try
    {
      const directory = await worktree.ResolveDirectory(context.relativeDirectory);
      return new WorkspaceInstance(crypto.randomUUID(), description, directory, worktree);
    }
    catch (error)
    {
      await worktree.Release();
      throw error;
    }
  }

  /** 并发关闭共享同一释放结果；失败后允许重试。 */
  public Close(): Promise<void>
  {
    return this._closing ??= Promise.resolve().then(() => this._worktree.Release()).then(() => { this._closed = true; this.released.Emit(); }).catch(error => { this._closing = undefined; throw error; });
  }
}
