import { expect, it, vi } from 'vitest';
import { ConnectorRuntime, ConnectorService } from '../../../../src/framework/connectors';

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

it('routes discovery, description and invocation to the same external service', async () =>
{
  const first = server('search');
  const second = server('render');
  const directory = new ConnectorService([first, second]);
  const signal = new AbortController().signal;
  directory.List()[1].name = 'changed';
  expect(directory.List().map(tool => tool.name)).toEqual(['search', 'render']);
  expect(directory.Describe('render', {})).toBe('render');
  expect(await directory.Call('render', {}, signal)).toBe('render');
  expect(second.Call).toHaveBeenCalledWith('render', {}, signal);
  expect(first.Call).not.toHaveBeenCalled();
  expect(() => new ConnectorService([first, first])).toThrow();
  await expect(directory.Call('unknown', {}, signal)).rejects.toThrow();
});

it('does not dispatch cancelled calls or publish a result after cancellation', async () =>
{
  const controller = new AbortController();
  const external = server('read');
  external.Call.mockImplementation(async () => {
    controller.abort();
    return 'late';
  });
  const directory = new ConnectorService([external]);
  await expect(directory.Call('read', {}, controller.signal)).rejects.toThrow();
  await expect(directory.Call('read', {}, controller.signal)).rejects.toThrow();
  expect(external.Call).toHaveBeenCalledTimes(1);
});
