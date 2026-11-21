import { test, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { CbimRuntime } from '../../../../src/framework/cbim-runtime';
import { GitWorktrees } from '../../../../src/logic-new/projects/git-worktrees';
import { OfficeDispatch, type OfficeMemberRunner } from '../../../../src/logic-new/projects/office-dispatch';

const execute = promisify(execFile);

async function fixture(run: OfficeMemberRunner) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'office-dispatch-'));
  const repo = path.join(root, 'repo');
  await fs.mkdir(repo);
  await execute('git', ['init', repo], { windowsHide: true });
  await fs.writeFile(path.join(repo, 'seed.txt'), 'seed');
  await execute('git', ['-C', repo, 'add', 'seed.txt'], { windowsHide: true });
  await execute('git', ['-C', repo, '-c', 'user.name=Office Test', '-c', 'user.email=office@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-m', 'fixture'], { windowsHide: true });
  const member = { kind: 'agent' as const, id: 'writer', agentId: 'writer', name: 'Writer', position: '实现业务文件', available: true, model: { engine: 'codex', profileId: 'profile', modelId: 'fixture' } };
  const runtime = new CbimRuntime(new GitWorktrees(path.join(root, 'trees')), { projectId: 'project', organization: [member], business: { roots: ['module'], nodes: { module: { id: 'module', kind: 'workspace', name: 'Module', summary: '', sources: [], children: [] } } } });
  const office = runtime.OpenOffice('project', 'session');
  const stop = new AbortController();
  let dispatch!: OfficeDispatch;
  await office.OpenMainAgent({ parameters: undefined, CreateEngine: async () => ({ session: {}, Close: async () => {} }) }, (_, commands) => { dispatch = new OfficeDispatch(office, repo, commands, run, stop.signal); return () => {}; });
  return { office, repo, stop, dispatch, async Close() { stop.abort(); await dispatch.Drain(); await runtime.Close(); await fs.rm(root, { recursive: true, force: true }); } };
}

const request = { memberId: 'writer', workspaceId: 'module', directory: '.', goal: 'write output' };

test('真实 Office 派发进入队列并在独立 Git 工作树交付，成员继承权限和固定模型', async () => {
  const values: string[] = [];
  const f = await fixture(async (role, goal, root, taskId, signal, readPermission, report, operations) => {
    values.push(readPermission());
    expect(role.definition.model).toMatchObject({ profileId: 'profile', modelId: 'fixture' });
    expect(role.conversation.taskId).toBe(taskId);
    expect(goal).toBe(request.goal);
    await expect(operations.Dispatch(request, signal)).rejects.toThrow('循环');
    await fs.writeFile(path.join(root, 'result.txt'), 'done');
    report(1, 'summary', 10);
    return { text: 'file created' };
  });
  try {
    f.office.permission = 'execute';
    const result: any = await f.dispatch.Operations().Dispatch(request, f.stop.signal);
    expect(result).toMatchObject({ status: 'completed', merged: false, memberId: 'writer', summary: 'file created' });
    expect(result.directory).not.toBe(f.repo);
    expect(await fs.readFile(path.join(result.directory, 'result.txt'), 'utf8')).toBe('done');
    expect(await fs.access(path.join(f.repo, 'result.txt')).then(() => true, () => false)).toBe(false);
    expect(f.office.ListTasks()[0]).toMatchObject({ id: result.taskId, state: 'completed' });
    expect(values).toEqual(['execute']);
    expect(f.office.ListActiveAgents()).toHaveLength(1);
    expect(f.office.ListWorkspaces()).toHaveLength(0);
  } finally { await f.Close(); }
});

test('只读、未知岗位和目录越界不能创建子任务', async () => {
  const f = await fixture(async () => { throw Error('must not run'); });
  try {
    f.office.permission = 'read';
    await expect(f.dispatch.Operations().Dispatch(request, f.stop.signal)).rejects.toThrow('只读');
    f.office.permission = 'execute';
    await expect(f.dispatch.Operations().Dispatch({ ...request, memberId: 'unknown' }, f.stop.signal)).rejects.toThrow('岗位');
    await expect(f.dispatch.Operations().Dispatch({ ...request, directory: '..' }, f.stop.signal)).rejects.toThrow('相对路径');
    expect(f.office.ListTasks()).toHaveLength(0);
  } finally { await f.Close(); }
});

test('成员失败返回错误并清理实例，不挂起等待或宣称成功', async () => {
  const f = await fixture(async () => { throw Error('member failed'); });
  try {
    f.office.permission = 'execute';
    await expect(f.dispatch.Operations().Dispatch(request, f.stop.signal)).rejects.toThrow('member failed');
    expect(f.office.ListTasks()[0].state).not.toBe('completed');
    expect(f.office.ListActiveAgents()).toHaveLength(1);
    expect(f.office.ListWorkspaces()).toHaveLength(0);
  } finally { await f.Close(); }
});

test('停止主任务会取消运行中的成员并等待其清理', async () => {
  let started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  const f = await fixture(async (_role, _goal, _root, _taskId, signal) => {
    started();
    await new Promise<void>((_resolve, reject) => { signal.addEventListener('abort', () => reject(Error('cancelled')), { once: true }); });
    return { text: 'must not complete' };
  });
  try {
    f.office.permission = 'execute';
    const pending = f.dispatch.Operations().Dispatch(request, f.stop.signal);
    const rejected = expect(pending).rejects.toThrow();
    await ready;
    f.stop.abort();
    await rejected;
    expect(f.office.ListTasks()[0].state).toBe('cancelled');
    expect(f.office.ListActiveAgents()).toHaveLength(1);
    expect(f.office.ListWorkspaces()).toHaveLength(0);
  } finally { await f.Close(); }
});
