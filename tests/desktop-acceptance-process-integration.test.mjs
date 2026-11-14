import {it, expect} from 'vitest';
import {spawn,execFile} from 'node:child_process';
import {once} from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import electronPath from 'electron';
import {_electron as electron} from 'playwright-core';
import {connectDesktopInspector} from '../scripts/desktop-inspector-connection.mjs';
import {DesktopAcceptanceProcess, ownLaunchedDesktop} from '../scripts/desktop-acceptance-process.mjs';

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

it.skipIf(process.platform!=='win32')('captures and closes the actual Electron process rather than its Windows launcher',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-acceptance-electron-'));
  const executablePath=await fs.realpath(electronPath);let application,owner;
  try{
    const entry=path.join(root,'main.cjs');
    await fs.writeFile(entry,"const {app,BrowserWindow}=require('electron');app.setPath('userData',require('path').join(__dirname,'profile'));app.whenReady().then(()=>{new BrowserWindow({show:false}).loadURL('data:text/html,acceptance')});");
    const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
    application=await electron.launch({executablePath,args:[entry],env,timeout:20000});
    const launcherPid=application.process().pid;
    const shell=process.env.GITHUB_ACTIONS==='true'?'pwsh.exe':'powershell.exe';
    owner=await ownLaunchedDesktop(application,{executablePath,waitForExit:async(pid,{signal,timeoutMs})=>{
      await promisify(execFile)(shell,['-NoProfile','-NonInteractive','-File',
        fileURLToPath(new URL('../scripts/desktop-acceptance-process.ps1',import.meta.url)),
        '-TargetProcessId',String(pid),'-ExpectedPath',executablePath,'-TimeoutMilliseconds',String(timeoutMs)],
        {windowsHide:true,signal,timeout:timeoutMs+5000});
    }});
    expect(owner.pid).toBe(await application.evaluate(()=>process.pid));
    expect(owner.pid).not.toBe(launcherPid);
    await owner.close();expect(owner.state).toBe('closed');
    expect(()=>owner.firstWindow()).toThrow(/no longer active/);
  }finally{
    if(owner)await owner.close().catch(()=>{});else await application?.close().catch(()=>{});
    const absolute=path.resolve(root);
    if(path.dirname(absolute)!==path.resolve(os.tmpdir())||!path.basename(absolute).startsWith('cbim-acceptance-electron-'))throw Error('Unexpected cleanup root');
    await fs.rm(absolute,{recursive:true,force:true});
  }
},30000);
