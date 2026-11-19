import { Organization } from '../../../../src/framework/cability/organization';
import { expect, it, vi } from 'vitest';
import { AgentRole, runAgentTask, type AgentTaskExecution } from '../../../../src/framework/cability/agent';
import { composeTaskSkills, composeTaskTools, OfficeMembers, OfficeDispatcher } from '../../../../src/framework/office';

const member = { kind: 'agent' as const, id: 'worker', name: 'Worker', agentId: 'role', position: 'worker', model: { engine: 'pi', profileId: 'p', modelId: 'm' }, available: true };
const tree = { kind: 'team' as const, id: 'root', children: [{ kind: 'team' as const, id: 'studio', children: [member] }] };

it.each([true, false])('父 Agent 仅在子运行成功后汇总，completed=%s', async completed =>
{
  const caller = new AgentRole({ id: 'parent', name: 'Parent', instructions: '' }, { workspaceId: 'w', taskId: 'parent' });
  const close = vi.fn(async () => {});
  const release = vi.fn();
  const prepare = vi.fn(async () => ({
    Start: async () => ({ done: Promise.resolve('child result') }),
    Settle: async (summary: string) => ({ completed, summary, value: summary }),
    Close: close, Release: release
  }));
  const dispatcher = new OfficeDispatcher(caller.conversation, prepare, vi.fn(), new AbortController().signal, new OfficeMembers(new Organization()));
  const execution: AgentTaskExecution = {
    Analyze: async () => 'step',
    Decompose: async () => [{ kind: 'forward', memberId: 'worker', task: 'step' }],
    Execute: async () => { throw Error('unexpected local execution') },
    Summarize: vi.fn(async (_, __, results) => results[0].output)
  };
  const run = runAgentTask(caller, 'task', execution, dispatcher);
  if (completed) await expect(run).resolves.toMatchObject({ status: 'completed', conclusion: 'child result' });
  else { await expect(run).rejects.toThrow('child result'); expect(execution.Summarize).not.toHaveBeenCalled() }
  expect(prepare).toHaveBeenCalledWith({kind:'forward', memberId:'worker', task:'step'}, {workspaceId:'w', parentTaskId:'parent', memberId:'worker', goal:'step', taskId:expect.any(String)},expect.objectContaining({Acquire:expect.any(Function)}));
  expect(close).toHaveBeenCalledOnce();
  expect(release).toHaveBeenCalledOnce();
});

it('组合双方工具，复用同一绑定并拒绝冲突绑定', () =>
{
  const git = { id: 'git' };
  const blender = { id: 'blender' };
  expect(composeTaskTools([git], [git, blender])).toEqual([git, blender]);
  expect(() => composeTaskTools([git], [{ id: 'git' }])).toThrow('git');
});

it.each(['success', 'startup failure', 'wrong member'])('派发通过共享服务获取并回收对应岗位实例：%s', async mode => {
  const caller = { workspaceId: 'w', taskId: 'parent' };
  const service = new Organization();
  const members = new OfficeMembers(service);
  members.SetMembers(tree.children);
  const create = vi.spyOn(service, 'CreateAndStart');
  const close = vi.fn(async () => {});
  const open = vi.fn(async () => {
    if (mode === 'startup failure') throw Error('启动失败');
    return { session: 'child engine', Close: close };
  });
  const release = vi.fn();
  const office = new OfficeDispatcher<string, string>(caller, async (_, child, agents) => ({
    Start: async () => {
      const role = new AgentRole({ id: mode === 'wrong member' ? 'other' : child.memberId, name: 'worker', instructions: '' }, child);
      const engine = await agents.OpenEngine(role, { parameters: child.taskId, CreateEngine: open });
      return { done: Promise.resolve(engine) };
    },
    Settle: async value => ({ completed: true, summary: value, value }),
    Close: async () => {}, Release: release
  }), vi.fn(), new AbortController().signal, members);
  const result = office.Dispatch(caller, { kind: 'forward', memberId: 'worker', task: 'verify' });
  if (mode === 'success') await expect(result).resolves.toMatchObject({ value: 'child engine' });
  else await expect(result).rejects.toThrow(mode === 'wrong member' ? '不匹配' : '启动失败');
  expect(create).toHaveBeenCalledTimes(mode === 'wrong member' ? 0 : 1);
  expect(open).toHaveBeenCalledTimes(mode === 'wrong member' ? 0 : 1);
  expect(close).toHaveBeenCalledTimes(mode === 'success' ? 1 : 0);
  expect(release).toHaveBeenCalledOnce();
});

