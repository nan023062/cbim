/**
 * 作用定位：大脑 执行层：PiRpc：JSONL 拆包、命令关联、超时与进程结束处理。
 * 设计原因：图片事件按单行限制为 32 MiB，容纳受限附件的编码开销；将 JSONL 拆包、命令关联和进程退出统一处理，超时命令不自动重放；错误出口使用注入的脱敏函数去除模型凭据。
 */
import {spawn,type ChildProcessWithoutNullStreams} from 'node:child_process';
import {randomUUID} from 'node:crypto';

/** 要启动的程序、前置参数和环境覆盖；以 shell:false 隐藏启动并用管道通信。 */
export interface PiCommand {command:string;args:string[];env?:NodeJS.ProcessEnv}
export class PiRpc {
  private child?:ChildProcessWithoutNullStreams;
  private buffer='';private dead=false;
  private pending=new Map<string,{resolve:(v:any)=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
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
      this.buffer+=chunk;
      let offset:number;
      while((offset=this.buffer.indexOf('\n'))>=0){
        const line=this.buffer.slice(0,offset).replace(/\r$/,'');this.buffer=this.buffer.slice(offset+1);if(!line.trim())continue;
        if(line.length>32*1024*1024){this.fail(Error('Pi 事件超过大小限制'));child.kill();return}
        try{
          const event=JSON.parse(line);
          if(event.type==='response'){
            const pending=this.pending.get(event.id);if(!pending)continue;
            clearTimeout(pending.timer);this.pending.delete(event.id);
            if(event.success)pending.resolve(event.data);else pending.reject(Error(this.redact(String(event.error||'Pi 拒绝命令'))));
          }else this.onEvent(event);
        }catch(error){this.fail(error instanceof Error?error:Error(String(error)));child.kill();return}
      }
      if(this.buffer.length>32*1024*1024){this.fail(Error('Pi 事件超过大小限制'));child.kill()}
    });
  }
  /** 使用独立命令 ID 等待对应回复；超时只报告未知结果，不自动重试。 */
  request(type:string,data:Record<string,unknown>={},timeoutMs=30000):Promise<any>{
    if(this.dead||!this.child) return Promise.reject(Error('Pi 进程不可用'));
    const id=randomUUID();
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.pending.delete(id);reject(Error(`Pi ${type} 请求超时；不自动重放`))},timeoutMs);
      this.pending.set(id,{resolve,reject,timer});this.send({...data,id,type});
    });
  }
  send(value:unknown){if(this.dead||!this.child)throw Error('Pi 进程不可用');this.child.stdin.write(JSON.stringify(value)+'\n')}
  private fail(error:Error){
    error=Error(this.redact(error.message));
    if(this.dead)return;this.dead=true;
    for(const item of this.pending.values()){clearTimeout(item.timer);item.reject(error)}this.pending.clear();this.onExit(error);
  }
  /** 关闭 stdin 并等待子进程退出，超过宽限期后终止子进程。 */
  async close(){
    if(!this.child)return;
    this.child.stdin.end();
    const timer=setTimeout(()=>this.child?.kill(),1500);
    try{await this.exitPromise}finally{clearTimeout(timer)}
  }
}
