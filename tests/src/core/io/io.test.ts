import { expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { JsonUtils, ByteUtils } from '../../../../src/core/io';
import { writeVerifiedFile, sha256 } from '../../../../src/core/io/node';

it('UTF-8 字节视图和 JSON 往返', () => {
  expect(ByteUtils.DecodeUtf8(ByteUtils.EncodeUtf8('a中文').subarray(1),{fatal:true})).toBe('中文');
  expect(() => ByteUtils.DecodeUtf8(Uint8Array.of(255),{fatal:true})).toThrow();
  expect(JsonUtils.ParseStrictJson(JsonUtils.FormatJson({text:'中文'}))).toEqual({text:'中文'});
});

it('流式写入使用视图可见字节，拒绝覆盖，并可取消等待读取', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'cbim-io-'));
  try {
    const file = path.join(root, 'output');
    const bytes = Uint8Array.of(0,1,2,3).subarray(1,3);
    const expected = {bytes:2, sha256:sha256(bytes)};
    const body = () => new ReadableStream<Uint8Array>({start(controller){controller.enqueue(bytes);controller.close()}});
    const controller = new AbortController();
    await writeVerifiedFile(body(), file, expected, controller.signal, () => {});
    await expect(writeVerifiedFile(body(), file, expected, controller.signal, () => {})).rejects.toMatchObject({code:'EEXIST'});
    expect([...await readFile(file)]).toEqual([1,2]);
    const stalled = new ReadableStream<Uint8Array>({pull(){controller.abort(new Error('停止'))}});
    await expect(writeVerifiedFile(stalled, path.join(root,'partial'), expected, controller.signal, () => {})).rejects.toThrow('停止');
  } finally {
    await rm(root, {recursive:true,force:true});
  }
});
