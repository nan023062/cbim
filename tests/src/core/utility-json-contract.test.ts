import {expect,it} from 'vitest';
import {parseJson} from '../../../src/logic/io-errors/json';
import {JsonUtils} from '../../../src/core/io';

it('严格 JSON 解析失败保留具体原因，并抛出原生 Error',()=>{
  for(const [text,message] of [['{','JSON 格式无效'],['{"a":1,"a":2}','重复 JSON 字段：a']]){
    try{parseJson(text);throw Error('expected parsing failure')}catch(error){
      expect(Object.getPrototypeOf(error)).toBe(Error.prototype);
      expect(error).toMatchObject({message});
      expect(error).not.toHaveProperty('code');
      expect(Object.hasOwn(error as Error,'name')).toBe(false);
    }
  }
  const text='{"list":[0,false,null,{"a":1}]}';expect(parseJson(text)).toEqual(JsonUtils.ParseStrictJson(text));
});
