/**
 * 作用定位：为一个 Office 在每个仓库中创建或恢复持久 Git 工作树。
 * 设计原因：以 Office 和仓库隔离工作副本；归还使用权保留文件，避免任务清理误删未合并成果。
 */
import { execFile } from 'node:child_process';

import fs from 'node:fs/promises';

import path from 'node:path';

import { promisify } from 'node:util';

import { hash } from '../../core/io/serialization';

import type { WorkspaceInstanceFactory, WorkspaceWorktree } from '../../framework/business';

const execute = promisify(execFile);

export class GitWorktrees implements WorkspaceInstanceFactory
{
  private readonly _opening = new Map<string, Promise<string>>();

  private async Git(directory: string, ...args: string[]): Promise<string>
  {
    const { stdout } = await execute('git', ['-C', directory, ...args], { windowsHide: true, encoding: 'utf8' });

    return stdout.replace(/[\r\n]+$/, '');
  }

  private async Prepare(repository: string, target: string): Promise<string>
  {
    const registered = async () => { const list = await this.Git(repository, 'worktree', 'list', '--porcelain', '-z'); return list.split('\0').some(field => field.startsWith('worktree ') && path.relative(target, field.slice(9)) === ''); };

    if (!await registered())
    {
      try
      {
        await this.Git(repository, 'worktree', 'add', '--detach', target, 'HEAD');
      }
      catch (error)
      {
        if (!await registered())
          throw error;
      }
    }

    const actual = await fs.realpath(target);

    const root = await fs.realpath(await this.Git(target, 'rev-parse', '--show-toplevel'));

    const common = async (cwd: string) => fs.realpath(await this.Git(cwd, 'rev-parse', '--path-format=absolute', '--git-common-dir'));

    if (path.relative(target, actual) || path.relative(actual, root) || path.relative(await common(repository), await common(target)))
      throw new Error('工作树与登记的仓库或目录不匹配');

    return actual;
  }

  public constructor(private readonly _storage: string, private readonly legacy?: string)
  {
  }

  public async OpenWorktree(officeId: string, repositoryRoot: string): Promise<WorkspaceWorktree>
  {
    if (!officeId.trim() || !path.isAbsolute(repositoryRoot))
      throw new Error('工作树需要 Office 身份和仓库绝对路径');

    const repository = await fs.realpath(repositoryRoot);

    const top = await fs.realpath(await this.Git(repository, 'rev-parse', '--show-toplevel'));

    if (path.relative(repository, top))
      throw new Error('工作树需要仓库根目录');

    await fs.mkdir(this._storage, { recursive: true });

    const storage = await fs.realpath(this._storage);

    const key = hash(JSON.stringify([repository, officeId]));

    const old = this.legacy && path.join(this.legacy, key);

    const target = old && await fs.stat(old).then(() => true, e => { if (e.code === 'ENOENT') return false; throw e; }) ? old : path.join(storage, key);

    let opening = this._opening.get(target);

    if (!opening)
    {
      opening = this.Prepare(repository, target).finally(() => this._opening.delete(target));

      this._opening.set(target, opening);
    }

    const root = await opening;

    let released = false;

    return {
      ResolveDirectory: async relative => { if (released || !relative || path.isAbsolute(relative) || relative.split(/[\\/]/).includes('..')) throw new Error('工作树使用权或相对目录无效'); const resolved = await fs.realpath(path.resolve(root, relative)); const within = path.relative(root, resolved); if (within === '..' || within.startsWith('..' + path.sep) || path.isAbsolute(within) || !(await fs.stat(resolved)).isDirectory()) throw new Error('业务目录必须位于当前工作树内'); return resolved; },
      Release: async () => { released = true; }
    };
  }
}
