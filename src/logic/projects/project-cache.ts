/**
 * 作用定位：单个本机项目的 Office 记录、运行缓存及工作树；读取历史不需要创建 Office。
 * 设计原因：集中定位文件以兼容旧缓存。
 */
import { hash } from '../../core/io/serialization';

import path from 'node:path';

import { OfficeHistory } from '../../resource/office-history';

import { GitWorktrees } from './git-worktrees';

export class ProjectCache
{
  readonly history: OfficeHistory;

  readonly worktrees: GitWorktrees;

  constructor(private readonly root: string, legacyWorktrees: string)
  {
    this.history = new OfficeHistory(path.join(root, 'office-conversations'));

    this.worktrees = new GitWorktrees(path.join(root, 'worktrees'), legacyWorktrees);
  }

  Session(id: string)
  {
    return path.join(this.root, 'office-conversations', id);
  }

  ApprovalDirectory(session: string)
  {
    return path.join(this.root, 'office-approvals', hash(session));
  }

  Queue(id: string)
  {
    return path.join(this.root, 'office-queues', id + '.json');
  }

  get identity()
  {
    return path.join(this.root, 'identity.json');
  }

  get legacyOrganization()
  {
    return path.join(this.root, 'organization.json');
  }

  get legacyBusiness()
  {
    return path.join(this.root, 'business.json');
  }

  LegacyMember(id: string)
  {
    return path.join(this.root, 'agent-settings', hash(JSON.stringify({ kind: 'member', id })) + '.json');
  }

  get work()
  {
    return path.join(this.root, 'project-work.json');
  }

  get engines()
  {
    return path.join(this.root, 'office-engines');
  }
}
