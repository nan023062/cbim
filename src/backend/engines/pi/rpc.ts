/**
 * 目录归属：backend/engines/pi；Pi 引擎适配。
 * 作用定位：大脑 执行层：PiRpc：JSONL 拆包、命令关联、超时与进程结束处理。
 * 关联边界：PendingRequests 仅保存回调与定时器；超时、发送失败、关闭和进程处置仍归本协议适配器。
 * 设计原因：图片事件保留每行 32×1024×1024 个 UTF-16 code unit 限制；utility 提供拆帧和关联表，协议结算、进程退出与脱敏留在本适配器，超时命令不自动重放。
 */
import {spawn,type ChildProcessWithoutNullStreams} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {PendingRequests,LineFramer} from '../../core/foundation/utility';

/** 要启动的程序、前置参数和环境覆盖；以 shell:false 隐藏启动并用管道通信。 */
export interface PiCommand {command:string;args:string[];env?:NodeJS.ProcessEnv}
export class PiRpc {
  private child?:ChildProcessWithoutNullStreams;
  private dead=false;
  /** 保留 Pi 的 UTF-16 长度与完整行去 CR/忽略空白规则，不改为字节限制。 */
  private readonly frames=new LineFramer({
    checkLine:raw=>{const line=raw.replace(/\r$/,'');if(line.trim()&&line.length>32*1024*1024)throw Error('Pi 事件超过大小限制')},
    checkRemainder:text=>{if(text.length>32*1024*1024)throw Error('Pi 事件超过大小限制')},
  });
  private pending=new PendingRequests<string,any>();
  private exitPromise?:Promise<void>;
  constructor(private onEvent:(event:any)=>void,private onExit:(error:Error)=>void,private redact:(message:string)=>string=message=>message){}
  start(config:PiCommand,cwd:string,args:string[],env:NodeJS.ProcessEnv){
    this.child=spawn(config.command,[...config.args,...args],{cwd,env:{...env,...config.env},windowsHide:true,shell:false,stdio:'pipe'});
    const child=this.child;child.stdout.setEncoding('utf8');child.stderr.resume();
    this.exitPromise=new Promise(resolve=>{
      child.once('error',error=>{this.fail(error);resolve()});
      child.once('close',(code,signal)=>{this.fail(Error(`Pi 进程已退出 (${code??signal})`));resolve()});
    });
    child.stdin.on('error',error=>this.fail(error));
    child.stdout.on('data',(chunk:string)=>{
      // 用户消息事件包含图片 base64；容纳附件总计 20 MiB 后的编码开销，仍限制单行大小。
      try{this.frames.push(chunk,raw=>{
        const line=raw.replace(/\r$/,'');if(!line.trim())return;
          const event=JSON.parse(line);
          if(event.type==='response'){
            const pending=this.pending.take(event.id);if(!pending)return;
            if(event.success)pending.resolve(event.data);else pending.reject(Error(this.redact(String(event.error||'Pi 拒绝命令'))));
          }else this.onEvent(event);
      })}catch(error){this.fail(error instanceof Error?error:Error(String(error)));child.kill()}
    });
  }
  /** 使用独立命令 ID 等待对应回复；超时只报告未知结果，不自动重试。 */
  request(type:string,data:Record<string,unknown>={},timeoutMs=30000):Promise<any>{
    if(this.dead||!this.child) return Promise.reject(Error('Pi 进程不可用'));
    const id=randomUUID();
    return new Promise((resolve,reject)=>{
      this.pending.register(id,{resolve,reject},timeoutMs,()=>{this.pending.take(id);reject(Error(`Pi ${type} 请求超时；不自动重放`))});
      this.send({...data,id,type});
    });
  }
  send(value:unknown){if(this.dead||!this.child)throw Error('Pi 进程不可用');this.child.stdin.write(JSON.stringify(value)+'\n')}
  private fail(error:Error){
    error=Error(this.redact(error.message));
    if(this.dead)return;this.dead=true;
    this.pending.rejectAll(error);this.onExit(error);
  }
  /** 关闭 stdin 并等待子进程退出，超过宽限期后终止子进程。 */
  async close(){
    if(!this.child)return;
    this.child.stdin.end();
    const timer=setTimeout(()=>this.child?.kill(),1500);
    try{await this.exitPromise}finally{clearTimeout(timer)}
  }
}
