import {expect,it,vi} from 'vitest';
import vm from 'node:vm';
import {requestBudgetBootstrap} from '../src/backend/engines/pi/request-budget-bootstrap';

it('forwards the authenticated local tool manifest without allowing other origins, routes or query parameters',async()=>{
  const input={bridge:'http://127.0.0.1:2001',endpoint:'https://model.invalid/v1/chat/completions',proxy:'http://127.0.0.1:2002',token:'fixture-budget-token'};
  const original=vi.fn(async(_url:string,_init?:RequestInit)=>new Response('{}',{status:200}));
  const sandbox={fetch:original as typeof fetch,Request,URL};
  await vm.runInNewContext('(async()=>{'+requestBudgetBootstrap(input)+'})()',sandbox);
  expect(original).toHaveBeenCalledTimes(1);
  const payload=JSON.stringify({active:['cbim_feedback_status']});
  await sandbox.fetch(input.bridge+'/tools',{method:'POST',headers:{Authorization:'Bearer fixture-bridge-token'},body:payload});
  const [url,options]=original.mock.calls[1];
  expect(url).toBe(input.bridge+'/tools');expect(options?.headers).toMatchObject({authorization:'Bearer fixture-bridge-token'});
  expect(Buffer.from(options!.body as ArrayBuffer).toString()).toBe(payload);expect(options?.redirect).toBe('error');
  for(const target of ['http://127.0.0.1:2003/tools','https://external.invalid/tools',input.bridge+'/tools?override=1',input.bridge+'/tools#override',input.bridge+'/tools/extra',input.bridge+'/other']){
    await expect(sandbox.fetch(target,{method:'POST',body:payload})).rejects.toThrow('CBIM_MODEL_REQUEST_TARGET_DENIED');
  }
  expect(original).toHaveBeenCalledTimes(2);
});
