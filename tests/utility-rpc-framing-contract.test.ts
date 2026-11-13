import {expect,it,vi,afterEach} from 'vitest';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {PiRpc} from '../src/backend/engines/pi/rpc';
import {CodexRpc} from '../src/backend/engines/codex/rpc';

const fixture=vi.hoisted(()=>({spawn:vi.fn()}));
vi.mock('node:child_process',()=>({spawn:fixture.spawn}));
afterEach(()=>{fixture.spawn.mockReset();vi.useRealTimers()});
function child(){
  const process=Object.assign(new EventEmitter(),{stdin:new PassThrough(),stdout:new PassThrough(),stderr:new PassThrough(),kill:vi.fn()});
  fixture.spawn.mockReturnValue(process);return process;
}
it('Codex 单请求超时仍使全部在途失败并终止进程，不按 Pi 策略继续',async()=>{
  vi.useFakeTimers();const process=child(),failed=vi.fn(),rpc=new CodexRpc(async()=>{},async()=>{},failed);
  rpc.start('fixture','.',{},[]);
  const results=Promise.allSettled([rpc.request('slow',{},10),rpc.request('other',{},20)]);
  await vi.advanceTimersByTimeAsync(10);
  expect((await results).map(item=>item.status)).toEqual(['rejected','rejected']);
  expect(failed).toHaveBeenCalledTimes(1);expect(process.kill).toHaveBeenCalledTimes(1);expect(vi.getTimerCount()).toBe(0);
  await expect(rpc.request('later')).rejects.toThrow('slow');process.emit('close',1,null);
});
it('Codex 乱序回包只结算对应请求，重复回包忽略，关闭拒绝剩余项',async()=>{
  const process=child(),failed=vi.fn(),rpc=new CodexRpc(async()=>{},async()=>{},failed);
  rpc.start('fixture','.',{},[]);
  const first=rpc.request('one'),second=rpc.request('two');
  process.stdout.write('{"id":2,"result":"second"}\n{"id":1,"result":"first"}\n{"id":2,"error":{"message":"late"}}\n');
  expect(await Promise.all([first,second])).toEqual(['first','second']);expect(failed).not.toHaveBeenCalled();
  const pending=expect(rpc.request('pending')).rejects.toThrow('已关闭');
  const closing=rpc.close();process.emit('close',0,null);await closing;await pending;
});
it('Pi 继续拆分 CRLF、忽略空白并先交付合法帧；坏 JSON 才报告失败和终止',()=>{
  const process=child(),events:any[]=[],failed=vi.fn(),rpc=new PiRpc(event=>events.push(event),failed);
  rpc.start({command:'fixture',args:[]},'.',[],{});
  process.stdout.write(' \r\n{"type":"message","text":"a');
  process.stdout.write('\u2028b"}\r\ninvalid\n{"type":"later"}\n');
  expect(events).toEqual([{type:'message',text:'a\u2028b'}]);expect(failed).toHaveBeenCalledTimes(1);expect(process.kill).toHaveBeenCalledTimes(1);
});
it('Codex 通知顺序及宿主请求保持独立，关闭仍等待处理及真实退出',async()=>{
  const process=child(),seen:string[]=[],failed=vi.fn();let release!:()=>void;
  const waiting=new Promise<void>(resolve=>release=resolve);
  const rpc=new CodexRpc(async method=>{seen.push(method);if(method==='first')await waiting},async()=>({ok:true}),failed);
  rpc.start('fixture','.',{},[]);
  process.stdout.write('{"method":"first"}\n{"method":"sec');
  process.stdout.write('ond"}\r\n \n');
  await Promise.resolve();expect(seen).toEqual(['first']);
  let closed=false;const closing=rpc.close().then(()=>{closed=true});process.emit('close',0,null);
  await Promise.resolve();expect(closed).toBe(false);release();await closing;
  expect(seen).toEqual(['first','second']);expect(failed).not.toHaveBeenCalled();
});
it('同一多字节完整帧保留 Pi 字符上限与 Codex 字节上限差异',()=>{
  const text='中'.repeat(12*1024*1024),line=JSON.stringify({type:'message',method:'message',text})+'\n';
  const piProcess=child(),event=vi.fn(),piFailed=vi.fn(),pi=new PiRpc(event,piFailed);pi.start({command:'fixture',args:[]},'.',[],{});
  piProcess.stdout.emit('data',line);expect(event).toHaveBeenCalledTimes(1);expect(piFailed).not.toHaveBeenCalled();
  const codexProcess=child(),codexFailed=vi.fn(),codex=new CodexRpc(async()=>{},async()=>{},codexFailed);codex.start('fixture','.',{},[]);
  codexProcess.stdout.emit('data',line);expect(codexFailed.mock.calls[0][0].message).toBe('Codex 消息超出限制');expect(codexProcess.kill).toHaveBeenCalledTimes(1);
});
