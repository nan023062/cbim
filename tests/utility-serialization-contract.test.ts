import {expect,it} from 'vitest';
import {hash,json} from '../src/backend/core/foundation/serialization';
import {formatJson} from '../src/core/utility';
import {sha256} from '../src/core/platform/node/digest';

it('Core 兼容出口复用唯一算法，原文本与 Buffer 指纹不变',()=>{
  expect(hash).toBe(sha256);expect(json).toBe(formatJson);
  const text='{\n  "version": 1\n}\n';
  expect(json({version:1})).toBe(text);expect(hash(text)).toBe(sha256(Buffer.from(text)));
});
