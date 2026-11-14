import {it, expect} from 'vitest';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {connectDesktopInspector} from '../scripts/desktop-inspector-connection.mjs';
import {DesktopAcceptanceProcess} from '../scripts/desktop-acceptance-process.mjs';

// 自有空 Node 进程验证真实调试器退出屏障；不加载 Application 或用户桌面。
it.each(['normal-quit','ui-handoff'])('releases an attached debugger and observes real process exit: %s',async kind=>{
  const child=spawn(process.execPath,['--inspect=127.0.0.1:0','-e','setInterval(()=>{},1000)'],{windowsHide:true,stdio:['ignore','ignore','pipe']});
  const exited=once(child,'exit');let connection;
  try{
    const url=await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error('Inspector startup timeout')),10000);let text='';
      child.once('error',error=>{clearTimeout(timer);reject(error)});
      child.stderr.on('data',chunk=>{text+=chunk;const match=text.match(/Debugger listening on (ws:\/\/[^\s]+)/);if(match){clearTimeout(timer);resolve(match[1])}});
    });
    connection=await connectDesktopInspector(url);
    const pid=await connection.evaluate('process.pid');expect(pid).toBe(child.pid);
    const quit=()=>connection.evaluate('setImmediate(()=>process.exit(0));undefined');
    const processOwner=new DesktopAcceptanceProcess({pid,transport:{
      evaluate:fn=>connection.evaluate(`(${fn.toString()})()`),
      firstWindow:()=>{throw Error('No renderer in this integration fixture')},
      quit,disconnect:()=>connection.close(),
    },waitForExit:async(_, {signal})=>{
      await new Promise((resolve,reject)=>{
        const abort=()=>reject(Error('Exit observation aborted'));
        signal.addEventListener('abort',abort,{once:true});
        exited.then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));
      });
    }});
    if(kind==='normal-quit')await processOwner.close();else await processOwner.exitAfter(quit,'installer');
    expect(child.exitCode).toBe(0);expect(processOwner.state).toBe('closed');
    expect(processOwner.pid).toBe(pid);await processOwner.close();
  }finally{await connection?.close();if(child.exitCode===null)child.kill();await exited}
},20000);
