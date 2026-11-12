/**
 * 作用定位：把已校验 ZIP 展开到新建候选目录，并核对签名清单定义的完整文件集合。
 * 设计原因：不覆盖活动程序，不信任 ZIP 路径与大小；流式处理限制内存，符号链接和额外文件一律拒绝。
 */
import fs from 'node:fs/promises';
import {createReadStream,createWriteStream} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {open,type ZipFile,type Entry} from 'yauzl';
import {runtimeRelativePath,validateRuntimeFiles,type RuntimeFile} from './runtime-manifest';

/** 调用方只能传新建目录；已存在目标拒绝复用，失败保留候选供诊断，由所有者后续回收。 */
export async function extractRuntimeArchive(archive:string,destination:string,files:RuntimeFile[],signal:AbortSignal,progress:(percent:number)=>void=()=>{}){
  validateRuntimeFiles(files);signal.throwIfAborted();
  await fs.mkdir(destination);
  const zip=await new Promise<ZipFile>((resolve,reject)=>open(archive,{lazyEntries:true,autoClose:true,validateEntrySizes:true,strictFileNames:true},(error,value)=>error?reject(error):resolve(value!)));
  const expected=new Map(files.map(file=>[file.path,file])),seen=new Set<string>();
  const total=files.reduce((sum,file)=>sum+file.bytes,0);let expanded=0;
  await new Promise<void>((resolve,reject)=>{
    let ended=false;
    const abort=()=>fail(signal.reason??Error('更新已取消'));
    const fail=(error:unknown)=>{if(ended)return;ended=true;zip.close();signal.removeEventListener('abort',abort);reject(error)};
    signal.addEventListener('abort',abort,{once:true});
    zip.on('error',fail);
    zip.on('end',()=>{if(ended)return;ended=true;signal.removeEventListener('abort',abort);if(seen.size!==expected.size)reject(Error('更新包缺少文件'));else resolve()});
    zip.on('entry',(entry:Entry)=>{void (async()=>{
      signal.throwIfAborted();const name=entry.fileName,isDirectory=name.endsWith('/');
      runtimeRelativePath(isDirectory?name.slice(0,-1):name);
      const mode=(entry.externalFileAttributes>>>16)&0xf000;
      if(mode&&mode!==0x8000&&mode!==0x4000||entry.generalPurposeBitFlag&1)throw Error('更新包包含链接、设备或加密文件');
      if(isDirectory){if(mode===0x8000||entry.uncompressedSize!==0||!files.some(file=>file.path.startsWith(name)))throw Error('更新包目录无效');zip.readEntry();return;}
      const file=expected.get(name);if(!file||seen.has(name.toLowerCase())||mode===0x4000||entry.uncompressedSize!==file.bytes)throw Error('更新包文件清单不符');
      seen.add(name.toLowerCase());const target=path.join(destination,name);await fs.mkdir(path.dirname(target),{recursive:true});
      const input=await new Promise<NodeJS.ReadableStream>((done,failed)=>zip.openReadStream(entry,(error,stream)=>error?failed(error):done(stream!)));
      let bytes=0;const hash=createHash('sha256');
      const guard=new Transform({transform(chunk:Buffer,_encoding,done){bytes+=chunk.length;if(bytes>file.bytes){done(Error('更新文件超过声明大小'));return;}hash.update(chunk);expanded+=chunk.length;progress(total?expanded/total*100:100);done(null,chunk)}});
      await pipeline(input,guard,createWriteStream(target,{flags:'wx',mode:0o600}),{signal});
      if(bytes!==file.bytes||hash.digest('hex')!==file.sha256)throw Error('更新文件校验失败');
      zip.readEntry();
    })().catch(fail)});
    if(signal.aborted)abort();else zip.readEntry();
  });
}

/** 每次装载均核对内容和集合；不把“缓存目录存在”视作已验证。 */
export async function verifyRuntimeDirectory(root:string,files:RuntimeFile[],signal?:AbortSignal){
  validateRuntimeFiles(files);const expected=new Map(files.map(file=>[file.path,file]));let count=0;
  const rootStat=await fs.lstat(root);if(!rootStat.isDirectory()||rootStat.isSymbolicLink())throw Error('运行目录不是普通目录');
  async function walk(directory:string){
    for(const entry of await fs.readdir(directory,{withFileTypes:true})){
      signal?.throwIfAborted();const absolute=path.join(directory,entry.name),relative=path.relative(root,absolute).split(path.sep).join('/');runtimeRelativePath(relative);
      if(entry.isSymbolicLink())throw Error('运行目录包含链接');
      if(entry.isDirectory()){if(!files.some(file=>file.path.startsWith(relative+'/')))throw Error('运行目录包含未声明目录');await walk(absolute);continue;}
      const file=expected.get(relative);if(!entry.isFile()||!file)throw Error('运行目录文件集合不符');
      const stat=await fs.lstat(absolute);if(stat.size!==file.bytes||stat.nlink>1)throw Error('运行文件大小或链接数不符');
      const hash=createHash('sha256');for await(const chunk of createReadStream(absolute)){signal?.throwIfAborted();hash.update(chunk);}
      if(hash.digest('hex')!==file.sha256)throw Error('运行文件已改变');count++;
    }
  }
  await walk(root);if(count!==expected.size)throw Error('运行文件不完整');
}
