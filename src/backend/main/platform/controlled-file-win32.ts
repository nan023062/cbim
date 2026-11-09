/**
 * 范围读取只请求GENERIC_READ并仅分享READ；目录枚举持不分享DELETE的整条祖先句柄。只读对象无法调用replace/transition。
 * 作用定位：专用 utility 子进程的同步 Win32 单文件实现；全程拥有文件及目录句柄。
 * 设计原因：同线程立即捕获 GetLastError，避免同步磁盘 IO 堵塞 Main；独占共享规则不被描述为命名空间沙箱。
 * 写入边界：同句柄内容替换、删除标记或不覆盖移动均只发一次；命名空间操作另拒绝备用流，失败绝不自行恢复 before。
 */
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import type Koffi from 'koffi';
import {controlledPlatformBytes,type ControlledFileIdentity,type ControlledContentFact,type ControlledNamespaceChange} from './controlled-file-protocol';

const requireNative=createRequire(typeof __filename==='string'?__filename:import.meta.url);
const normal=(value:string)=>value.replace(/^\\\\\?\\/,'').toLowerCase();
const beneath=(root:string,file:string)=>{const rel=path.relative(root,file);return rel===''||!path.isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..'+path.sep)};
const error=(code:string):never=>{throw Object.assign(new Error(code),{code})};
/** 同一个对象只可 apply 一次；CloseHandle 失败保留句柄，进程退出由父级另行确认。 */
export class Win32ControlledFile {
  private readonly koffi:typeof Koffi;
  private readonly api:Record<string,(...args:any[])=>any>;
  private handles:any[]=[];private file:any;private applied=false;private original?:ControlledFileIdentity;
  writeIssued=false;
  constructor(private readonly root:string,private relativePath:string,protectedRoots:readonly string[],koffiPath:string,private readonly namespaceChange?:ControlledNamespaceChange,private readonly readOnly=false,private readonly directoryOnly=false){
    this.namespaceChange=namespaceChange?structuredClone(namespaceChange):undefined;
    if(process.platform!=='win32')error('CONTROLLED_PLATFORM_UNSUPPORTED');
    this.koffi=requireNative(koffiPath);
    const dll=this.koffi.load('kernel32.dll');
    this.api={open:dll.func('void * __stdcall CreateFileW(str16,uint32,uint32,void *,uint32,uint32,void *)'),last:dll.func('uint32 __stdcall GetLastError()'),close:dll.func('int __stdcall CloseHandle(void *)'),read:dll.func('int __stdcall ReadFile(void *,void *,uint32,void *,void *)'),write:dll.func('int __stdcall WriteFile(void *,void *,uint32,void *,void *)'),seek:dll.func('int __stdcall SetFilePointerEx(void *,int64,void *,uint32)'),eof:dll.func('int __stdcall SetEndOfFile(void *)'),flush:dll.func('int __stdcall FlushFileBuffers(void *)'),info:dll.func('int __stdcall GetFileInformationByHandle(void *,void *)'),final:dll.func('uint32 __stdcall GetFinalPathNameByHandleW(void *,void *,uint32,uint32)'),volume:dll.func('int __stdcall GetVolumeInformationByHandleW(void *,void *,uint32,void *,void *,void *,void *,uint32)'),type:dll.func('uint32 __stdcall GetFileType(void *)'),drive:dll.func('uint32 __stdcall GetDriveTypeW(str16)')};
    this.api.setInfo=dll.func('int __stdcall SetFileInformationByHandle(void *,uint32,void *,uint32)');
    this.api.infoEx=dll.func('int __stdcall GetFileInformationByHandleEx(void *,uint32,void *,uint32)');
    try{this.open(protectedRoots)}catch(e){this.close();throw e}
  }
  private bool(value:number){if(!value){const n=this.api.last();error('CONTROLLED_WIN32_'+n)}}
  private openHandle(file:string,access:number,share:number,flags:number){const h=this.api.open(file,access,share,null,3,flags,null),n=this.api.last();if(!h||this.koffi.address(h)===0xffffffffffffffffn)error('CONTROLLED_WIN32_'+n);this.handles.push(h);return h}
  private final(h:any){const b=Buffer.alloc(65536),n=this.api.final(h,b,32768,0);if(!n||n>=32768)error('CONTROLLED_PATH');return b.subarray(0,n*2).toString('utf16le')}
  private info(h:any){const b=Buffer.alloc(52);this.bool(this.api.info(h,b));return {attributes:b.readUInt32LE(0),size:b.readUInt32LE(36)+b.readUInt32LE(32)*2**32,links:b.readUInt32LE(40),volumeId:b.readUInt32LE(28).toString(16),fileId:b.subarray(44,52).toString('hex')}}
  private target(relative:string,protectedRoots:readonly string[]){
    const parts=relative.split('/');
    if(!relative||relative.length>2048||/[\\:<>"|?*\x00-\x1f\x7f]/.test(relative)||parts.some(p=>!p||p==='.'||p==='..'||['.cbim','.git'].includes(p.toLowerCase())||/[. ]$/.test(p)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p)))error('CONTROLLED_PATH');
    const file=path.join(this.root,...parts);if(protectedRoots.some(p=>beneath(path.resolve(p),file)))error('CONTROLLED_PATH');return file;
  }
  private lockParents(file:string){
    const drive=path.parse(this.root).root;
    let current=drive;
    for(const part of ['',...path.relative(drive,path.dirname(file)).split(path.sep).filter(Boolean)]){
      if(part)current=path.join(current,part);
      // 仅 READ_ATTRIBUTES 的元数据句柄不足以阻止空目录重命名；LIST_DIRECTORY 使共享删除约束实际生效。
      const h=this.openHandle(current,0x81,3,0x2000000|0x200000),facts=this.info(h);
      if(!(facts.attributes&0x10)||facts.attributes&0x400||normal(this.final(h))!==normal(current))error('CONTROLLED_PATH');
    }
  }
  private missing(file:string){try{fs.lstatSync(file)}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return;throw e}error('CONTROLLED_TARGET_EXISTS')}
  private open(protectedRoots:readonly string[]){
    if(!/^[A-Za-z]:\\/.test(this.root)||normal(fs.realpathSync(this.root))!==normal(path.resolve(this.root)))error('CONTROLLED_PATH');
    const file=this.target(this.relativePath,protectedRoots),drive=path.parse(this.root).root;
    if(this.api.drive(drive)!==3||this.namespaceChange&&process.arch!=='x64')error('CONTROLLED_PLATFORM_UNSUPPORTED');
    if(this.directoryOnly){if(!this.readOnly||this.namespaceChange)error('CONTROLLED_SESSION_USED');this.lockParents(path.join(file,'_'));return}
    // 从卷根到目标父目录持不分享 DELETE 的目录句柄；每一级拒绝 reparse，核实际对象路径。
    this.lockParents(file);
    if(this.namespaceChange?.kind==='move'){
      const target=this.target(this.namespaceChange.targetRelativePath,protectedRoots);if(normal(file)===normal(target))error('CONTROLLED_PATH');
      this.lockParents(target);this.missing(target);
    }
    // 受限读取只请求 GENERIC_READ 并仅分享 READ；拒绝同时写入/替换，不要求文件本身可写。
    this.file=this.openHandle(file,this.readOnly?0x80000000:this.namespaceChange?0x80010000:0xc0000000,this.readOnly?1:0,0x200080);
    const volume=Buffer.alloc(512);this.bool(this.api.volume(this.file,null,0,null,null,null,volume,256));
    if(volume.toString('utf16le').split('\0')[0]!=='NTFS'||this.api.type(this.file)!==1)error('CONTROLLED_PLATFORM_UNSUPPORTED');
    this.original=this.checkedIdentity();
    if(this.namespaceChange)this.defaultStreamOnly();
  }
  private checkedIdentity():ControlledFileIdentity{
    if(!this.file)error('CONTROLLED_SESSION_CLOSED');
    const info=this.info(this.file);
    // READONLY 属性仅限制写操作，读取仍拒绝目录、重解析与离线文件。
    if(info.links!==1||info.attributes&((this.readOnly?0:0x1)|0x10|0x400|0x1000|0x40000|0x400000)||info.size>controlledPlatformBytes||normal(this.final(this.file))!==normal(path.join(this.root,...this.relativePath.split('/'))))error('CONTROLLED_FILE_CHANGED');
    const value:ControlledFileIdentity={kind:'windows_file',volumeId:info.volumeId,fileId:info.fileId,links:1};
    if(this.original&&JSON.stringify(this.original)!==JSON.stringify(value))error('CONTROLLED_FILE_CHANGED');return value;
  }
  /** binary 只供只读快照使用；业务替换与命名空间操作继续严格 UTF-8。 */
  read(binary=false){
    if(binary&&!this.readOnly)error('CONTROLLED_SESSION_USED');
    const identity=this.checkedIdentity(),before=this.info(this.file);this.bool(this.api.seek(this.file,0,null,0));
    const bytes=Buffer.alloc(before.size),count=Buffer.alloc(4);let offset=0;
    while(offset<bytes.length){this.bool(this.api.read(this.file,bytes.subarray(offset),Math.min(65536,bytes.length-offset),count,null));const n=count.readUInt32LE();if(!n)error('CONTROLLED_FILE_CHANGED');offset+=n}
    if(!binary)new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);
    if(this.info(this.file).size!==before.size)error('CONTROLLED_FILE_CHANGED');this.checkedIdentity();
    return {identity,bytes,fact:{byteLength:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')} satisfies ControlledContentFact};
  }
  replace(bytes:Uint8Array){
    if(this.readOnly||this.namespaceChange||this.applied||bytes.byteLength>controlledPlatformBytes)error('CONTROLLED_SESSION_USED');this.applied=true;this.checkedIdentity();
    new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);this.bool(this.api.seek(this.file,0,null,0));
    const count=Buffer.alloc(4);this.writeIssued=true;
    // 即使空正文也进入实际修改阶段；SetEndOfFile 失败可能已发生前缀写，绝不回滚。
    if(bytes.byteLength){this.bool(this.api.write(this.file,bytes,bytes.byteLength,count,null));if(count.readUInt32LE()!==bytes.byteLength)error('CONTROLLED_PARTIAL_WRITE')}
    this.bool(this.api.eof(this.file));this.bool(this.api.flush(this.file));const result=this.read();
    if(!Buffer.from(bytes).equals(result.bytes))error('CONTROLLED_FILE_CHANGED');return result;
  }
  /** FileStreamInfo 仅允许一个默认数据流；枚举失败或过多返回同样拒绝，不跳过隐藏内容。 */
  private defaultStreamOnly(){
    const bytes=Buffer.alloc(65536);this.bool(this.api.infoEx(this.file,7,bytes,bytes.length));
    const next=bytes.readUInt32LE(0),length=bytes.readUInt32LE(4);
    if(next!==0||length!==14||bytes.subarray(24,24+length).toString('utf16le')!=='::$DATA')error('CONTROLLED_ALTERNATE_STREAM');
  }
  /** 使用打开时冻结的操作和同一文件句柄；源不存在或移动后同身份读回成功才报告平台事实。 */
  transition(){
    const transition=this.namespaceChange;if(this.readOnly||!transition||this.applied)return error('CONTROLLED_SESSION_USED');this.applied=true;const before=this.read(),source=path.join(this.root,...this.relativePath.split('/'));this.defaultStreamOnly();
    if(transition.kind==='delete'){
      this.writeIssued=true;this.bool(this.api.setInfo(this.file,4,Buffer.from([1]),1));
      // 删除标记直到句柄关闭才生效；只释放源文件，父目录句柄仍保护原路径层级。
      const handle=this.file;this.bool(this.api.close(handle));this.handles.splice(this.handles.indexOf(handle),1);this.file=undefined;this.missing(source);
    }else{
      const target=path.join(this.root,...transition.targetRelativePath.split('/'));this.missing(target);
      // Win64 FILE_RENAME_INFO：Flags@0、HANDLE@8、长度@16、UTF-16 名称@20；Flags=0 禁止覆盖。
      const name=Buffer.from(target,'utf16le'),info=Buffer.alloc(Math.max(24,20+name.length+2));info.writeUInt32LE(name.length,16);name.copy(info,20);
      this.writeIssued=true;this.bool(this.api.setInfo(this.file,3,info,info.length));this.relativePath=transition.targetRelativePath;
      const after=this.read();if(JSON.stringify(after.identity)!==JSON.stringify(before.identity)||!after.bytes.equals(before.bytes))error('CONTROLLED_FILE_CHANGED');this.missing(source);
    }
    return {identity:before.identity,fact:before.fact,transition:structuredClone(transition),sourceMissing:true as const};
  }
  close(){let failed=false;for(let i=this.handles.length-1;i>=0;i--){if(this.api.close(this.handles[i]))this.handles.splice(i,1);else failed=true}if(failed)error('CONTROLLED_CLOSE_FAILED');this.file=undefined}
}
