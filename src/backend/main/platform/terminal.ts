/**
 * 作用定位：桌面扩展区的命令模式终端，按工作区/页签隔离手动命令与输出。
 * 设计原因：不向渲染层暴露 Node；运行目录固定为工作区根目录，关闭页签/应用终止子进程。
 * 边界：这是逐条命令执行器，不模拟 PTY；交互式程序及跨命令 cd 状态不受支持。
 */
import {spawn,type ChildProcess} from 'node:child_process';
export class TerminalSessions {
 private entries=new Map<string,{process?:ChildProcess;output:string;running:boolean;exitCode:number|null}>();
 start(key:string,cwd:string,command:string){
  if(typeof command!=='string'||!command.trim()||command.length>16000)throw Error('请输入有效命令');
  if(this.entries.get(key)?.running)throw Error('上一条命令仍在运行');
  const entry:{process?:ChildProcess;output:string;running:boolean;exitCode:number|null}={output:'',running:true,exitCode:null};this.entries.set(key,entry);
  const child=spawn(process.platform==='win32'?'powershell.exe':'/bin/sh',process.platform==='win32'?['-NoLogo','-NoProfile','-NonInteractive','-Command',command]:['-c',command],{cwd,windowsHide:true,stdio:['ignore','pipe','pipe']});entry.process=child;
  const append=(chunk:Buffer)=>{entry.output=(entry.output+chunk.toString()).slice(-200000)};child.stdout?.on('data',append);child.stderr?.on('data',append);
  child.once('error',e=>{entry.output+=e.message;entry.running=false});child.once('close',code=>{entry.exitCode=code;entry.running=false});return this.read(key);
 }
 read(key:string){const entry=this.entries.get(key);return entry?{output:entry.output,running:entry.running,exitCode:entry.exitCode}:{output:'',running:false,exitCode:null}}
 close(key:string){const e=this.entries.get(key);if(e?.process&&e.running){if(process.platform==='win32'&&e.process.pid)spawn('taskkill',['/pid',String(e.process.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});else e.process.kill('SIGTERM')}this.entries.delete(key)}
 closeAll(){for(const key of this.entries.keys())this.close(key)}
}
