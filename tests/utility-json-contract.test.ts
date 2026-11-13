import {expect,it} from 'vitest';
import {parseJson} from '../src/backend/core/foundation/json';
import {Fault} from '../src/backend/core/foundation/errors';
import {parseStrictJson} from '../src/foundations/utility';

it('Core 保留 JSON Fault 的 code、name 和原提示，不泄漏 utility 错误类型',()=>{
  for(const [text,message] of [['{','JSON 格式无效'],['{"a":1,"a":2}','重复 JSON 字段：a']]){
    try{parseJson(text);throw Error('expected parsing failure')}catch(error){
      expect(error).toBeInstanceOf(Fault);expect(error).toMatchObject({code:'JSON',name:'JSON',message});
    }
  }
  const text='{"list":[0,false,null,{"a":1}]}';expect(parseJson(text)).toEqual(parseStrictJson(text));
});
