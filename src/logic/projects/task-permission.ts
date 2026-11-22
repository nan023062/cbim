/**
 * 作用定位：为一次 Office 引擎运行签发宿主内存授权，并向适配器提供不可变的范围说明。
 * 设计原因：调用权来自绑定此轮的宿主闭包，不接受引擎回传的身份、目录或令牌。
 */
import path from 'node:path';

import type { AgentPermission } from '../../framework/cability/organization';

export function issueTaskPermission(identity: { projectId: string; officeId: string; agentId: string; taskId: string }, root: string, main: boolean, read: () => AgentPermission, parent: AbortSignal)
{
  if (Object.values(identity).length !== 4 || Object.values(identity).some(v => typeof v !== 'string' || !v.trim()) || !path.isAbsolute(root))
    throw Error('任务授权缺少宿主身份或绝对目录');

  const level = read();

  const rank = { read: 0, ask: 1, execute: 2 };

  if (!Object.hasOwn(rank, level))
    throw Error('未知任务权限');

  const lifetime = new AbortController();

  const signal = AbortSignal.any([parent, lifetime.signal]);

  const resources = Object.freeze(['organization', 'business', 'member', 'references', 'settings', 'timers']);

  const dirs = Object.freeze([root]);

  const snapshot = Object.freeze({
    ...identity, level, readDirectories: dirs, writeDirectories: level === 'read' ? Object.freeze([]) : dirs,
    excludedDirectories: Object.freeze(['.cbim']), readResources: resources, writeResources: !main || level === 'read' ? Object.freeze([]) : resources,
    commands: level === 'read' ? 'denied' as const : 'host' as const
  });

  function Current(): AgentPermission
  {
    signal.throwIfAborted();

    const live = read();

    return !Object.hasOwn(rank, live) ? 'read' : rank[live] < rank[level] ? live : level;
  }

  return { snapshot, signal, Current, Revoke: () => lifetime.abort() };
}

export type TaskPermission = ReturnType<typeof issueTaskPermission>;
