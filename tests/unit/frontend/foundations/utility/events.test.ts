import {expect,it,vi} from 'vitest';
import {SubscriptionSet} from '../../../../../src/view/foundations/utility';

it('实例隔离、注册不通知，同步按插入顺序通知',()=>{
  const first=new SubscriptionSet(),second=new SubscriptionSet(),calls:string[]=[];
  first.Subscribe(()=>calls.push('a'));first.Subscribe(()=>calls.push('b'));
  second.Subscribe(()=>calls.push('other'));
  expect(calls).toEqual([]);first.Notify();expect(calls).toEqual(['a','b']);
  expect(first.size).toBe(2);expect(second.size).toBe(1);
});

it('按函数身份去重，任一退订移除重复注册而不做引用计数',()=>{
  const listeners=new SubscriptionSet(),listener=vi.fn();
  const off=listeners.Subscribe(listener),again=listeners.Subscribe(listener);
  expect(listeners.size).toBe(1);listeners.Notify();expect(listener).toHaveBeenCalledTimes(1);
  off();off();expect(listeners.size).toBe(0);listeners.Notify();again();
  expect(listener).toHaveBeenCalledTimes(1);
});

it('保留旧退订删除后来同身份订阅的既有行为',()=>{
  const listeners=new SubscriptionSet(),listener=vi.fn(),oldOff=listeners.Subscribe(listener);
  oldOff();listeners.Subscribe(listener);oldOff();listeners.Notify();
  expect(listeners.size).toBe(0);expect(listener).not.toHaveBeenCalled();
});

it('通知期间删除尚未执行的监听器会跳过它',()=>{
  const listeners=new SubscriptionSet(),later=vi.fn();let off=()=>{};
  listeners.Subscribe(()=>off());off=listeners.Subscribe(later);
  listeners.Notify();expect(later).not.toHaveBeenCalled();expect(listeners.size).toBe(1);
});

it('通知期间新加入的监听器参与本轮，重复注册不重复通知',()=>{
  const listeners=new SubscriptionSet(),calls:string[]=[],later=()=>calls.push('later');
  listeners.Subscribe(()=>{calls.push('first');listeners.Subscribe(later)});
  listeners.Notify();expect(calls).toEqual(['first','later']);
  listeners.Notify();expect(calls).toEqual(['first','later','first','later']);
});

it('清空不通知也不封闭集合，通知期间清空会跳过后续项',()=>{
  const listeners=new SubscriptionSet(),later=vi.fn();
  listeners.Subscribe(()=>listeners.Clear());listeners.Subscribe(later);
  listeners.Notify();expect(listeners.size).toBe(0);expect(later).not.toHaveBeenCalled();
  listeners.Subscribe(later);listeners.Notify();expect(later).toHaveBeenCalledTimes(1);
  listeners.Clear();listeners.Clear();expect(later).toHaveBeenCalledTimes(1);
});

it('监听器异常原样抛出并中断本轮，订阅仍保留',()=>{
  const listeners=new SubscriptionSet(),failure=Error('listener failed'),later=vi.fn();
  const off=listeners.Subscribe(()=>{throw failure});listeners.Subscribe(later);
  expect(()=>listeners.Notify()).toThrow(failure);expect(later).not.toHaveBeenCalled();
  expect(listeners.size).toBe(2);off();listeners.Notify();expect(later).toHaveBeenCalledTimes(1);
});

it('嵌套通知仍同步执行，不引入排队或合并',()=>{
  const listeners=new SubscriptionSet(),calls:string[]=[];let nested=false;
  listeners.Subscribe(()=>{calls.push(nested?'inner-a':'outer-a');if(!nested){nested=true;listeners.Notify();nested=false}});
  listeners.Subscribe(()=>calls.push(nested?'inner-b':'outer-b'));
  listeners.Notify();expect(calls).toEqual(['outer-a','inner-a','inner-b','outer-b']);
});

it('notify 不等待监听器返回的 Promise',async()=>{
  const listeners=new SubscriptionSet(),calls:string[]=[];
  listeners.Subscribe(async()=>{calls.push('start');await Promise.resolve();calls.push('done')});
  listeners.Subscribe(()=>calls.push('next'));
  expect(listeners.Notify()).toBeUndefined();expect(calls).toEqual(['start','next']);
  await Promise.resolve();expect(calls).toEqual(['start','next','done']);
});
