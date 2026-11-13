import {expect,it} from 'vitest';
import {InFlightOperations} from '../../../../src/core/utility';

function deferred<T>(){let resolve!:(value:T)=>void,reject!:(reason:unknown)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject}}
it('按 Promise 身份去重，成功/失败保持原值并自动移除，实例相互隔离',async()=>{
  const group=new InFlightOperations(),other=new InFlightOperations(),a=deferred<number>(),b=deferred<void>();
  expect(group.track(a.promise)).toBe(a.promise);group.track(a.promise);group.track(b.promise);
  expect(group.size).toBe(2);expect(other.size).toBe(0);
  const error=Error('failure'),failed=expect(b.promise).rejects.toBe(error);
  a.resolve(7);b.reject(error);expect(await a.promise).toBe(7);await failed;await group.drain();expect(group.size).toBe(0);
});
it('drain 只等待调用时快照，不停止接单、不延伸到后来加入的工作',async()=>{
  const group=new InFlightOperations(),a=deferred<void>(),b=deferred<void>();group.track(a.promise);
  let drained=false;const waiting=group.drain().then(()=>{drained=true});group.track(b.promise);
  await Promise.resolve();expect(drained).toBe(false);a.resolve();await waiting;
  expect(group.size).toBe(1);b.resolve();await group.drain();expect(group.size).toBe(0);
});
it('失败操作不阻断排空，也不产生清理链的未处理拒绝',async()=>{
  const group=new InFlightOperations();
  group.track(Promise.reject(Error('operation failed')));
  await expect(group.drain()).resolves.toBeUndefined();expect(group.size).toBe(0);
});
