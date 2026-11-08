/**
 * 正式调用在profile分配前保存来源、在挂起线程恢复前保存原进程身份；收尾未知仅暴露原资源清理闭包。
 * 可信onSettled仅在原资源确已收束并清理后通知任务端口；异常清理不明确时不签发完成。
 * 作用定位：把可信调用方给出的字节快照和本机执行器复制到私有目录，执行有界 LPAC 程序并返回真实平台事实。
 * 设计原因：原工程不授予沙箱权限；输出只在全部进程退出后读取，异常不重试，清理不明确时不能交付成功。
 * 职责边界：本文件不签发模型工具或任务权限；允许系统 LPAC 资源及 registryRead，不宣称完全隔绝所有 Windows 对象或磁盘硬配额。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash,randomUUID,randomBytes} from 'node:crypto';
import {createRequire} from 'node:module';
import {performance} from 'node:perf_hooks';
import {Win32IsolatedNode} from './isolated-node-win32';
import {Win32IsolationRecovery} from './isolation-recovery-win32';
import type {IsolationLifecycle} from './isolation-record';
import {isolatedNodeRequestSchema,type IsolatedNodeRequest,type IsolatedNodeResult} from './isolated-node-protocol';
const requireNative=createRequire(typeof __filename==='string'?__filename:import.meta.url);
const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
const pause=()=>new Promise<void>(resolve=>setTimeout(resolve,10));
const fail=(code:string):never=>{throw Object.assign(new Error('隔离执行未完成：'+code),{code:'ISOLATION_'+code})};

/** 装配参数是宿主私有配置，不能来自 renderer 或模型；onStarted 只报告平台身份供监管与验证。 */
export interface IsolatedNodeOptions {executable?:string;koffiPath?:string;onStarted?:(value:{pid:number;root:string;profileName:string})=>void;/** 正式成员的可信私有记录；模型不能提供或替换。 */lifecycle?:IsolationLifecycle;/** 只重试该次原句柄及原目录清理，不重新运行脚本。 */onCleanupPending?:(retry:()=>Promise<void>)=>void;/** 仅在本调用资源已确认退出并完成清理后通知；业务失败不等于资源未知。 */onSettled?:()=>void}

