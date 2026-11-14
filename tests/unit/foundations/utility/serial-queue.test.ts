import {expect,it} from 'vitest';
import {SerialQueue} from '../../../../src/core/utility';

it('同实例严格顺序并返回每次结果；异步失败和同步抛错都不污染下一次',async()=>{
  const queue=new SerialQueue(),events:string[]=[];let release!:()=>void;
  const gate=new Promise<void>(resolve=>release=resolve);
  const first=queue.run(async()=>{events.push('first');await gate;throw Error('failure')});
  const rejected=expect(first).rejects.toThrow('failure');
  const second=queue.run(()=>{events.push('second');return 42});
  await Promise.resolve();expect(events).toEqual(['first']);release();await rejected;
  expect(await second).toBe(42);expect(events).toEqual(['first','second']);
  await expect(queue.run(()=>{throw Error('sync')})).rejects.toThrow('sync');
  expect(await queue.run(()=>3)).toBe(3);
});
it('drain 只等待已提交任务，不拒绝后续入队；不同实例不共享锁',async()=>{
  const queue=new SerialQueue(),other=new SerialQueue();let release!:()=>void;
  const gate=new Promise<void>(resolve=>release=resolve),before=queue.drain();
  const work=queue.run(()=>gate);await before;expect(await other.run(()=>7)).toBe(7);
  let drained=false;const after=queue.drain().then(()=>{drained=true});await Promise.resolve();expect(drained).toBe(false);
  release();await work;await after;expect(drained).toBe(true);expect(await queue.run(()=>8)).toBe(8);
});
