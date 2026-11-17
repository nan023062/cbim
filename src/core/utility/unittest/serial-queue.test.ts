import {expect,it} from 'vitest';
import {SerialQueue} from '..';

it('同实例严格顺序并返回每次结果；异步失败和同步抛错都不污染下一次',async()=>{
  const queue=new SerialQueue(),events:string[]=[];let release!:()=>void;
  const gate=new Promise<void>(resolve=>release=resolve);
  const first=queue.Run(async()=>{events.push('first');await gate;throw Error('failure')});
  const rejected=expect(first).rejects.toThrow('failure');
  const second=queue.Run(()=>{events.push('second');return 42});
  await Promise.resolve();expect(events).toEqual(['first']);release();await rejected;
  expect(await second).toBe(42);expect(events).toEqual(['first','second']);
  await expect(queue.Run(()=>{throw Error('sync')})).rejects.toThrow('sync');
  expect(await queue.Run(()=>3)).toBe(3);
});
it('drain 只等待已提交任务，不拒绝后续入队；不同实例不共享锁',async()=>{
  const queue=new SerialQueue(),other=new SerialQueue();let release!:()=>void;
  const gate=new Promise<void>(resolve=>release=resolve),before=queue.Drain();
  const work=queue.Run(()=>gate);await before;expect(await other.Run(()=>7)).toBe(7);
  let drained=false;const after=queue.Drain().then(()=>{drained=true});await Promise.resolve();expect(drained).toBe(false);
  release();await work;await after;expect(drained).toBe(true);expect(await queue.Run(()=>8)).toBe(8);
});
