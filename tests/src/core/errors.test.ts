import {expect,test} from 'vitest';
import {Fault,fail} from '../../../src/core/errors';

test('Fault 保留调用者错误码、名称、消息与 Error 身份',()=>{
  const error=new Fault('MODEL_UNAVAILABLE','模型不可用');
  expect(error).toBeInstanceOf(Error);
  expect(error).toMatchObject({code:'MODEL_UNAVAILABLE',name:'MODEL_UNAVAILABLE',message:'模型不可用'});
});
test('fail 原样抛出 Fault，不吞错或改写业务错误',()=>{
  expect(()=>fail('SAVE_FAILED','写入失败')).toThrow(Fault);
  try{fail('SAVE_FAILED','写入失败')}catch(error){expect(error).toMatchObject({code:'SAVE_FAILED',message:'写入失败'})}
});
