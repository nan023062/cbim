import { expect, it, vi } from 'vitest';
import { ConnectorRuntime } from '../../../../src/resource/connectors';

it('opens independent concurrent sessions, including rollback after a late cancellation', async () => {
  const controller = new AbortController();
  const released: string[] = [];
  const load = vi.fn(async (id: string) => ({
    id,
    Create: () => ({
      mode: 'concurrent' as const,
      async OpenSession(context: { taskId: string }) {
        if (context.taskId === 'late') controller.abort();
        return {
          ...server('read'), Call: async () => context.taskId,
          Release: async () => { released.push(context.taskId); }
        };
      }
    })
  }));
  const runtime = new ConnectorRuntime(load);
  const open = (taskId: string) => runtime.Open(['browser'], { taskId, workspaceId: 'w', officeId: 'o', agentInstanceId: 'a' }, controller.signal);
  const [first, second] = await Promise.all([open('first'), open('second')]);
  expect(load).toHaveBeenCalledTimes(1);
  await first.Release();
  expect(await second.sessions[0].Call('read', {}, controller.signal)).toBe('second');
  await expect(open('late')).rejects.toThrow();
  await second.Release();
  expect(released).toEqual(['first', 'late', 'second']);
});

function server(name: string)
{
  return {
    List: () => [{name, inputSchema: {type: 'object'}}],
    Describe: vi.fn(() => name),
    Call: vi.fn(async () => name),
  };
}
