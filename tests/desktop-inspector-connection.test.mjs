import {it,expect} from 'vitest';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {connectDesktopInspector} from '../scripts/desktop-inspector-connection.mjs';

// 真实调试协议集成验证，仅启动本套件自己的空 Node 子进程，不加载 Application 或桌面用户数据。
it('reconnects to a real process, correlates replies, reports errors and releases pending calls',async()=>{
  const child=spawn(process.execPath,['--inspect=127.0.0.1:0','-e','setInterval(()=>{},1000)'],{windowsHide:true,stdio:['ignore','ignore','pipe']});
  const exited=once(child,'exit');let connection;
  try{
    const url=await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error('Inspector did not start')),10000);let stderr='';
      child.once('error',error=>{clearTimeout(timer);reject(error)});
      child.stderr.on('data',chunk=>{stderr+=chunk;const match=stderr.match(/Debugger listening on (ws:\/\/[^\s]+)/);if(match){clearTimeout(timer);resolve(match[1])}});
    });
    connection=await connectDesktopInspector(url);
    expect(await connection.evaluate('({pid:process.pid,require:typeof require})')).toEqual({pid:child.pid,require:'function'});
    const slow=connection.evaluate('new Promise(resolve=>setTimeout(()=>resolve("slow"),40))');
    const fast=connection.evaluate('Promise.resolve("fast")');
    expect(await fast).toBe('fast');expect(await slow).toBe('slow');
    await expect(connection.evaluate('(()=>{throw Error("intentional evaluation failure")})()')).rejects.toThrow('intentional evaluation failure');
    expect(await connection.evaluate('6*7')).toBe(42);
    const pending=expect(connection.evaluate('new Promise(()=>{})')).rejects.toThrow('disconnected');
    connection.close();await pending;
    connection=await connectDesktopInspector(url);
    expect(await connection.evaluate('process.pid')).toBe(child.pid);
  }finally{connection?.close();child.kill();await exited}
},20000);

it('rejects non-local endpoints before opening a connection',async()=>{
  await expect(connectDesktopInspector('ws://example.com/inspector')).rejects.toThrow();
  await expect(connectDesktopInspector('http://127.0.0.1/inspector')).rejects.toThrow();
});
