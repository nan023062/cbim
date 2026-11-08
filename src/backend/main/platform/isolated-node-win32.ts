/**
 * 命名Job若已存在立即拒绝且不保留其句柄；启动可保持挂起，等待可信记录可靠保存后再恢复原线程。
 * 作用定位：以 Win32 LPAC Token、显式 ACL 和 Job Object 启动并收束真实程序，属于 Main 平台边界。
 * 设计原因：普通独立进程和路径检查不能阻止系统调用越界；进程创建时绑定 Job，恢复线程前核 Token 和限制。
 * 支持范围：Windows x64，固定 registryRead capability，禁止网络 capabilities；仅给调用方新建的私有暂存目录赋权。
 */
import {createRequire} from 'node:module';
import type Koffi from 'koffi';

const requireNative=createRequire(typeof __filename==='string'?__filename:import.meta.url);
/** Windows argv 编码，不经 shell；反斜线与双引号按 CommandLineToArgv/CRT 规则处理。 */
export function quoteWindowsArgument(value:string):string{return '"'+value.replace(/(\\*)"/g,'$1$1\\"').replace(/(\\+)$/,'$1$1')+'"'}
const fault=(stage:string,code?:number):never=>{throw Object.assign(new Error('隔离平台操作失败：'+stage),{code:'ISOLATION_'+stage,...(code===undefined?{}:{win32Code:code})})};

/** 一个实例只启动一次；close 只收束原 Job，不启动替代进程，失败可对同实例重试清理。 */
export class Win32IsolatedNode {
  private readonly k:typeof Koffi;private readonly api:Record<string,(...args:any[])=>any>;
  private sid:any;private capability:any;private allocated:any[]=[];private handles:any[]=[];private attributes?:Buffer;
  /** job句柄不继承；宿主退出关闭最后句柄后，内核终止尚存后代。 */
  private job:any;private process:any;private thread:any;private pipe:any;private writePipe:any;private profileCreated=false;
  private used=false;private resumed=false;private readonly pins:Buffer[]=[];
  /** 当前登录会话内唯一名称，供原宿主退出后的只读核实；不向沙箱继承此句柄。 */
  readonly jobName:string;
  readonly capabilityName='registryRead';readonly ownerSid:string;readonly packageSid:string;
  constructor(readonly profileName:string,koffiPath:string){
    if(process.platform!=='win32'||process.arch!=='x64'||!/^CBIM\.Isolated\.[a-f0-9-]{36}$/.test(profileName))fault('UNSUPPORTED');
    this.jobName='Local\\'+profileName;
    this.k=requireNative(koffiPath);const kernel=this.k.load('kernel32.dll'),adv=this.k.load('advapi32.dll'),user=this.k.load('userenv.dll'),base=this.k.load('kernelbase.dll');
    this.api={};const bind=(lib:ReturnType<typeof this.k.load>,key:string,decl:string)=>{this.api[key]=lib.func(decl)};
    for(const [key,decl]of Object.entries({last:'uint32 __stdcall GetLastError()',close:'int __stdcall CloseHandle(void *)',localFree:'void * __stdcall LocalFree(void *)',current:'void * __stdcall GetCurrentProcess()',init:'int __stdcall InitializeProcThreadAttributeList(void *,uint32,uint32,void *)',attribute:'int __stdcall UpdateProcThreadAttribute(void *,uint32,uintptr,void *,uintptr,void *,void *)',deleteAttributes:'void __stdcall DeleteProcThreadAttributeList(void *)',create:'int __stdcall CreateProcessW(str16,void *,void *,void *,int,uint32,void *,str16,void *,void *)',resume:'uint32 __stdcall ResumeThread(void *)',wait:'uint32 __stdcall WaitForSingleObject(void *,uint32)',exitCode:'int __stdcall GetExitCodeProcess(void *,void *)',jobCreate:'void * __stdcall CreateJobObjectW(void *,str16)',jobSet:'int __stdcall SetInformationJobObject(void *,int,void *,uint32)',jobQuery:'int __stdcall QueryInformationJobObject(void *,int,void *,uint32,void *)',jobTerminate:'int __stdcall TerminateJobObject(void *,uint32)',inJob:'int __stdcall IsProcessInJob(void *,void *,void *)',pipe:'int __stdcall CreatePipe(_Out_ void **,_Out_ void **,void *,uint32)',inherit:'int __stdcall SetHandleInformation(void *,uint32,uint32)',peek:'int __stdcall PeekNamedPipe(void *,void *,uint32,void *,void *,void *)',read:'int __stdcall ReadFile(void *,void *,uint32,void *,void *)',file:'void * __stdcall CreateFileW(str16,uint32,uint32,void *,uint32,uint32,void *)'}))bind(kernel,key,decl);
    for(const [key,decl]of Object.entries({freeSid:'void * __stdcall FreeSid(void *)',sidString:'int __stdcall ConvertSidToStringSidW(void *,_Out_ void **)',tokenOpen:'int __stdcall OpenProcessToken(void *,uint32,_Out_ void **)',tokenInfo:'int __stdcall GetTokenInformation(void *,int,void *,uint32,void *)',equalSid:'int __stdcall EqualSid(void *,void *)',security:'int __stdcall ConvertStringSecurityDescriptorToSecurityDescriptorW(str16,uint32,_Out_ void **,void *)',setSecurity:'int __stdcall SetFileSecurityW(str16,uint32,void *)'}))bind(adv,key,decl);
    bind(user,'profileCreate','int32 __stdcall CreateAppContainerProfile(str16,str16,str16,void *,uint32,_Out_ void **)');bind(user,'profileDelete','int32 __stdcall DeleteAppContainerProfile(str16)');bind(base,'derive','int __stdcall DeriveCapabilitySidsFromName(str16,_Out_ void **,void *,_Out_ void **,void *)');
    try{
      const owner=[null];this.check(this.api.tokenOpen(this.api.current(),8,owner),'OWNER_TOKEN');const token=owner[0];try{const data=this.token(token,1);this.ownerSid=this.stringSid(this.k.decode(data,0,'void *'))}finally{this.check(this.api.close(token),'OWNER_CLOSE')}
      const sid=[null],hr=this.api.profileCreate(profileName,profileName,'CBIM temporary isolated execution',null,0,sid);if(hr!==0)fault('PROFILE_CREATE',hr);this.sid=sid[0];this.profileCreated=true;this.packageSid=this.stringSid(this.sid);
      const groups=[null],caps=[null],gc=Buffer.alloc(4),cc=Buffer.alloc(4);this.check(this.api.derive('registryRead',groups,gc,caps,cc),'CAPABILITY');
      for(const [array,count]of [[groups[0],gc.readUInt32LE()],[caps[0],cc.readUInt32LE()]]as const){for(let i=0;i<count;i++)this.allocated.push(this.k.decode(array,i*8,'void *'));this.allocated.push(array)}
      if(cc.readUInt32LE()!==1)fault('CAPABILITY');this.capability=this.k.decode(caps[0],0,'void *');
    }catch(error){try{this.close()}catch(cleanup){throw Object.assign(cleanup as Error,{cleanupPending:true,retryCleanup:()=>this.close()})}throw error}
  }
  private check(value:unknown,stage:string){if(!value)fault(stage,this.api.last())}
  private keep(handle:any){if(!handle||this.k.address(handle)===0xffffffffffffffffn)fault('HANDLE',this.api.last());this.handles.push(handle);return handle}
  private release(handle:any){if(!handle)return;this.check(this.api.close(handle),'CLOSE');this.handles.splice(this.handles.indexOf(handle),1)}
  private stringSid(sid:any){const out=[null];this.check(this.api.sidString(sid,out),'SID');try{return this.k.decode(out[0],'char16',-1)as string}finally{this.api.localFree(out[0])}}
  private token(handle:any,kind:number){const bytes=Buffer.alloc(4096),length=Buffer.alloc(4);this.check(this.api.tokenInfo(handle,kind,bytes,bytes.length,length),'TOKEN');if(length.readUInt32LE()>bytes.length)fault('TOKEN');return bytes}
  /** 只在新建且未填充的自有目录上设置保护 DACL；创建文件随后继承各自读写范围。 */
  grant(directory:string,access:'traverse'|'read'|'write'){
    if(this.used)fault('ALREADY_STARTED');const acl=[`(A;OICI;FA;;;${this.ownerSid})`,'(A;OICI;FA;;;SY)','(A;OICI;FA;;;BA)',`(A;${access==='traverse'?'':'OICI'};${access==='write'?'0x1301bf':'0x1200a9'};;;${this.packageSid})`].join('');
    const sd=[null];this.check(this.api.security('D:P'+acl,1,sd,null),'ACL');try{this.check(this.api.setSecurity(directory,0x80000004,sd[0]),'ACL_SET')}finally{this.api.localFree(sd[0])}
  }
  private attribute(id:number,bytes:Buffer){this.pins.push(bytes);this.check(this.api.attribute(this.attributes,0,id,bytes,bytes.length,null,null),'ATTRIBUTE')}
  /** 创建挂起的进程；Job 由创建属性一次绑定，任何核实失败均不执行用户脚本。 */
  start(executable:string,args:string[],cwd:string,options:{timeoutMs:number;memoryMiB:number;processLimit:number},suspendOnly=false):number{
    if(this.used)fault('ALREADY_STARTED');this.used=true;
    const job=this.api.jobCreate(null,this.jobName),jobError=this.api.last();if(jobError===183){this.check(this.api.close(job),'CLOSE_EXISTING_JOB');fault('JOB_EXISTS')}this.job=this.keep(job);const limits=Buffer.alloc(144);limits.writeUInt32LE(0x2000|0x200|0x8|0x4,16);limits.writeBigInt64LE(BigInt(options.timeoutMs)*10000n,8);limits.writeUInt32LE(options.processLimit,40);limits.writeBigUInt64LE(BigInt(options.memoryMiB)*1024n*1024n,120);this.check(this.api.jobSet(this.job,9,limits,limits.length),'JOB_LIMIT');
    const actual=Buffer.alloc(144);this.check(this.api.jobQuery(this.job,9,actual,actual.length,null),'JOB_QUERY');if(actual.readUInt32LE(16)!==limits.readUInt32LE(16)||actual.readUInt32LE(40)!==options.processLimit||actual.readBigUInt64LE(120)!==limits.readBigUInt64LE(120))fault('JOB_LIMIT');
    const size=Buffer.alloc(8);this.api.init(null,4,0,size);const n=Number(size.readBigUInt64LE());if(n<1||n>65536)fault('ATTRIBUTE_SIZE');this.attributes=Buffer.alloc(n);this.check(this.api.init(this.attributes,4,0,size),'ATTRIBUTE_INIT');
    const capability=Buffer.alloc(16);this.k.encode(capability,0,'void *',this.capability);capability.writeUInt32LE(4,8);this.pins.push(capability);
    const caps=Buffer.alloc(24);this.k.encode(caps,0,'void *',this.sid);this.k.encode(caps,8,'void *',capability);caps.writeUInt32LE(1,16);this.attribute(0x20009,caps);this.attribute(0x2000f,Buffer.from([1,0,0,0]));const jobs=Buffer.alloc(8);this.k.encode(jobs,0,'void *',this.job);this.attribute(0x2000d,jobs);
    const sa=Buffer.alloc(24);sa.writeUInt32LE(24);sa.writeUInt32LE(1,16);const read=[null],write=[null];this.check(this.api.pipe(read,write,sa,4096),'PIPE');this.pipe=this.keep(read[0]);this.writePipe=this.keep(write[0]);this.check(this.api.inherit(this.pipe,1,0),'PIPE_INHERIT');const input=this.keep(this.api.file('NUL',0x80000000,3,sa,3,0x80,null));
    const inherited=Buffer.alloc(16);this.k.encode(inherited,0,'void *',this.writePipe);this.k.encode(inherited,8,'void *',input);this.attribute(0x20002,inherited);
    const startup=Buffer.alloc(112);startup.writeUInt32LE(112);startup.writeUInt32LE(0x100,60);this.k.encode(startup,80,'void *',input);this.k.encode(startup,88,'void *',this.writePipe);this.k.encode(startup,96,'void *',this.writePipe);this.k.encode(startup,104,'void *',this.attributes);
    // USERPROFILE/APPDATA/LOCALAPPDATA 是 Windows AppContainer 启动所需位置；不继承用户凭证、NODE_OPTIONS 或 PATH。
    const environment={APPDATA:process.env.APPDATA??'',ELECTRON_RUN_AS_NODE:'1',LOCALAPPDATA:process.env.LOCALAPPDATA??'',SystemRoot:process.env.SystemRoot??'',TEMP:cwd,TMP:cwd,USERPROFILE:process.env.USERPROFILE??''};if(Object.values(environment).some(v=>!v||v.includes('\0')))fault('ENVIRONMENT');
    const env=Buffer.from(Object.entries(environment).map(([k,v])=>k+'='+v).join('\0')+'\0\0','utf16le'),command=Buffer.from([executable,...args].map(quoteWindowsArgument).join(' ')+'\0','utf16le');if(command.length>65534)fault('ARGUMENT_LIMIT');const info=Buffer.alloc(24);
    this.check(this.api.create(executable,command,null,null,1,0x8000000|0x80000|0x400|0x4,env,cwd,startup,info),'CREATE');this.process=this.keep(this.k.decode(info,0,'void *'));this.thread=this.keep(this.k.decode(info,8,'void *'));this.release(this.writePipe);this.writePipe=null;this.release(input);
    const token=[null];this.check(this.api.tokenOpen(this.process,8,token),'PROCESS_TOKEN');try{
      if(this.token(token[0],29).readUInt32LE()!==1)fault('NOT_APPCONTAINER');const packageInfo=this.token(token[0],31);if(!this.api.equalSid(this.k.decode(packageInfo,0,'void *'),this.sid))fault('PACKAGE_IDENTITY');
      const capabilityInfo=this.token(token[0],30);if(capabilityInfo.readUInt32LE()!==1||!this.api.equalSid(this.k.decode(capabilityInfo,8,'void *'),this.capability)||capabilityInfo.readUInt32LE(16)!==4)fault('TOKEN_CAPABILITIES');
      const member=Buffer.alloc(4);this.check(this.api.inJob(this.process,this.job,member),'JOB_MEMBER');if(member.readUInt32LE()!==1)fault('JOB_MEMBER');
    }finally{this.check(this.api.close(token[0]),'TOKEN_CLOSE')}
    if(!suspendOnly)this.resume();return info.readUInt32LE(16);
  }
  /** 原进程仍挂起时先保存调用身份；只有该次可靠保存完成后才允许执行脚本。 */
  resume(){if(!this.thread||this.resumed)fault('RESUME_STATE');if(this.api.resume(this.thread)!==1)fault('RESUME',this.api.last());this.resumed=true}
  /** 只读取已在宿主管道中的字节；单次最多 4096，不等待用户进程生产数据。 */
  read():Buffer{const available=Buffer.alloc(4);if(!this.api.peek(this.pipe,null,0,null,available,null)){const code=this.api.last();if(code===109)return Buffer.alloc(0);fault('PIPE_PEEK',code)}const n=Math.min(4096,available.readUInt32LE());if(!n)return Buffer.alloc(0);const bytes=Buffer.alloc(n),count=Buffer.alloc(4);this.check(this.api.read(this.pipe,bytes,n,count,null),'PIPE_READ');return bytes.subarray(0,count.readUInt32LE())}
  /** 主进程句柄已发信号与Job活动数分别核实；单凭exitCode（含259）不能判断存活，也不意味着后代全部结束。 */
  state(){if(!this.job)return {active:0,exited:true,exitCode:0,totalProcesses:0,limitTerminations:0,peakMemoryBytes:0};const accounting=Buffer.alloc(48),limits=Buffer.alloc(144);this.check(this.api.jobQuery(this.job,1,accounting,48,null),'JOB_ACCOUNTING');this.check(this.api.jobQuery(this.job,9,limits,144,null),'JOB_ACCOUNTING');const result=this.process?this.api.wait(this.process,0):0;if(result!==0&&result!==258)fault('WAIT',this.api.last());const code=Buffer.alloc(4);if(this.process)this.check(this.api.exitCode(this.process,code),'EXIT_CODE');return {active:accounting.readUInt32LE(40),exited:result===0,exitCode:code.readUInt32LE(),totalProcesses:accounting.readUInt32LE(36),limitTerminations:accounting.readUInt32LE(44),peakMemoryBytes:Number(limits.readBigUInt64LE(136))}}
  /** 终止整个原 Job，包括主进程已退出而仍存活的后代；调用后仍须轮询 active=0。 */
  terminate(){if(this.job)this.check(this.api.jobTerminate(this.job,1),'TERMINATE')}
  /** 无活动程序后释放所有句柄和临时 profile；中途失败保留剩余所有权供同实例再次 close。 */
  close(){
    if(this.job){this.terminate();const data=Buffer.alloc(48);this.check(this.api.jobQuery(this.job,1,data,48,null),'CLOSE_JOB');if(data.readUInt32LE(40)!==0)fault('DRAIN_PENDING')}
    for(const handle of [...this.handles].reverse()){this.release(handle);if(handle===this.job)this.job=null}
    if(this.attributes){this.api.deleteAttributes(this.attributes);this.attributes=undefined}this.pins.length=0;
    for(const address of this.allocated)this.api.localFree(address);this.allocated=[];
    if(this.profileCreated){const hr=this.api.profileDelete(this.profileName);if(hr!==0)fault('PROFILE_DELETE',hr);this.profileCreated=false}
    if(this.sid){this.api.freeSid(this.sid);this.sid=null}
  }
}
