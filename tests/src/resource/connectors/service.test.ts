import { expect, it, vi } from 'vitest';
import { ConnectorService } from '../../../../src/resource/connectors';

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
