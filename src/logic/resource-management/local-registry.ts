/**
 * 作用定位：通过本机资源服务发布文件，按指定版本及摘要拉取到用户缓存。
 * 设计原因：发布凭据、文件流和缓存路径留在宿主；拉取不会安装或执行资源。
 */
import { registryOrigin } from './registry-origin';
import path from 'node:path';
import fs from 'node:fs/promises';
import { createReadStream, openAsBlob } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';

const max = 512 * 1024 * 1024;
export const registryKey = z.object({
  kind: z.enum(['engine', 'connector', 'talent', 'business']),
  id: z.string().regex(/^[a-z][a-z0-9-]{0,47}$/),
  version: z.string().regex(/^\d{1,8}\.\d{1,8}\.\d{1,8}$/),
});
const metadata = z
  .object({
    name: z.string().max(100).optional(),
    logo: z.string().max(98304).regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/).optional(),
    summary: z.string().max(500).optional(),
    developer: z.string().max(100).optional(),
    preview: z.string().max(1000).optional(),
    changes: z.string().max(1000).optional(),
    priceCnyFen: z.number().int().min(0).max(100000000).optional(),
  })
  .strict();
export const registryPublication = registryKey.extend({ metadata: metadata.optional() }).strict();
export const registryVersion = registryPublication
  .extend({ sha256: z.string().regex(/^[a-f0-9]{64}$/), size: z.number().int().positive().max(max) })
  .strip();
const version = registryVersion;
type Key = z.infer<typeof registryKey>;
export function localRegistry(cache: string, port?: string, token?: string) {
  // 显式端口用于独立的本机发布/测试实例；桌面宿主通过环境选择资源源。
  const origin = port === undefined ? registryOrigin() : registryOrigin(null, port);
  const base = origin + '/v1/resources';
  async function request(route: string, options: RequestInit = {}) {
    const response = await fetch(base + route, {
      ...options,
      redirect: 'error',
      signal: AbortSignal.timeout(300000),
    }).catch(() => {
      throw Error('无法连接资源服务器：' + origin + '，请检查服务和地址');
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw Error(
        (
          {
            401: '发布凭据无效',
            404: '版本未发布或不存在',
            409: '版本与已有摘要冲突',
            422: '文件摘要不匹配',
          } as Record<number, string>
        )[response.status] ?? '资源请求失败：' + response.status,
      );
    }
    return response;
  }
  function route(key: Key) {
    return '/' + [key.kind, key.id, key.version].join('/');
  }
  function match(raw: unknown, key: Key) {
    const result = version.parse(raw);
    if (route(result) !== route(key)) throw Error('服务器返回了其他版本');
    return result;
  }
  return {
    async Remember(raw: unknown, removed: boolean) {
      const row = version.parse(raw),
        dir = path.join(cache, 'history');
      await fs.mkdir(dir, { recursive: true });
      const file = path.join(dir, [row.kind, row.id, row.version].join('.') + '.json'),
        tmp = path.join(dir, randomUUID() + '.tmp');
      try {
        await fs.writeFile(tmp, JSON.stringify({ row, removed }), { flag: 'wx' });
        await fs.rename(tmp, file);
      } finally {
        await fs.rm(tmp, { force: true });
      }
    },
    async History() {
      const dir = path.join(cache, 'history');
      const files = await fs.readdir(dir).catch((e) => {
        if (e.code === 'ENOENT') return [];
        throw e;
      });
      return Promise.all(
        files
          .filter((file) => file.endsWith('.json'))
          .map(async (file) =>
            z
              .object({ row: version, removed: z.boolean() })
              .parse(JSON.parse(await fs.readFile(path.join(dir, file), 'utf8'))),
          ),
      );
    },
    async ReadTemplate(raw: unknown) {
      const selected = version.strict().parse(raw);
      if (!['talent', 'business'].includes(selected.kind) || selected.size > 1024 * 1024)
        throw Error('模板必须是 1 MiB 以内的人力或业务 JSON 文件');
      const file = await this.Pull(selected);
      return JSON.parse(await fs.readFile(file, 'utf8')) as unknown;
    },
    async List() {
      return version.array().parse(await (await request('')).json());
    },
    async Publish(raw: unknown, file: string) {
      const key = registryPublication.parse(raw);
      if (!token) throw Error('发布需要在桌面进程配置 REGISTRY_TOKEN');
      const blob = await openAsBlob(file);
      if (!blob.size || blob.size > max) throw Error('文件须在 1 字节至 512 MiB 之间');
      const hash = createHash('sha256');
      for await (const chunk of createReadStream(file)) hash.update(chunk);
      const digest = hash.digest('hex'),
        headers = { authorization: 'Bearer ' + token, 'x-content-sha256': digest };
      const draft = await request(route(key) + '/draft', { method: 'PUT', headers, body: blob });
      await draft.body?.cancel();
      const receipt = match(
        await (
          await request(route(key) + '/publish', {
            method: 'POST',
            headers,
            body: JSON.stringify(key.metadata ?? {}),
          })
        ).json(),
        key,
      );
      if (receipt.sha256 !== digest || receipt.size !== blob.size) throw Error('发布回执与选中文件不符');
      return receipt;
    },
    async Pull(raw: unknown) {
      const selected = version.strict().parse(raw),
        prefix = route(selected);
      const lock = match(await (await request(prefix + '/lock')).json(), selected);
      if (lock.sha256 !== selected.sha256 || lock.size !== selected.size)
        throw Error('所选版本已变化，请刷新目录');
      const dir = path.join(cache, lock.kind, lock.id, lock.version);
      await fs.mkdir(dir, { recursive: true });
      const tmp = path.join(dir, randomUUID() + '.part'),
        target = path.join(dir, lock.sha256 + '.pack');
      const handle = await fs.open(tmp, 'wx');
      try {
        try {
          const response = await request(prefix + '/download?sha256=' + lock.sha256);
          if (!response.body) throw Error('下载内容为空');
          const reader = response.body.getReader(),
            hash = createHash('sha256');
          let size = 0;
          try {
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              size += value.length;
              if (size > lock.size) throw Error('下载超过声明大小');
              hash.update(value);
              await handle.writeFile(value);
            }
          } finally {
            await reader.cancel();
          }
          if (size !== lock.size || hash.digest('hex') !== lock.sha256) throw Error('下载完整性校验失败');
        } finally {
          await handle.close();
        }
        await fs.rename(tmp, target);
        return target;
      } finally {
        await fs.rm(tmp, { force: true });
      }
    },
  };
}
