import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
import {PendingRequests} from '../../../../src/backend/core/foundation/utility';
beforeEach(()=>vi.useFakeTimers());
afterEach(()=>vi.useRealTimers());
describe('PendingRequests',()=>{
  it('乱序与重复回包按 ID 隔离，取出即清定时器',()=>{
    const table=new PendingRequests<string,number>(),one={resolve:vi.fn(),reject:vi.fn()},two={resolve:vi.fn(),reject:vi.fn()},expired=vi.fn();
    table.register('one',one,10,expired);table.register('two',two,10,expired);
    table.take('two')!.resolve(2);expect(two.resolve).toHaveBeenCalledWith(2);expect(one.resolve).not.toHaveBeenCalled();
    expect(table.take('two')).toBeUndefined();expect(table.take('unknown')).toBeUndefined();
    table.take('one')!.reject(Error('rejected'));vi.advanceTimersByTime(20);expect(expired).not.toHaveBeenCalled();expect(vi.getTimerCount()).toBe(0);
  });
  it('超时策略可只失败单项，另一项及其他实例继续等待',()=>{
    const table=new PendingRequests<number>(),other=new PendingRequests<number>(),reject=vi.fn(),resolve=vi.fn();
    table.register(1,{resolve,reject},10,()=>table.take(1)!.reject(Error('timeout')));
    table.register(2,{resolve,reject},20,()=>{});other.register(1,{resolve,reject},20,()=>{});
    vi.advanceTimersByTime(10);expect(reject).toHaveBeenCalledTimes(1);expect(table.take(1)).toBeUndefined();
    expect(table.take(2)).toBeDefined();expect(other.take(1)).toBeDefined();expect(vi.getTimerCount()).toBe(0);
  });
  it('整体失败结算所有项并清定时器，可在之后登记新项',()=>{
    const table=new PendingRequests<number>(),reject=vi.fn(),error=Error('closed');
    table.register(1,{resolve:vi.fn(),reject},10,()=>table.rejectAll(error));
    table.register(2,{resolve:vi.fn(),reject},20,()=>{});vi.advanceTimersByTime(10);
    expect(reject).toHaveBeenCalledTimes(2);expect(reject).toHaveBeenLastCalledWith(error);expect(vi.getTimerCount()).toBe(0);
    table.rejectAll(error);expect(reject).toHaveBeenCalledTimes(2);
    table.register(1,{resolve:vi.fn(),reject},10,()=>{});expect(table.take(1)).toBeDefined();
  });
  it('重复 ID 不覆盖原回调或泄露新计时器',()=>{
    const table=new PendingRequests<string>(),reject=vi.fn();
    table.register('id',{resolve:vi.fn(),reject},10,()=>{});
    expect(()=>table.register('id',{resolve:vi.fn(),reject:vi.fn()},10,()=>{})).toThrow('Duplicate');
    expect(vi.getTimerCount()).toBe(1);table.rejectAll(Error('stop'));expect(reject).toHaveBeenCalledOnce();expect(vi.getTimerCount()).toBe(0);
  });
  it('关闭可以为各请求生成独立错误，不合并原错误身份',()=>{
    const table=new PendingRequests<number>(),reject=vi.fn();
    for(const id of [1,2])table.register(id,{resolve:vi.fn(),reject},10,()=>{});
    table.rejectAll(()=>Error('closed'));
    expect(reject.mock.calls[0][0]).not.toBe(reject.mock.calls[1][0]);expect(vi.getTimerCount()).toBe(0);
  });
});