/** 单次调用独占一份输入／输出／profile；signal 只终止本次 Job，没有自动重放或向原工程写回。 */
export async function runIsolatedNode(raw:IsolatedNodeRequest,signal:AbortSignal,options:IsolatedNodeOptions={}):Promise<IsolatedNodeResult>{
  let request:ReturnType<typeof isolatedNodeRequestSchema.parse>,snapshots:(IsolatedNodeRequest['files'][number]&{bytes:Buffer})[],temp:string,root:string;
  // 分配前失败没有平台资源；仍释放调用方的等待标记，不能误报为进程清理未知。
  try{signal.throwIfAborted();if(process.platform!=='win32'||process.arch!=='x64')fail('UNSUPPORTED');request=isolatedNodeRequestSchema.parse(raw);
    snapshots=request.files.map(file=>({...file,bytes:Buffer.from(file.base64,'base64')}));if(snapshots.some(file=>file.bytes.toString('base64')!==file.base64))fail('ENCODING');
    temp=await fs.realpath(os.tmpdir());root=await fs.mkdtemp(path.join(temp,'cbim-isolated-'));
  }catch(error){options.onSettled?.();throw error}
  const executionId=randomUUID(),profileName='CBIM.Isolated.'+executionId;
  const runtime=path.join(root,'runtime'),input=path.join(root,'input'),output=path.join(root,'output');let native:Win32IsolatedNode|undefined,cleaned=false,retainOwner=false,retryNativeCleanup:(()=>void)|undefined,prepared=false,notified=false;
  const platform=(process as NodeJS.Process&{resourcesPath?:string}).resourcesPath;
  const koffiPath=options.koffiPath??(platform?path.join(platform,'koffi'):requireNative.resolve('koffi'));
  const cleanup=async()=>{
    if(retryNativeCleanup){retryNativeCleanup();retryNativeCleanup=undefined;retainOwner=false}
    if(native){native.terminate();const deadline=performance.now()+10000;while(native.state().active!==0){if(performance.now()>deadline)fail('DRAIN_PENDING');await pause()}native.close();native=undefined}
    if(retainOwner)fail('CLEANUP_PENDING');
    if(!cleaned){await removeOwnedRoot(root,temp);cleaned=true}
    if(!notified){if(prepared)await options.lifecycle!.cleaned();options.onSettled?.();notified=true}
  };
  try{
    // 该文件只供宿主识别异常退出留下的资源，沙箱没有读取权限；它不授予重新执行资格。
    const nonce=randomBytes(32).toString('hex');await fs.writeFile(path.join(root,'owner.json'),JSON.stringify({executionId,profileName,pid:process.pid,nonce}),{flag:'wx'});
    const inspector=options.lifecycle?new Win32IsolationRecovery(koffiPath):undefined;
    if(options.lifecycle){await options.lifecycle.prepared({executionId,profileName,jobName:'Local\\'+profileName,root,rootIdentity:inspector!.directoryIdentity(root),nonce,host:inspector!.processIdentity()},hash(Buffer.from(JSON.stringify(raw))));prepared=true}
    try{native=new Win32IsolatedNode(profileName,koffiPath)}catch(error){const failure=error as {cleanupPending?:boolean;retryCleanup?:()=>void};retainOwner=!!failure.cleanupPending;retryNativeCleanup=failure.retryCleanup;throw error}native.grant(root,'traverse');
    for(const [directory,access]of [[runtime,'read'],[input,'read'],[output,'write']]as const){await fs.mkdir(directory);native.grant(directory,access)}
    const source=await fs.realpath(options.executable??process.execPath),executable=path.join(runtime,'executor.exe');
    // 使用当前宿主同一可执行器及必要 Electron 数据文件；不搜索 PATH，不允许业务参数选择执行器。
    const sourceStat=await fs.lstat(source);if(!sourceStat.isFile()||sourceStat.nlink!==1||sourceStat.size>256*1024*1024)fail('RUNTIME');await fs.copyFile(source,executable);const runtimeFacts:{sha256:string;assets:{name:string;sha256:string}[]}={sha256:hash(await fs.readFile(executable)),assets:[]};
    for(const name of ['icudtl.dat','v8_context_snapshot.bin','snapshot_blob.bin']){const original=path.join(path.dirname(source),name);try{const stat=await fs.lstat(original);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>32*1024*1024)fail('RUNTIME_ASSET');await fs.copyFile(original,path.join(runtime,name));runtimeFacts.assets.push({name,sha256:hash(await fs.readFile(path.join(runtime,name)))})}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}}
    for(const file of snapshots){signal.throwIfAborted();const target=path.join(input,...file.path.split('/'));await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,file.bytes,{flag:'wx'})}
    signal.throwIfAborted();const pid=native.start(executable,['--preserve-symlinks','--preserve-symlinks-main',path.join(input,...request.entry.split('/')),...request.args],output,request,!!options.lifecycle);
    if(options.lifecycle){await options.lifecycle.started(inspector!.processIdentity(pid));signal.throwIfAborted();native.resume()}
    let status:IsolatedNodeResult['status']='exited',terminating=false;const chunks:Buffer[]=[];let received=0;const deadline=performance.now()+request.timeoutMs;let drainDeadline=0;
    const terminate=()=>{if(!terminating){native!.terminate();terminating=true;drainDeadline=performance.now()+10000}};
    const abort=()=>{status='cancelled'};signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
    let state:ReturnType<Win32IsolatedNode['state']>;
    try{options.onStarted?.({pid,root,profileName});for(;;){
      if(signal.aborted)terminate();
      for(let i=0;i<16;i++){const bytes=native.read();if(!bytes.length)break;if(received+bytes.length>65536){if(status==='exited')status='output_limit';terminate();break}chunks.push(bytes);received+=bytes.length}
      state=native.state();if(status==='exited'&&state.limitTerminations>0){status='resource_limit';terminate()}if(state.exited&&state.active===0)break;
      // 主程序退出仍有后代时，立即收束同一 Job；不等后代自行完成或让输出继续变化。
      if(state.exited)terminate();if(!terminating&&performance.now()>=deadline){status='timed_out';terminate()}
      if(terminating&&performance.now()>drainDeadline)fail('DRAIN_PENDING');await pause();
    }}finally{signal.removeEventListener('abort',abort)}
    // 主进程退出时管道可能仍有尾部字节；在全部后代退出后排空同一管道。
    for(;;){const bytes=native.read();if(!bytes.length)break;if(received+bytes.length>65536){if(status==='exited')status='output_limit';break}chunks.push(bytes);received+=bytes.length}
    const outputs:IsolatedNodeResult['outputs']=[];let total=0;
    if(status==='exited'&&state!.exitCode===0)for(const relative of request.outputs){
      let current=output;for(const segment of relative.split('/').slice(0,-1)){current=path.join(current,segment);const stat=await fs.lstat(current);if(!stat.isDirectory()||stat.isSymbolicLink())fail('OUTPUT_PATH')}
      const file=path.join(output,...relative.split('/')),before=await fs.lstat(file);if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1)fail('OUTPUT_PATH');if(before.size>1024*1024||total+before.size>4*1024*1024){status='output_limit';outputs.length=0;break}
      const handle=await fs.open(file,'r');try{const actual=await handle.stat();if(actual.dev!==before.dev||actual.ino!==before.ino||actual.size!==before.size)fail('OUTPUT_CHANGED');const bytes=Buffer.alloc(before.size);let read=0;while(read<bytes.length){const result=await handle.read(bytes,read,bytes.length-read,read);if(!result.bytesRead)fail('OUTPUT_CHANGED');read+=result.bytesRead}const after=await handle.stat(),named=await fs.lstat(file);if(after.size!==before.size||after.mtimeMs!==before.mtimeMs||after.ctimeMs!==before.ctimeMs||named.ino!==before.ino||named.isSymbolicLink()||after.nlink!==1)fail('OUTPUT_CHANGED');total+=bytes.length;outputs.push({path:relative,base64:bytes.toString('base64'),byteLength:bytes.length,sha256:hash(bytes)})}finally{await handle.close()}
    }
    if(prepared)await options.lifecycle!.settled();await cleanup();if(signal.aborted){status='cancelled';outputs.length=0}
    return {executionId,pid,isolation:'windows-lpac-registry-read-v1',status,exitCode:state!.exitCode,stdio:Buffer.concat(chunks).toString('utf8'),runtime:runtimeFacts,inputs:snapshots.map(file=>({path:file.path,sha256:hash(file.bytes),byteLength:file.bytes.length})),outputs,resources:{totalProcesses:state!.totalProcesses,limitTerminations:state!.limitTerminations,peakMemoryBytes:state!.peakMemoryBytes},allProcessesExited:true,cleanup:'complete'};
  }finally{
    try{await cleanup()}catch(error){options.onCleanupPending?.(cleanup);throw error}
  }
}
/** 只清理本调用 mkdtemp 的目录；OS/防病毒短暂持映像时仅重试删除，不重跑程序。owner最后删除，持续失败保留核实依据。 */
async function removeOwnedRoot(root:string,temp:string){
  if(path.dirname(root)!==temp||!/^cbim-isolated-[A-Za-z0-9]+$/.test(path.basename(root)))fail('CLEANUP_PATH');const stat=await fs.lstat(root);if(!stat.isDirectory()||stat.isSymbolicLink()||await fs.realpath(root)!==root)fail('CLEANUP_PATH');
  const ownerFile=path.join(root,'owner.json'),owner=await fs.readFile(ownerFile);
  for(const name of await fs.readdir(root))if(name!=='owner.json'){
    const target=path.resolve(root,name);if(path.dirname(target)!==root)fail('CLEANUP_PATH');
    await fs.rm(target,{recursive:true,force:true,maxRetries:8,retryDelay:100});
  }
  await fs.unlink(ownerFile);
  try{await fs.rm(root,{recursive:true,force:true,maxRetries:8,retryDelay:100})}
  catch(error){await fs.writeFile(ownerFile,owner,{flag:'wx'});throw error}
}
