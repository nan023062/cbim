/**
 * 作用定位：宿主级下载队列。按内容摘要合并请求，仅发布完整且已校验的附件。
 * 设计原因：以宿主寿命共享摘要去重与下载状态，页面订阅不拥有下载任务，制品激活仍由上层决定。
 */
import fs from 'node:fs/promises';

import { createReadStream } from 'node:fs';

import path from 'node:path';

import { createHash } from 'node:crypto';

import { SerialQueue } from '../../../core/utility';

import { runtimeAssetResponse } from './runtime-download';

import { runtimePackageUrl, type RuntimePackage } from './runtime-manifest';

/** 队列由桌面宿主持有；清单选择、解包和激活由上层管理。 */
export class DownloadService
{
  private readonly queue = new SerialQueue();

  private readonly controllers = new Map<string, AbortController>();

  private readonly observers = new Set<() => void>();

  private readonly states = new Map<string,
    {
      identity: string;

      name: string;

      phase: 'queued' | 'downloading' | 'verifying';

      bytes: number;

      total: number
    }>();

  /** 让平台原生安装器保留自身签名校验与差分能力，同时占用同一个传输槽。 */
  public RunInstaller(work: () => Promise<void>)
  {
    return this.queue.Run(() => { this.signal.throwIfAborted(); return work(); });
  }

  public Snapshot()
  {
    return Array.from(this.states.values(), value => ({ ...value }));
  }

  public Subscribe(listener: () => void)
  {
    this.observers.add(listener);

    return () => { this.observers.delete(listener); };
  }

  public Cancel(identity: string)
  {
    this.controllers.get(identity)?.abort(Error('下载已取消'));
  }

  private Notify()
  {
    for (const notify of this.observers)
      notify();
  }

  private readonly pending = new Map<string,
    {
      bytes: number;

      result: Promise<string>;

      listeners: Set<(percent: number) => void>
    }>();

  public constructor(private readonly root: string, private readonly signal: AbortSignal)
  {
  }

  /** 在队列内流式复核缓存，损坏的普通文件可由新的已校验副本替换。 */
  private async IsVerified(file: string, pkg: RuntimePackage)
  {
    const stat = await fs.lstat(file).catch(error => { if (error.code === 'ENOENT') return undefined; throw error; });

    if (!stat)
      return false;

    if (!stat.isFile() || stat.isSymbolicLink())
      throw Error('下载缓存文件无效');

    if (stat.size !== pkg.bytes)
      return false;

    const hash = createHash('sha256');

    for await (const chunk of createReadStream(file, { signal: this.signal }))
      hash.update(chunk);

    return hash.digest('hex') === pkg.sha256;
  }

  /** 返回宿主缓存中的只读归档，调用方只清理自己的解包目录。 */
  public Acquire(pkg: RuntimePackage, progress: (percent: number) => void = () => { }): Promise<string>
  {
    this.signal.throwIfAborted();

    if (!/^[0-9a-f]{64}$/.test(pkg.sha256) || !Number.isSafeInteger(pkg.bytes) || pkg.bytes <= 0)
      throw Error('下载制品身份无效');

    const current = this.pending.get(pkg.sha256);

    if (current)
    {
      if (pkg.bytes !== current.bytes)
        throw Error('同一制品的声明长度冲突');

      current.listeners.add(progress);

      return current.result;
    }

    const listeners = new Set([progress]);

    const report = (percent: number) => { for (const listener of listeners) listener(percent); };

    const controller = new AbortController();

    const signal = AbortSignal.any([this.signal, controller.signal]);

    const state = { identity: pkg.sha256, name: pkg.name, phase: 'queued' as 'queued' | 'downloading' | 'verifying', bytes: 0, total: pkg.bytes };

    this.controllers.set(pkg.sha256, controller);

    this.states.set(pkg.sha256, state);

    this.Notify();

    const result = this.queue.Run(async () => { const file = path.join(this.root, pkg.sha256 + '.zip'); const partial = file + '.part'; try { signal.throwIfAborted(); await fs.mkdir(this.root, { recursive: true }); if (await this.IsVerified(file, pkg)) { signal.throwIfAborted(); report(100); return file; } for (let attempt = 0; attempt < 3; attempt++) { signal.throwIfAborted(); const existing = await fs.lstat(partial).catch(error => { if (error.code !== 'ENOENT') throw error; }); if (existing && (!existing.isFile() || existing.isSymbolicLink() || existing.nlink !== 1)) throw Error('下载暂存文件无效'); let offset = existing?.size ?? 0; if (offset >= pkg.bytes) { if (await this.IsVerified(partial, pkg)) break; await fs.unlink(partial); offset = 0; } state.phase = 'downloading'; state.bytes = offset; this.Notify(); const transfer = AbortSignal.any([signal, AbortSignal.timeout(30 * 60_000)]); try { const response = await runtimeAssetResponse(runtimePackageUrl(pkg), transfer, offset); if (response.status === 200) offset = 0; const length = response.headers.get('content-length'); if (!response.body || (response.status === 206 && response.headers.get('content-range') !== 'bytes ' + offset + '-' + (pkg.bytes - 1) + '/' + pkg.bytes) || (length !== null && Number(length) !== pkg.bytes - offset)) { await response.body?.cancel(); throw Error('更新附件范围或长度不符'); } const reader = response.body.getReader(); const handle = await fs.open(partial, existing && offset ? 'a' : existing ? 'w' : 'wx', 0o600); let last = 0; try { for (; ;) { transfer.throwIfAborted(); const chunk = await reader.read(); if (chunk.done) break; offset += chunk.value.length; if (offset > pkg.bytes) throw Error('更新附件超过声明长度'); await handle.writeFile(chunk.value); state.bytes = offset; if (Date.now() - last >= 100 || offset === pkg.bytes) { report(100 * offset / pkg.bytes); this.Notify(); last = Date.now(); } } await handle.sync(); } finally { await reader.cancel().catch(() => { }); await handle.close(); } if (offset < pkg.bytes) throw new TypeError('下载中断'); break; } catch (error) { signal.throwIfAborted(); const status = (error as { status?: number }).status; if (status === 416 && existing) await fs.rm(partial, { force: true }); else if (!(error instanceof TypeError || status === 429 || (status && status >= 500))) throw error; if (attempt === 2) throw error; await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1))); } } state.phase = 'verifying'; this.Notify(); if (!(await this.IsVerified(partial, pkg))) { await fs.rm(partial, { force: true }); throw Error('更新附件摘要不符'); } signal.throwIfAborted(); await fs.rename(partial, file); return file; } finally { if (controller.signal.aborted) await fs.rm(partial, { force: true }); } }).finally(() => { this.pending.delete(pkg.sha256); this.controllers.delete(pkg.sha256); this.states.delete(pkg.sha256); this.Notify(); });

    this.pending.set(pkg.sha256, { bytes: pkg.bytes, result, listeners });

    return result;
  }
}
