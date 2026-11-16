import {expect,it} from 'vitest';
import {JsonUtils} from '../../../../src/core/utility';

it('保持键顺序、两空格缩进和末尾 LF；不改变原数据',()=>{
  const input={z:'正文😀',a:[1,null],missing:undefined};
  expect(JsonUtils.formatJson(input)).toBe('{\n  "z": "正文😀",\n  "a": [\n    1,\n    null\n  ]\n}\n');
  expect(Object.keys(input)).toEqual(['z','a','missing']);expect(input.missing).toBeUndefined();
});
it('保留原 stringify 特殊值和失败语义，不伪造合法 JSON',()=>{
  expect(JsonUtils.formatJson(undefined)).toBe('undefined\n');expect(JsonUtils.formatJson(NaN)).toBe('null\n');
  const circular:{self?:unknown}={};circular.self=circular;
  expect(()=>JsonUtils.formatJson(circular)).toThrow(TypeError);expect(()=>JsonUtils.formatJson(1n)).toThrow(TypeError);
});
