import {it, expect} from 'vitest';
import {spawn, execFile} from 'node:child_process';
import {once} from 'node:events';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';

const helper=fileURLToPath(new URL('../scripts/desktop-acceptance-process.ps1',import.meta.url));
// CI 使用与验收器相同的 PS7；本机没有 PS7 时仍验证 Windows 自带的真实进程句柄语义。
const shell=process.env.GITHUB_ACTIONS==='true'?'pwsh.exe':'powershell.exe';
const quote=value=>"'"+value.replaceAll("'","''")+"'";

it.skipIf(process.platform!=='win32')('accepts a process that exits after enumeration, while rejecting a live identity mismatch and timeout',async()=>{
  const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{windowsHide:true,stdio:'ignore'});
  const exited=once(child,'exit');let watcher;
  try{
    const base=`. ${quote(helper)}; $p=Get-Process -Id ${child.pid}; `;
    const check=extra=>promisify(execFile)(shell,['-NoProfile','-NonInteractive','-Command',base+extra],{windowsHide:true,timeout:10000});
    await expect(check("Wait-DesktopProcessExit -Process $p -ExpectedPath 'wrong.exe' -TimeoutMilliseconds 10")).rejects.toThrow(/identity changed/);
    await expect(check(`Wait-DesktopProcessExit -Process $p -ExpectedPath ${quote(process.execPath)} -TimeoutMilliseconds 10`)).rejects.toThrow(/timed out/);
    expect(child.exitCode).toBeNull();
    // 两阶段握手，强制 Process 对象先存在、原进程随后退出，再调用真实观察函数。
    watcher=spawn(shell,['-NoProfile','-NonInteractive','-Command',base+
      `[Console]::WriteLine('captured'); [Console]::ReadLine() | Out-Null; Write-Output ('path-after-exit=' + $p.Path); Wait-DesktopProcessExit -Process $p -ExpectedPath ${quote(process.execPath)} -TimeoutMilliseconds 1000`],
      {windowsHide:true,stdio:['pipe','pipe','pipe']});
    const finished=once(watcher,'exit');let output='',error='';
    watcher.stderr.on('data',data=>error+=data);
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error('Watcher did not capture process')),10000);
      watcher.once('error',failure=>{clearTimeout(timer);reject(failure)});
      watcher.stdout.on('data',data=>{output+=data;if(output.includes('captured')){clearTimeout(timer);resolve()}});
    });
    child.kill();await exited;watcher.stdin.end('\n');
    expect((await finished)[0],error).toBe(0);
    expect(output).toMatch(/path-after-exit=\r?\n/);
  }finally{
    if(child.exitCode===null)child.kill();await exited;
    if(watcher?.exitCode===null)watcher.kill();
  }
},30000);
