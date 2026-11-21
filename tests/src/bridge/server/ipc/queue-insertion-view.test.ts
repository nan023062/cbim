// bridge/server/ipc: module-owned contract coverage; keep the original scenario and cleanup semantics.
import {expect,it,vi} from 'vitest';
import {dispatchApplication} from '../../../../../src/bridge/server/ipc/dispatch';
import type {ApplicationServices} from '../../../../../src/bridge/server/ipc/services';


it('IPC 原样转交 expectedRunId，旧缺字段请求不能被路由补成当前运行',async()=>{
  const insertion=vi.fn(async(_task:string,_queue:string,expected:string)=>{if(expected===undefined)throw Object.assign(Error('没有原run'),{code:'QUEUE_INSERT_STALE'});return {taskId:'root',runId:expected}}),execution=vi.fn(()=>({InsertQueued:insertion})),app={Execution: execution} as unknown as ApplicationServices;
  await dispatchApplication(app,'loop.queueInsert',{id:'workspace',taskId:'root',queueId:'q',expectedRunId:'old-run'});expect(execution).toHaveBeenLastCalledWith('workspace');expect(insertion).toHaveBeenLastCalledWith('root','q','old-run');
  for(const missing of [{},{expectedRunId:''}])await expect(dispatchApplication(app,'loop.queueInsert',{id:'workspace',taskId:'root',queueId:'q',...missing})).rejects.toMatchObject({code:'QUEUE_INSERT_STALE'});
  // 严格边界在进入执行服务前拒绝旧请求，但不改变错误码，也不会补成当前运行。
  expect(insertion).toHaveBeenCalledTimes(1);expect(execution).toHaveBeenCalledTimes(1);
});
