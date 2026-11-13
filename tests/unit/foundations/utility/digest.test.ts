import {expect,it} from 'vitest';
import {sha256} from '../../../../src/backend/core/foundation/utility/node';

it('标准向量固定为 SHA-256 小写十六进制，字符串与 UTF-8 字节一致',()=>{
  expect(sha256('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  expect(sha256('正文😀')).toBe(sha256(new TextEncoder().encode('正文😀')));
});
it('只散列字节视图覆盖范围，保留输入且不将字节当作字符串转换',()=>{
  const bytes=Uint8Array.from([0,97,98,99,255]),before=bytes.slice();
  expect(sha256(bytes.subarray(1,4))).toBe(sha256('abc'));expect(bytes).toEqual(before);
  expect(sha256(Uint8Array.from([255]))).not.toBe(sha256('255'));
});
