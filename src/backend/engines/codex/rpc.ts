/**
 * 目录归属：backend/engines/codex；Codex 引擎适配。
 * 作用定位：Codex App Server 的双向 JSONL 通信，分别关联宿主请求、原生请求和通知。
 * 关联边界：PendingRequests 仅保存回调与定时器；超时、发送失败、关闭和进程处置仍归本协议适配器。
 * 设计原因：工具调用需要宿主可靠回包；顺序处理通知但不阻塞响应关联，避免授权等待造成通信死锁。
 * 职责边界：超时/坏协议终止原进程，不自动重发；close 等待真实退出和已接收处理排空。
 */
import {spawn,type ChildProcessWithoutNullStreams} from 'node:child_process';
import {PendingRequests,LineFramer,InFlightOperations} from '../../../foundations/utility';

export class CodexRpc {
  private child?:ChildProcessWithoutNullStreams;private exit?:Promise<void>;private closing=false;private failure?:Error;private sequence=0;
  /** 完整非空行及尾部均保留 UTF-8 字节限额；CR 仍包含在完整行的计量内。 */
  private readonly frames=new LineFramer({
    checkLine:line=>{if(line.trim()&&Buffer.byteLength(line)>32*1024*1024)throw Error('Codex 消息超出限制')},
    checkRemainder:text=>{if(Buffer.byteLength(text)>32*1024*1024)throw Error('Codex 消息超出限制')},
  });
  private pending=new PendingRequests<number,any>();
  private handling=new InFlightOperations();
  private notifications:Promise<void>=Promise.resolve();
  constructor(private notify:(method:string,params:any)=>Promise<void>,private requestHandler:(method:string,params:any)=>Promise<unknown>,private failed:(error:Error)=>void){}
  start(binary:string,cwd:string,env:NodeJS.ProcessEnv,args:string[]){
    const child=this.child=spawn(binary,['app-server','--listen','stdio://',...args],{cwd,env,windowsHide:true,shell:false,stdio:'pipe'});
    this.exit=new Promise(resolve=>{child.once('error',error=>{this.fail(error);resolve()});child.once('close',(code,signal)=>{if(!this.closing)this.fail(Error('Codex 进程提前退出 ('+(code??signal)+')'));resolve()})});
    child.stderr.resume();child.stdin.on('error',error=>this.fail(error));child.stdout.setEncoding('utf8');
    child.stdout.on('data',(chunk:string)=>{
      try{this.frames.push(chunk,line=>{if(line.trim())this.receive(JSON.parse(line))})}catch(error){this.fail(error instanceof Error?error:Error(String(error)))}
    });
  }
  private receive(value:any){
    if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Codex 返回无效协议消息');
    if(typeof value.method==='string'){
      const work=(value.id!==undefined?(async()=>{const result=await this.requestHandler(value.method,value.params);this.send({id:value.id,result})})():this.notifications.then(()=>this.notify(value.method,value.params))).catch(error=>this.fail(error instanceof Error?error:Error(String(error))));
      if(value.id===undefined)this.notifications=work;
      this.handling.track(work);
    }else if(value.id!==undefined){const pending=this.pending.take(value.id);if(!pending)return;value.error?pending.reject(Error(String(value.error.message??'Codex 拒绝请求'))):pending.resolve(value.result)}
    else throw Error('Codex 返回不可关联的消息');
  }
  /** 请求只发一次；原生确认之前的断连保持失败，不猜测操作是否被受理。 */
  request(method:string,params:unknown={},timeoutMs=30000):Promise<any>{
    if(this.failure||this.closing)return Promise.reject(this.failure??Error('Codex 已关闭'));
    const id=++this.sequence;return new Promise((resolve,reject)=>{this.pending.register(id,{resolve,reject},timeoutMs,()=>this.fail(Error('Codex '+method+' 超时，请核实原运行')));try{this.send({id,method,params})}catch(error){this.fail(error instanceof Error?error:Error(String(error)))}});
  }
  send(value:unknown){if(this.failure||this.closing||!this.child)throw this.failure??Error('Codex 不可用');this.child.stdin.write(JSON.stringify(value)+'\n')}
  private fail(error:Error){if(this.failure)return;this.failure=error;this.pending.rejectAll(error);this.child?.kill();this.failed(error)}
  /** 停止接收后续请求并等待操作处理排空；不将进程退出解释为已撤销工具副作用。 */
  async close(){this.closing=true;this.pending.rejectAll(()=>Error('Codex 已关闭'));this.child?.stdin.end();const timer=setTimeout(()=>this.child?.kill(),1000);try{await this.exit;await this.handling.drain()}finally{clearTimeout(timer)}}
}