it('keeps the previous organization when a replacement repeats a position', () => {
  const service = new OfficeMembers(new Organization());
  const member = { kind: 'agent' as const, id: 'writer', name: 'Writer', agentId: 'writer-role', position: 'writer', model: { engine: 'pi', profileId: 'p', modelId: 'm' }, available: true };
  service.SetMembers([{ kind: 'team', id: 'studio', children: [member] }]);
  const before = service.organization;
  expect(before.kind).toBe("organization");
  expect(before.FindTeam("studio")?.id).toBe("studio");
  expect(before.FindMember('writer')).toEqual(member);
  expect(() => service.SetMembers([member, member])).toThrow('重复');
  expect(() => service.SetMembers([member, { ...member, id: 'second-worker' }])).toThrow('只能绑定一个 Worker');
  expect(service.organization).toBe(before);
  service.SetMembers([]);
  expect(service.organization.children).toEqual([]);
});

it('同一岗位在两个 Office 分属独立实例，同一 Office 的后续任务复用原实例', async () => {
  const service = new Organization();
  const left = new OfficeMembers(service);
  const right = new OfficeMembers(new Organization());
  left.SetMembers(tree.children);
  right.SetMembers(tree.children);

  async function start(office: OfficeMembers, taskId: string) {
    const task = { workspaceId: 'shared', memberId: 'worker', taskId };
    const lease = office.ForTask(task);
    const role = new AgentRole({ id: 'worker', name: 'Worker', instructions: '' }, task);
    const agent = await lease.Acquire(role, { parameters: taskId, CreateEngine: async id => ({ session: id, Close: async () => {} }) });
    return { agent, lease };
  }

  const [a, b] = await Promise.all([start(left, 'a'), start(right, 'b')]);
  expect(left.GetMember('worker')).toBe(a.agent);
  expect(right.GetMember('worker')).toBe(b.agent);
  expect(a.agent.id).not.toBe(b.agent.id);
  await expect(start(left, 'concurrent')).rejects.toThrow('已登记');
  await a.lease.Close();
  left.SetMembers(tree.children);
  const next = await start(left, 'next');
  expect(next.agent).toBe(a.agent);
  expect(next.agent.engine).toBe('next');
  expect(b.agent.engine).toBe('b');
  await next.lease.Close();
  left.SetMembers([]);
  expect(() => left.GetMember('worker')).toThrow('目标岗位');
  expect(right.GetMember('worker')).toBe(b.agent);
  await b.lease.Close();
});

it('任务技能保留岗位技能，并按定义身份合并多个工作区的全部流程', () => {
  const role = { effectiveSkills: [{ skillId: 'review', ownerId: 'worker', inherited: false, content: 'review' }] };
  const local = { skillId: 'child/build', workspaceId: 'child', ownerId: 'child', content: 'build' };
  const inherited = { skillId: 'art/check', workspaceId: 'child', ownerId: 'art', content: 'check' };
  const skills = composeTaskSkills(role, [local, inherited, { ...inherited, workspaceId: 'sibling' }]);
  expect(skills.map(skill => [skill.skillId, skill.ownerId, skill.inherited])).toEqual([
    ['review', 'worker', false], ['child/build', 'child', false], ['art/check', 'art', true]
  ]);
  expect(role.effectiveSkills).toHaveLength(1);
  expect(composeTaskSkills(role, [])).toEqual(role.effectiveSkills);
});
