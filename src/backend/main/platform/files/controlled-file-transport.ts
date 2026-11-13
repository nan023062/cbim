/**
 * 目录归属：backend/main/platform/files；受控文件、产物读取与验证平台。
 * 作用定位：Electron 主进程为每次受控内容替换或删除/移动创建专用 utility 子进程，并返回不透明会话。
 * 设计原因：慢同步 FFI 不阻塞 Main；取消与桥断开不等于句柄已释放，只有真实退出才解除平台活动占位。
 */
import {utilityProcess,type UtilityProcess} from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {randomBytes,createHash} from 'node:crypto';
import {Fault,fail} from '../../../../core/errors';
import {controlledChildReplySchema,controlledPlatformBytes,type ControlledChildRequest,type ControlledChildReply,type ControlledFileTransport,type ExclusiveControlledFile,type ExclusiveControlledTransition,type ControlledNamespaceChange} from './controlled-file-protocol';

const requireNative=createRequire(typeof __filename==='string'?__filename:import.meta.url);
type Request=ControlledChildRequest extends infer T?T extends ControlledChildRequest?Omit<T,'token'|'seq'>:never:never;
/** 打包入口可以位于 ASAR；原生进程 cwd 必须是实际磁盘目录，不能用虚拟入口父目录，也不继承业务工程 cwd。 */
function physicalWorkingDirectory():string{
  try{
    const physicalFs=requireNative('original-fs') as typeof fs;
    const directory=physicalFs.realpathSync(path.dirname(process.execPath));
    if(!physicalFs.statSync(directory).isDirectory())throw new Error('invalid directory');
    return directory;
  }catch{fail('CONTROLLED_PLATFORM_UNSUPPORTED','受控文件进程工作目录不可用')}
}
/** 参数仅由桌面装配/隔离 Electron 测试宿主提供；不是 renderer 或模型路径。 */
export function createControlledFileTransport(options:{entryPath?:string;koffiPath?:string}={}):ControlledFileTransport{
  const entryPath=options.entryPath??path.join(__dirname,'controlled-file-child.js');
  const packaged=(process as NodeJS.Process&{resourcesPath?:string}).resourcesPath;
  const koffiPath=options.koffiPath??(packaged&&fs.existsSync(path.join(packaged,'koffi'))?path.join(packaged,'koffi'):requireNative.resolve('koffi'));
  return new UtilityControlledFiles(entryPath,koffiPath);
}
/** 关闭失败保留活动 child；再次 close 可核实原进程，不创建替代工人或重发 apply。 */
class UtilityControlledFiles implements ControlledFileTransport {
  private sessions=new Map<UtilityFileSession,string>();private closing=false;
  constructor(private readonly entryPath:string,private readonly koffiPath:string){}
  async withExclusiveExisting<T>(root:string,relativePath:string,protectedRoots:readonly string[],signal:AbortSignal,use:(file:ExclusiveControlledFile)=>Promise<T>):Promise<T>{
    return this.withSession(root,relativePath,protectedRoots,signal,use);
  }
  async withExclusiveTransition<T>(root:string,relativePath:string,transition:ControlledNamespaceChange,protectedRoots:readonly string[],signal:AbortSignal,use:(file:ExclusiveControlledTransition)=>Promise<T>):Promise<T>{
    return this.withSession(root,relativePath,protectedRoots,signal,use,structuredClone(transition));
  }
  /** 两种端口共享真实进程退出屏障；副作用种类在 open 时固定，不能在同一会话换用另一操作。 */
  private async withSession<T>(root:string,relativePath:string,protectedRoots:readonly string[],signal:AbortSignal,use:(file:UtilityFileSession)=>Promise<T>,transition?:ControlledNamespaceChange):Promise<T>{
    signal.throwIfAborted();if(this.closing||process.platform!=='win32')fail('CONTROLLED_PLATFORM_UNSUPPORTED','当前平台未提供受控文件能力');
    if(!fs.existsSync(this.entryPath)||!fs.existsSync(this.koffiPath))fail('CONTROLLED_PLATFORM_UNSUPPORTED','受控文件运行资源不可用');
    // original-fs 绕过 ASAR 虚拟目录；失败在 fork 和任何文件/Store 写入之前拒绝。
    const cwd=physicalWorkingDirectory();
    const child=utilityProcess.fork(this.entryPath,[],{env:{SystemRoot:process.env.SystemRoot??'',WINDIR:process.env.WINDIR??'',TEMP:process.env.TEMP??'',TMP:process.env.TMP??''},execArgv:[],cwd,stdio:'ignore',serviceName:'CBIM Controlled File'});
    const session=new UtilityFileSession(child,signal);this.sessions.set(session,root);session.exited.then(()=>this.sessions.delete(session));
    try{await session.open({kind:'open',root,relativePath,protectedRoots:[...protectedRoots],koffiPath:this.koffiPath,...(transition?{transition}:{})});signal.throwIfAborted();return await use(session)}finally{await session.close()}
  }
  async drain(root:string){const sessions=[...this.sessions].filter(([,value])=>value===root).map(([session])=>session);const results=await Promise.allSettled(sessions.map(session=>session.close()));if(results.some(r=>r.status==='rejected')||sessions.some(session=>this.sessions.has(session)))fail('CONTROLLED_FILE_DRAIN_PENDING','文件进程尚未确认退出，保留工作区占用')}
  async close(){this.closing=true;const results=await Promise.allSettled([...this.sessions.keys()].map(session=>session.close()));if(results.some(r=>r.status==='rejected')||this.sessions.size)fail('CONTROLLED_FILE_DRAIN_PENDING','文件进程尚未确认退出，保留工作区占用')}
}
/** seq、token、唯一 apply 和 exit promise 均绑定真实进程；退出码不作为业务成功依据。 */
class UtilityFileSession implements ExclusiveControlledFile,ExclusiveControlledTransition {
  private token=randomBytes(32).toString('hex');private seq=0;private dead=false;private closing?:Promise<void>;
  private pending?:{seq:number;resolve:(reply:ControlledChildReply)=>void;reject:(error:unknown)=>void;timer:ReturnType<typeof setTimeout>};
  private before?:Extract<ControlledChildReply,{kind:'opened'}>;private issued=false;
  readonly exited:Promise<void>;private resolveExit!:()=>void;
  private abort=()=>{this.child.kill()};
  constructor(private readonly child:UtilityProcess,private readonly signal:AbortSignal){
    this.exited=new Promise(resolve=>{this.resolveExit=resolve});
    child.on('message',raw=>{
      const parsed=controlledChildReplySchema.safeParse(raw),current=this.pending;
      if(!parsed.success||!current||parsed.data.token!==this.token||parsed.data.seq!==current.seq){this.reject(new Fault('CONTROLLED_PROTOCOL','受控文件返回无法核实'));child.kill();return}
      const reply=parsed.data;clearTimeout(current.timer);this.pending=undefined;
      if(reply.kind==='error')current.reject(new Fault(reply.code,'受控文件操作未确认，请查询原记录'));else current.resolve(reply);
    });
    child.once('exit',()=>{this.dead=true;this.signal.removeEventListener('abort',this.abort);this.reject(new Fault('CONTROLLED_PROCESS_EXIT','文件进程已退出，结果须按原记录核实'));this.resolveExit()});
    signal.addEventListener('abort',this.abort,{once:true});if(signal.aborted)this.abort();
  }
  get writeIssued(){return this.issued}
  private reject(error:unknown){if(this.pending){clearTimeout(this.pending.timer);this.pending.reject(error);this.pending=undefined}}
  private request(request:Request):Promise<ControlledChildReply>{
    if(this.dead||this.pending)throw new Fault('CONTROLLED_SESSION','文件会话已关闭或仍有操作未结束');
    const seq=++this.seq;return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.reject(new Fault('CONTROLLED_TIMEOUT','文件操作未确认，原请求不会自动重发'));this.child.kill()},30_000);
      this.pending={seq,resolve,reject,timer};try{this.child.postMessage({...request,token:this.token,seq})}catch(e){this.reject(e);this.child.kill()}
    });
  }
  async open(request:Extract<Request,{kind:'open'}>){const reply=await this.request(request);if(reply.kind!=='opened')fail('CONTROLLED_PROTOCOL','文件打开回包不匹配');this.before=reply}
  async readBefore(){if(!this.before||this.dead)fail('CONTROLLED_SESSION','文件会话不可用');return {identity:structuredClone(this.before.identity),fact:structuredClone(this.before.fact),bytes:Buffer.from(this.before.bytes,'base64')}}
  async recheckIdentity(){this.signal.throwIfAborted();const reply=await this.request({kind:'recheck'});if(reply.kind!=='checked')fail('CONTROLLED_PROTOCOL','文件核实回包不匹配');return {identity:reply.identity,fact:reply.fact}}
  async replaceAndFlush(value:Uint8Array){
    this.signal.throwIfAborted();if(this.issued)fail('CONTROLLED_SESSION_USED','本次写入已经发送，不能重做');const bytes=Buffer.from(value);
    if(bytes.length>controlledPlatformBytes)fail('CONTROLLED_LIMIT','文件内容超过上限');
    this.issued=true;const reply=await this.request({kind:'apply',bytes:bytes.toString('base64'),expected:{byteLength:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}});
    if(reply.kind!=='applied')fail('CONTROLLED_PROTOCOL','文件写入回包不匹配');return {identity:reply.identity,fact:reply.fact};
  }
  async transitionAndVerify(){
    this.signal.throwIfAborted();if(this.issued)fail('CONTROLLED_SESSION_USED','本次文件操作已经发送，不能重做');
    this.issued=true;const reply=await this.request({kind:'transition'});if(reply.kind!=='transitioned')fail('CONTROLLED_PROTOCOL','文件删除/移动回包不匹配');
    return {identity:reply.identity,fact:reply.fact,transition:reply.transition,sourceMissing:reply.sourceMissing};
  }
  close():Promise<void>{
    if(this.closing)return this.closing;
    const closing=(async()=>{
      if(!this.dead){if(this.pending)this.child.kill();else try{await this.request({kind:'close'})}catch{this.child.kill()}}
      let timer:ReturnType<typeof setTimeout>|undefined;
      try{await Promise.race([this.exited,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Fault('CONTROLLED_FILE_DRAIN_PENDING','文件进程未确认退出，不能释放工作区占用')),5000)})])}finally{if(timer)clearTimeout(timer)}
    })();this.closing=closing;void closing.catch(()=>{if(this.closing===closing)this.closing=undefined});return closing;
  }
}
