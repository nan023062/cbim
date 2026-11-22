/**
 * 作用定位：从宿主登记的绝对入口加载连接器包，任务选择器只返回产品 ID。
 * 设计原因：执行入口来自宿主校验的包，任务仅选择产品身份；固定版本引用保护运行中会话不被升级替换。
 */
import { createRequire } from 'node:module';

import path from 'node:path';

import { ConnectorRuntime, ConnectorService } from './index';

import type { ConnectorTaskContext } from '../../framework/connectors';

import type { RunToolDescriptor } from '../../logic/tools/rules/policy/tool-policy';

import { PluginManager } from '../plugins';

import type { EngineArtifactsPort } from '../../logic/updates/engine-artifacts';

const loadProduct = createRequire(typeof __filename === 'string' ? __filename : import.meta.url);

function readProduct(entry: string)
{
  return loadProduct(entry).connectorProduct;
}

export interface ConnectorPackages
{
  entries: ReadonlyMap<string, string>;

  Select(context: ConnectorTaskContext, agentId: string, moduleIds: readonly string[]): readonly string[];
}

export function bindConnectorPackages(packages: ConnectorPackages)
{
  const entries = new Map(packages.entries);

  const runtime = new ConnectorRuntime<RunToolDescriptor, unknown>(async id => { const entry = entries.get(id); if (!entry || !path.isAbsolute(entry) || !entry.endsWith('.cjs')) throw new Error('未登记连接器包或入口无效：' + id); return readProduct(entry); });

  return { Close: () => runtime.Close(), Open: (context: ConnectorTaskContext, agentId: string, moduleIds: readonly string[], signal: AbortSignal, _definitionId?: string) => runtime.Open(packages.Select(context, agentId, moduleIds), context, signal) };
}

/** 首个官方工具复用宿主签名目录与不可变缓存，按制品身份共享运行实例。 */
export function managedConnectorPackages(file: string, artifacts: EngineArtifactsPort)
{
  const compatible = (artifact: Awaited<ReturnType<EngineArtifactsPort['List']>>['available'][number]) => artifact.plugin?.type === 'connector' || (!artifact.plugin && artifact.kind === 'world-clock');

  const manager = new PluginManager(file, artifacts, {
    ids: [],

    Discover: available => [...new Set(available.filter(compatible).map(item => item.kind))],

    ParseId(raw)
    {
      if (!/^[a-z][a-z0-9-]{0,47}$/.test(raw))
        throw Error('未知连接器包：' + raw);

      return raw;
    },

    Validate(artifact)
    {
      if (!compatible(artifact) || artifact.protocol !== 1 || artifact.dependencies.length)
        throw Error('连接器制品协议无效');
    }
  });

  const versions = new Map<string,
    {
      runtime: ConnectorRuntime<RunToolDescriptor, unknown>;

      users: number
    }>();

  return {
    manager,

    async Open(id: string, context: ConnectorTaskContext, signal: AbortSignal, pinned?: string)
    {
      signal.throwIfAborted();

      const { root, retain } = await manager.Resolve(id, pinned);

      signal.throwIfAborted();

      const releasePackage = retain();

      const key = id + ':' + root.identity;

      let version = versions.get(key);

      if (!version)
      {
        const runtime = new ConnectorRuntime<RunToolDescriptor, unknown>(async () => { const relative = path.relative(root.root, root.adapter.entry); if (!path.isAbsolute(root.root) || !path.isAbsolute(root.adapter.entry) || !relative || relative.startsWith('..') || path.isAbsolute(relative) || !relative.endsWith('.cjs')) throw Error('连接器入口无效'); const product = readProduct(root.adapter.entry); if (product?.protocol !== 1 || product.version !== root.adapter.version) throw Error('连接器版本与已验证的包不符'); return product; });

        version = { runtime, users: 0 };

        versions.set(key, version);
      }

      const captured = version;

      captured.users++;

      let retired: boolean | undefined;

      const drop = async () => { if (retired === undefined) { retired = --captured.users === 0; if (retired) versions.delete(key); } if (retired) await captured.runtime.Close(); releasePackage(); };

      try
      {
        const lease = await captured.runtime.Open([id], context, signal);

        let closing: Promise<void> | undefined;

        return { sessions: lease.sessions, Release: () => closing ??= lease.Release().then(drop).catch(error => { closing = undefined; throw error; }) };
      }
      catch (error)
      {
        await drop();

        throw error;
      }
    }
  };
}

/** 助理和 Worker 按各自的显式选择取得同一套受管连接器会话。 */
export async function openAgentConnectors(packages: Pick<ReturnType<typeof managedConnectorPackages>, 'Open'>, ids: readonly string[], context: ConnectorTaskContext, signal: AbortSignal, pin?: (id: string) => string | undefined)
{
  // 父成员可能正在持有同一个独占工具，等待有界，避免嵌套派发永久互锁。
  const waiting = new AbortController();

  const timeout = setTimeout(() => waiting.abort(Error('连接器仍被其他任务占用，请释放后重试')), 15000);

  const stop = AbortSignal.any([signal, waiting.signal]);

  const leases: Awaited<ReturnType<typeof packages.Open>>[] = [];

  const Release = async () => { const results = await Promise.allSettled(leases.map(lease => lease.Release())); const failures = results.filter(result => result.status === 'rejected').map(result => result.reason); if (failures.length) throw new AggregateError(failures, '连接器释放失败'); };

  try
  {
    for (const id of [...new Set(ids)].sort())
      leases.push(await packages.Open(id, context, stop, pin?.(id)));

    const service = new ConnectorService(leases.flatMap(lease => lease.sessions));

    for (const tool of service.List())
      if (!/^cbim_connector_[A-Za-z0-9_]+$/.test(tool.name))
        throw Error('连接器工具名称无效：' + tool.name);

    return { service, Release };
  }
  catch (error)
  {
    await Release();

    throw error;
  }
  finally
  {
    clearTimeout(timeout);
  }
}
