import { expect, it, vi } from 'vitest';
import { kernel, type EngineDescription } from '../../../../src/framework/kernel';

const description: EngineDescription = { type: 'pi', llm: { provider: 'local', model: 'selected' } };
const models = {
  Load: async <T>(configuration: T) => ({ runtime: configuration }),
  Unload: async () => {},
};
const testSession = async <T extends object>(host: { Create(): Promise<T>; Destroy(driver: T): Promise<void> }) => {
  const driver = await host.Create();
  return { session: { ...driver }, Close: () => host.Destroy(driver) };
};
type FakeAdapter = ReturnType<typeof fixture>['adapter'];
const serviceFor = (adapter: FakeAdapter, fail = false) => kernel.ForRun({
  Models: models, Source: () => adapter, Packaged: () => adapter, Options: () => ({}), Bind: engine => { if (fail) throw Error('binding failed'); return engine; }
}).BindSession(testSession);

function fixture()
{
  const close = vi.fn(async () => {});
  const create = vi.fn((_options: { provider: string; model: string }) => ({
    kind: 'pi', start: async () => {}, run: async () => ({ status: 'completed' as const }), stop: async () => {}, close
  }));
  return { adapter: { id: 'pi', protocol: 1 as const, version: '1.0.0', create }, close };
}

it('creates independent instances from the selected model and shares concurrent destruction', async () =>
{
  const { adapter, close } = fixture();
  const first = await serviceFor(adapter).Create(kernel.Capture(description), undefined);
  const second = await serviceFor(adapter).Create(kernel.Capture(description), undefined);
  expect(adapter.create).toHaveBeenCalledWith({ modelInstance: expect.anything(), provider: 'local', model: 'selected', llm: undefined });
  const closing = kernel.Destroy(first);
  expect(kernel.Destroy(first)).toBe(closing);
  await closing;
  await expect(first.session.run('task')).rejects.toThrow();
  await expect(second.session.run('task')).resolves.toEqual({ status: 'completed' });
  await kernel.Destroy(second);
  expect(close).toHaveBeenCalledTimes(2);
});

it('rejects a wrong adapter before creation and cleans up a failed binding', async () =>
{
  const { adapter, close } = fixture();
  await expect(serviceFor({ ...adapter, id: 'other' }).Create(kernel.Capture(description), undefined)).rejects.toThrow();
  expect(adapter.create).not.toHaveBeenCalled();
  await expect(serviceFor(adapter, true).Create(kernel.Capture(description), undefined)).rejects.toThrow('binding failed');
  expect(close).toHaveBeenCalledOnce();
});

it('resolves once and isolates a running configuration from edits and readers', async () =>
{
  const { adapter } = fixture();
  const model = { name: 'initial' };
  const resolve = vi.fn(async (_ref: string) => model);
  const configs = kernel.Configurations({
    Resolve: resolve,
    WithRuntimeConfiguration: async () => { throw Error('unexpected lock'); },
    Describe: value => ({ type: 'pi', llm: { provider: 'local', model: value.name, resolved: value } }),
  });
  const ref = await configs.Resolve('profile');
  model.name = 'changed';
  ref.Read().resolved!.name = 'changed by reader';
  const handle = await serviceFor(adapter).Create(ref, undefined);
  expect(adapter.create).toHaveBeenCalledWith({ modelInstance: expect.anything(), provider: 'local', model: 'initial', llm: { name: 'initial' } });
  expect(resolve).toHaveBeenCalledTimes(1);
  await kernel.Destroy(handle);
});

it('uses only the managed adapter when a package resolver is installed', async () =>
{
  const { adapter } = fixture();
  const source = vi.fn(() => adapter);
  const packaged = vi.fn(() => adapter);
  const runtime = { version: '1' };
  const resolve = vi.fn(async (_kind: string) => runtime);
  const run = kernel.ForRun({ Models: models, Source: source, Packaged: packaged, ResolvePackage: resolve, Options: () => ({}), Bind: engine => engine }).BindSession(testSession);
  const ref = kernel.Capture(description);
  await kernel.Destroy(await run.Create(ref, undefined));
  expect(packaged).toHaveBeenCalledWith('pi', runtime);
  resolve.mockRejectedValueOnce(Error('unavailable'));
  await expect(run.Create(ref, undefined)).rejects.toThrow('unavailable');
  expect(source).not.toHaveBeenCalled();
});

it.each(['load failure', 'factory failure', 'binding failure', 'destroy'])('orders model and engine lifecycle on %s', async mode =>
{

  const events: string[] = [];
  const instance = { runtime: description.llm };
  const loader = {
    Load: async () => { events.push('load'); if (mode === 'load failure') throw Error(mode); return instance; },
    Unload: async (value: typeof instance) => { expect(value).toBe(instance); events.push('unload'); },
  };
  const { adapter } = fixture();
  const factory = { ...adapter, create(options: Parameters<typeof adapter.create>[0] & { modelInstance: typeof instance }) {
    expect(options.modelInstance).toBe(instance);
    events.push('create');
    if (mode === 'factory failure') throw Error(mode);
    return { ...adapter.create(options), close: async () => { events.push('close'); } };
  } };
  const run = kernel.ForRun({ Models: loader, Source: () => factory, Packaged: () => factory, Options: () => ({}), Bind: engine => {
    if (mode === 'binding failure') throw Error(mode);
    return engine;
  } }).BindSession(testSession);
  const creation = run.Create(kernel.Capture(description), undefined);
  if (mode === 'destroy') { const handle = await creation; await Promise.all([kernel.Destroy(handle), kernel.Destroy(handle)]); }
  else await expect(creation).rejects.toThrow(mode);
  expect(events).toEqual(mode === 'load failure' ? ['load'] : mode === 'factory failure' ? ['load', 'create', 'unload'] : ['load', 'create', 'close', 'unload']);
});

it('rejects an adapter without the requested tool interception capability before creating a driver', async () =>
{
  const { adapter } = fixture();
  const service = kernel.ForRun({
    requireBeforeToolCall: true, Models: models, Source: () => adapter, Packaged: () => adapter,
    Options: () => ({}), Bind: engine => engine,
  }).BindSession(testSession);
  await expect(service.Create(kernel.Capture(description), undefined)).rejects.toThrow();
  expect(adapter.create).not.toHaveBeenCalled();
});