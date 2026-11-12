/**
 * 目录归属：backend/main/platform/isolation；隔离进程与残留资源平台。
 * 作用定位：核实原宿主创建身份、命名 Job 和自有目录，并以固定 Win32 句柄回收残留。
 * 设计原因：PID 可复用，临时路径可被替换；只有原对象身份与物理退出均明确时才允许删除。
 * 职责边界：不终止按 PID 查到的进程、不创建 profile、不重跑程序；目录链接或扫描超限均拒绝清理。
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
import type Koffi from 'koffi';
import type {IsolationProcess,IsolationDirectory,IsolationResource} from './isolation-record';
const requireNative=createRequire(typeof __filename==='string'?__filename:import.meta.url);
const fault=(stage:string,code?:number):never=>{throw Object.assign(Error('隔离资源核实失败：'+stage),{code:'ISOLATION_RECOVERY_'+stage,win32Code:code})};
const normal=(p:string)=>p.replace(/^\\\\\?\\/,'').toLowerCase();
/** 按需装配固定第三方库；所有私有路径与名称必须来自原可靠记录。 */
export class Win32IsolationRecovery {
  private readonly k:typeof Koffi;private readonly api:Record<string,(...args:any[])=>any>;
  constructor(koffiPath:string){
    if(process.platform!=='win32'||process.arch!=='x64')fault('UNSUPPORTED');this.k=requireNative(koffiPath);const dll=this.k.load('kernel32.dll');
    const definitions={last:'uint32 __stdcall GetLastError()',close:'int __stdcall CloseHandle(void *)',process:'void * __stdcall OpenProcess(uint32,int,uint32)',times:'int __stdcall GetProcessTimes(void *,void *,void *,void *,void *)',session:'int __stdcall ProcessIdToSessionId(uint32,void *)',wait:'uint32 __stdcall WaitForSingleObject(void *,uint32)',job:'void * __stdcall OpenJobObjectW(uint32,int,str16)',queryJob:'int __stdcall QueryInformationJobObject(void *,int,void *,uint32,void *)',file:'void * __stdcall CreateFileW(str16,uint32,uint32,void *,uint32,uint32,void *)',info:'int __stdcall GetFileInformationByHandle(void *,void *)',final:'uint32 __stdcall GetFinalPathNameByHandleW(void *,void *,uint32,uint32)',dispose:'int __stdcall SetFileInformationByHandle(void *,uint32,void *,uint32)'};
    this.api=Object.fromEntries(Object.entries(definitions).map(([key,definition])=>[key,dll.func(definition)]));this.api.deleteProfile=this.k.load('userenv.dll').func('int32 __stdcall DeleteAppContainerProfile(str16)');
  }
  private check(value:unknown,stage:string){if(!value)fault(stage,this.api.last())}
  private close(handle:any){this.check(this.api.close(handle),'CLOSE')}
  private processHandle(pid:number){const handle=this.api.process(0x100000|0x1000,0,pid);if(!handle){const code=this.api.last();if(code===87)return;fault('PROCESS',code)}return handle}
  private processFacts(handle:any,pid:number):IsolationProcess{const created=Buffer.alloc(8),exit=Buffer.alloc(8),kernel=Buffer.alloc(8),user=Buffer.alloc(8),session=Buffer.alloc(4);this.check(this.api.times(handle,created,exit,kernel,user),'PROCESS_TIME');this.check(this.api.session(pid,session),'PROCESS_SESSION');return {pid,created:created.readBigUInt64LE().toString(),session:session.readUInt32LE()}}
  /** 创建时间保留 FILETIME 原始整数，避免毫秒截断产生身份碰撞。 */
  processIdentity(pid:number=process.pid):IsolationProcess{const handle=this.processHandle(pid);if(!handle)fault('PROCESS_ABSENT');try{return this.processFacts(handle,pid)}finally{this.close(handle)}}
  host(original:IsolationProcess):'live'|'exited'|'reused'|'unknown'{try{if(this.processIdentity().session!==original.session)return 'unknown';const handle=this.processHandle(original.pid);if(!handle)return 'exited';try{const current=this.processFacts(handle,original.pid);if(current.created!==original.created||current.session!==original.session)return 'reused';const state=this.api.wait(handle,0);return state===0?'exited':state===258?'live':'unknown'}finally{this.close(handle)}}catch{return 'unknown'}}
  /** 只在 host 已可靠退出后调用，避免观察者提前持句柄延长 KILL_ON_JOB_CLOSE 生命周期。 */
  job(resource:IsolationResource):'active'|'empty'|'absent'|'unknown'{if(!['exited','reused'].includes(this.host(resource.host)))return 'unknown';const handle=this.api.job(4,0,resource.jobName);if(!handle)return this.api.last()===2?'absent':'unknown';try{const value=Buffer.alloc(48);if(!this.api.queryJob(handle,1,value,48,null))return 'unknown';return value.readUInt32LE(40)===0?'empty':'active'}finally{this.close(handle)}}
  private final(handle:any){const value=Buffer.alloc(65536),length=this.api.final(handle,value,32768,0);if(!length||length>=32768)fault('PATH');return value.subarray(0,length*2).toString('utf16le')}
  private information(handle:any){const value=Buffer.alloc(52);this.check(this.api.info(handle,value),'FILE_INFO');return {identity:{volumeId:value.readUInt32LE(28).toString(16),fileId:value.subarray(44,52).toString('hex')},attributes:value.readUInt32LE(0),links:value.readUInt32LE(40)}}
  private open(file:string,remove:boolean){const handle=this.api.file(file,0x81|(remove?0x10000:0),3,null,3,0x2000000|0x200000,null),code=this.api.last();if(!handle||this.k.address(handle)===0xffffffffffffffffn)fault('OPEN',code);try{const info=this.information(handle);if(info.attributes&0x400||normal(this.final(handle))!==normal(file))fault('PATH');if(!(info.attributes&0x10)&&info.links!==1)fault('LINK');return {handle,file,...info}}catch(error){this.close(handle);throw error}}
  private parents(root:string){const held:any[]=[],drive=path.parse(root).root;let current=drive;try{for(const part of ['',...path.relative(drive,path.dirname(root)).split(path.sep).filter(Boolean)]){if(part)current=path.join(current,part);const entry=this.open(current,false);held.push(entry.handle);if(!(entry.attributes&0x10))fault('PATH')}return held}catch(error){for(const handle of held.reverse())this.close(handle);throw error}}
  private rootPath(root:string){const temp=fs.realpathSync(os.tmpdir());if(path.dirname(root)!==temp||!/^cbim-isolated-[A-Za-z0-9]+$/.test(path.basename(root)))fault('ROOT_PATH')}
  directoryIdentity(root:string):IsolationDirectory{this.rootPath(root);const parents=this.parents(root);let entry:ReturnType<Win32IsolationRecovery['open']>|undefined;try{entry=this.open(root,false);if(!(entry.attributes&0x10))fault('ROOT_PATH');return entry.identity}finally{if(entry)this.close(entry.handle);for(const handle of parents.reverse())this.close(handle)}}
  /** 持根和全部待删对象，扫描完成前不删除。返回的闭包只删除这些原句柄，最多4096对象／64层。 */
  lockTree(resource:IsolationResource,ownerRequired:boolean){
    this.rootPath(resource.root);const parents=this.parents(resource.root),held:ReturnType<Win32IsolationRecovery['open']>[]=[],ordered:typeof held=[];
    const release=()=>{for(let i=held.length-1;i>=0;i--){this.close(held[i].handle);held.splice(i,1)}for(let i=parents.length-1;i>=0;i--){this.close(parents[i]);parents.splice(i,1)}};
    try{
      const root=this.open(resource.root,true);held.push(root);if(!(root.attributes&0x10)||JSON.stringify(root.identity)!==JSON.stringify(resource.rootIdentity))fault('ROOT_CHANGED');
      const visit=(entry:typeof root,depth:number)=>{if(depth>64||held.length>4096)fault('TREE_LIMIT');if(entry.attributes&0x10){const names=fs.readdirSync(entry.file).sort((a,b)=>Number(a==='owner.json')-Number(b==='owner.json'));for(const name of names){const target=path.resolve(entry.file,name);if(path.dirname(target)!==entry.file)fault('PATH');const child=this.open(target,true);held.push(child);visit(child,depth+1)}}ordered.push(entry)};visit(root,0);
      if(ownerRequired){const ownerFile=path.join(resource.root,'owner.json'),owner=JSON.parse(fs.readFileSync(ownerFile,'utf8'));if(owner.executionId!==resource.executionId||owner.profileName!==resource.profileName||owner.pid!==resource.host.pid||owner.nonce!==resource.nonce)fault('OWNER_CHANGED')}
      return {remove:()=>{for(const entry of ordered){this.check(this.api.dispose(entry.handle,4,Buffer.from([1]),1),'DELETE');this.close(entry.handle);held.splice(held.indexOf(entry),1)}},close:release};
    }catch(error){release();throw error}
  }
  /** 删除只依据私有生成的唯一 profile 名称；不存在也是幂等清理，未知错误不得忽略。 */
  deleteProfile(resource:IsolationResource){if(resource.profileName!=='CBIM.Isolated.'+resource.executionId)fault('PROFILE_IDENTITY');const code=this.api.deleteProfile(resource.profileName);if(code!==0)fault('PROFILE_DELETE',code)}
}
