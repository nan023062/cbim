import {expect,it,vi} from 'vitest';
import {SubscriptionSet} from '../../../../../src/frontend/foundations/utility';

it('实例隔离、注册不通知，同步按插入顺序通知',()=>{
  const first=new SubscriptionSet(),second=new SubscriptionSet(),calls:string[]=[];
  first.subscribe(()=>calls.push('a'));first.subscribe(()=>calls.push('b'));
  second.subscribe(()=>calls.push('other'));
  expect(calls).toEqual([]);first.notify();expect(calls).toEqual(['a','b']);
  expect(first.size).toBe(2);expect(second.size).toBe(1);
});

it('按函数身份去重，任一退订移除重复注册而不做引用计数',()=>{
  const listeners=new SubscriptionSet(),listener=vi.fn();
  const off=listeners.subscribe(listener),again=listeners.subscribe(listener);
  expect(listeners.size).toBe(1);listeners.notify();expect(listener).toHaveBeenCalledTimes(1);
  off();off();expect(listeners.size).toBe(0);listeners.notify();again();
  expect(listener).toHaveBeenCalledTimes(1);
});

it('保留旧退订删除后来同身份订阅的既有行为',()=>{
  const listeners=new SubscriptionSet(),listener=vi.fn(),oldOff=listeners.subscribe(listener);
  oldOff();listeners.subscribe(listener);oldOff();listeners.notify();
  expect(listeners.size).toBe(0);expect(listener).not.toHaveBeenCalled();
});

it('通知期间删除尚未执行的监听器会跳过它',()=>{
  const listeners=new SubscriptionSet(),later=vi.fn();let off=()=>{};
  listeners.subscribe(()=>off());off=listeners.subscribe(later);
  listeners.notify();expect(later).not.toHaveBeenCalled();expect(listeners.size).toBe(1);
});

it('通知期间新加入的监听器参与本轮，重复注册不重复通知',()=>{
  const listeners=new SubscriptionSet(),calls:string[]=[],later=()=>calls.push('later');
  listeners.subscribe(()=>{calls.push('first');listeners.subscribe(later)});
  listeners.notify();expect(calls).toEqual(['first','later']);
  listeners.notify();expect(calls).toEqual(['first','later','first','later']);
});

it('清空不通知也不封闭集合，通知期间清空会跳过后续项',()=>{
  const listeners=new SubscriptionSet(),later=vi.fn();
  listeners.subscribe(()=>listeners.clear());listeners.subscribe(later);
  listeners.notify();expect(listeners.size).toBe(0);expect(later).not.toHaveBeenCalled();
  listeners.subscribe(later);listeners.notify();expect(later).toHaveBeenCalledTimes(1);
  listeners.clear();listeners.clear();expect(later).toHaveBeenCalledTimes(1);
});

it('监听器异常原样抛出并中断本轮，订阅仍保留',()=>{
  const listeners=new SubscriptionSet(),failure=Error('listener failed'),later=vi.fn();
  const off=listeners.subscribe(()=>{throw failure});listeners.subscribe(later);
  expect(()=>listeners.notify()).toThrow(failure);expect(later).not.toHaveBeenCalled();
  expect(listeners.size).toBe(2);off();listeners.notify();expect(later).toHaveBeenCalledTimes(1);
});

it('嵌套通知仍同步执行，不引入排队或合并',()=>{
  const listeners=new SubscriptionSet(),calls:string[]=[];let nested=false;
  listeners.subscribe(()=>{calls.push(nested?'inner-a':'outer-a');if(!nested){nested=true;listeners.notify();nested=false}});
  listeners.subscribe(()=>calls.push(nested?'inner-b':'outer-b'));
  listeners.notify();expect(calls).toEqual(['outer-a','inner-a','inner-b','outer-b']);
});

it('notify 不等待监听器返回的 Promise',async()=>{
  const listeners=new SubscriptionSet(),calls:string[]=[];
  listeners.subscribe(async()=>{calls.push('start');await Promise.resolve();calls.push('done')});
  listeners.subscribe(()=>calls.push('next'));
  expect(listeners.notify()).toBeUndefined();expect(calls).toEqual(['start','next']);
  await Promise.resolve();expect(calls).toEqual(['start','next','done']);
});
