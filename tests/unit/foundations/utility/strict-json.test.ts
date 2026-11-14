import {expect,it} from 'vitest';
import {parseStrictJson,StrictJsonError} from '../../../../src/core/utility';

it('保留数组、标量、对象键和原数值，不加入业务 schema 或危险键裁剪',()=>{
  const value=parseStrictJson('{"__proto__":{"kept":true},"constructor":1,"items":[0,false,null,"正文"]}');
  expect(Object.hasOwn(value,'__proto__')).toBe(true);expect(value.__proto__).toEqual({kept:true});
  expect(value.constructor).toBe(1);expect(value.items).toEqual([0,false,null,'正文']);
  expect(parseStrictJson('null')).toBeNull();expect(parseStrictJson('false')).toBe(false);
  expect(parseStrictJson('[{"id":1},{"id":2}]')).toEqual([{id:1},{id:2}]);
});
it.each(['','{','{"a":1,}','// comment\n{}','{} {}','{"a":}'])('拒绝非法语法而不附加领域错误码：%s',text=>{
  expect(()=>parseStrictJson(text)).toThrow(StrictJsonError);
  try{parseStrictJson(text)}catch(error){expect(error).toMatchObject({reason:'invalid-syntax'});expect(error).not.toHaveProperty('code')}
});
it.each(['{"a":1,"a":2}','{"list":[{"a":1,"\\u0061":2}]}'])('按解码后的键拒绝对象内重复字段：%s',text=>{
  expect(()=>parseStrictJson(text)).toThrow('重复 JSON 字段：a');
  try{parseStrictJson(text)}catch(error){expect(error).toMatchObject({reason:'duplicate-key',key:'a'})}
});
