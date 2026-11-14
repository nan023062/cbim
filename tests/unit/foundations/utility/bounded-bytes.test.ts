import {expect,it,vi} from 'vitest';
import {ByteLimitError,readBoundedBytes} from '../../../../src/core/utility';

it('按字节合并视图，允许精确上限并释放 reader 与监听',async()=>{
  const source=Uint8Array.from([9,97,98,9]),stop=new AbortController();
  const body=new ReadableStream<Uint8Array>({start(c){c.enqueue(source.subarray(1,3));c.enqueue(Uint8Array.of(99));c.close()}});
  const add=vi.spyOn(stop.signal,'addEventListener'),remove=vi.spyOn(stop.signal,'removeEventListener');
  try{
    expect(await readBoundedBytes(body,{maxBytes:3,signal:stop.signal})).toEqual(Uint8Array.from([97,98,99]));
    expect(body.locked).toBe(false);expect(remove).toHaveBeenCalledWith('abort',add.mock.calls[0][1]);
    expect(source).toEqual(Uint8Array.from([9,97,98,9]));
  }finally{add.mockRestore();remove.mockRestore()}
});
it('生产者复用 Buffer 存储时保留已经读取的字节快照',async()=>{
  const storage=Buffer.from([9,97,98,9]);let reads=0;
  const body=new ReadableStream<Uint8Array>({pull(c){
    if(reads++===0)c.enqueue(storage.subarray(1,3));
    else{storage.fill(0);c.close()}
  }},{highWaterMark:0});
  expect(await readBoundedBytes(body,{maxBytes:2})).toEqual(Uint8Array.from([97,98]));
});
it('超限不交付前缀，发起一次取消且不等待底层取消完成',async()=>{
  const cancel=vi.fn((_reason?:unknown)=>new Promise<void>(()=>{}));
  const body=new ReadableStream<Uint8Array>({start(c){c.enqueue(new Uint8Array(4))},cancel});
  await expect(readBoundedBytes(body,{maxBytes:3})).rejects.toMatchObject({name:'ByteLimitError',maxBytes:3});
  expect(cancel).toHaveBeenCalledTimes(1);expect(cancel.mock.calls[0][0]).toBeInstanceOf(ByteLimitError);expect(body.locked).toBe(false);
},1000);
it('取消唤醒挂起 read，保持原 reason；底层不转发信号且 cancel 不完成也不挂起',async()=>{
  let ready!:()=>void;const arrived=new Promise<void>(resolve=>ready=resolve),stop=new AbortController(),reason=Error('cancelled');
  const cancel=vi.fn(()=>new Promise<void>(()=>{}));
  const body=new ReadableStream<Uint8Array>({pull(){ready();return new Promise<void>(()=>{})},cancel},{highWaterMark:0});
  const read=readBoundedBytes(body,{maxBytes:9,signal:stop.signal}),rejected=expect(read).rejects.toBe(reason);
  await arrived;stop.abort(reason);await rejected;
  expect(cancel).toHaveBeenCalledTimes(1);expect(body.locked).toBe(false);
},1000);
it('流本身失败保留原错误，不被失败清理覆盖',async()=>{
  const reason=Error('source failed'),body=new ReadableStream<Uint8Array>({pull(c){c.error(reason)}});
  await expect(readBoundedBytes(body,{maxBytes:9})).rejects.toBe(reason);expect(body.locked).toBe(false);
});
it('空正文和零字节上限有效；非法上限与预取消不接管流',async()=>{
  expect(await readBoundedBytes(null,{maxBytes:0})).toEqual(new Uint8Array());
  const body=new ReadableStream<Uint8Array>({start(c){c.close()}}),get=vi.spyOn(body,'getReader');
  try{
    for(const maxBytes of [-1,0.5,Infinity,NaN,Number.MAX_SAFE_INTEGER+1])await expect(readBoundedBytes(body,{maxBytes})).rejects.toBeInstanceOf(RangeError);
    const stop=new AbortController(),reason=Error('already stopped');stop.abort(reason);
    await expect(readBoundedBytes(body,{maxBytes:0,signal:stop.signal})).rejects.toBe(reason);expect(get).not.toHaveBeenCalled();
    expect(await readBoundedBytes(body,{maxBytes:0})).toEqual(new Uint8Array());
  }finally{get.mockRestore()}
});
it('读取完成同时取消也不返回半截或空成功',async()=>{
  const stop=new AbortController(),reason=Error('stopped at EOF');
  const body=new ReadableStream<Uint8Array>({pull(c){c.close();stop.abort(reason)}},{highWaterMark:0});
  await expect(readBoundedBytes(body,{maxBytes:9,signal:stop.signal})).rejects.toBe(reason);expect(body.locked).toBe(false);
});
