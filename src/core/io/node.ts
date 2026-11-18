/** Node IO 入口。独占写入暂存文件并核对字节和摘要，暂存路径与失败文件由调用方管理。 */
import fs from 'node:fs/promises';

import { createHash } from 'node:crypto';

export { atomic, exists, readJson } from './text-files';

export { sha256 } from './digest';

/** 流超过声明长度、截断或 SHA-256 不符时返回的技术事实。 */
export class FileIntegrityError extends Error
{
  /** 供调用方映射业务错误。 */
  public constructor(public readonly reason: 'overflow' | 'mismatch')
  {
    super(reason);
  }
}

/** 按块独占写入新文件，成功返回前同步文件；进度以已写字节数报告。 */
export async function writeVerifiedFile(body: ReadableStream<Uint8Array>, filename: string, expected: { bytes: number; sha256: string }, signal: AbortSignal, progress: (bytes: number) => void): Promise<void>
{
  signal.throwIfAborted();

  const reader = body.getReader();

  const cancel = () => { void reader.cancel(signal.reason).catch(() => { }); };

  signal.addEventListener('abort', cancel, { once: true });

  try
  {
    const handle = await fs.open(filename, 'wx', 0o600);

    try
    {
      const hash = createHash('sha256');

      let bytes = 0;

      for (; ;)
      {
        signal.throwIfAborted();

        const chunk = await reader.read();

        signal.throwIfAborted();

        if (chunk.done)
          break;

        bytes += chunk.value.byteLength;

        if (bytes > expected.bytes)
          throw new FileIntegrityError('overflow');

        hash.update(chunk.value);

        await handle.writeFile(chunk.value);

        progress(bytes);
      }

      if (bytes !== expected.bytes || hash.digest('hex') !== expected.sha256)
        throw new FileIntegrityError('mismatch');

      await handle.sync();

      signal.throwIfAborted();
    }
    finally
    {
      await handle.close();
    }
  }
  finally
  {
    signal.removeEventListener('abort', cancel);

    cancel();

    reader.releaseLock();
  }
}
