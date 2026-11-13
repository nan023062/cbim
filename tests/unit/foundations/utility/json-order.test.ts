import {expect,it} from 'vitest';
import {orderJsonValue} from '../../../../src/backend/core/foundation/utility';

const compareKeys=(a:string,b:string)=>a<b?-1:a>b?1:0;
it('递归排列对象键，保持数组顺序且不改变原对象',()=>{
  const input={z:[{b:2,a:1},3,1],a:{z:0,a:1}};
  const result=orderJsonValue(input,{compareKeys});
  expect(JSON.stringify(result)).toBe('{"a":{"a":1,"z":0},"z":[{"a":1,"b":2},3,1]}');
  expect(Object.keys(input)).toEqual(['z','a']);expect(result).not.toBe(input);
});
it('比较器决定排序，整数键仍按 JS 枚举；危险名称作为普通数据保留',()=>{
  const input=JSON.parse('{"a":1,"Z":2,"10":10,"2":2,"__proto__":{"x":1}}');
  const result=orderJsonValue(input,{compareKeys:(a,b)=>-compareKeys(a,b)}) as object;
  expect(Object.keys(result)).toEqual(['2','10','a','__proto__','Z']);
  expect(Object.hasOwn(result,'__proto__')).toBe(true);expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
});
it('undefined 对象字段规则显式选择，数组空位与 undefined 元素不裁剪',()=>{
  const input={b:undefined,a:[,undefined,{b:undefined,a:1}]};
  const kept=orderJsonValue(input,{compareKeys}) as typeof input;
  const dropped=orderJsonValue(input,{compareKeys,omitUndefinedProperties:true}) as typeof input;
  expect(Object.hasOwn(kept,'b')).toBe(true);expect(Object.hasOwn(dropped,'b')).toBe(false);
  expect(dropped.a.length).toBe(3);expect(0 in dropped.a).toBe(false);expect(1 in dropped.a).toBe(true);
  expect(dropped.a[2]).toEqual({a:1});expect(input.a[2]).toHaveProperty('b');
});
it('原始值及比较错误原样返回，不做 JSON 校验或错误翻译',()=>{
  for(const value of [null,undefined,NaN,Infinity,1n,'正文'])expect(orderJsonValue(value,{compareKeys})).toBe(value);
  const reason=Error('compare');expect(()=>orderJsonValue({b:1,a:2},{compareKeys:()=>{throw reason}})).toThrow(reason);
});
