/**
 * 作用定位：在本工作区受管 Pi 会话目录内核实已关闭的原生上下文，供成员检查点与续执行使用。
 * 设计原因：相同 sessionId 不证明历史字节未改变；独立有界指纹绑定真实文件和完整 JSONL，不把私有正文或路径暴露到图谱。
 * 职责边界：只读、不修复尾行；拒绝链接、越界、未知身份和读取竞争，不提供任意文件哈希入口。
 */
import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fail} from '../../core/foundation/errors';

/** 原生历史含模型消息和图片，采用独立 64 MiB 上限；超限明确拒绝续执行，不能截断作证。 */
export const nativeSessionByteLimit=64*1024*1024;
export interface NativeSessionFingerprint {byteLength:number;sha256:string}
const same=(a:import('node:fs').Stats,b:import('node:fs').Stats)=>a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&a.mtimeMs===b.mtimeMs&&a.ctimeMs===b.ctimeMs;
export class NativeSessionFiles {
  constructor(private readonly root:string,private readonly assert:()=>void){}
  /** sessionFile/nativeSessionId 仅来自可信运行记录；调用前必须关闭其原生进程，信号覆盖读取全过程。 */
  async read(session:{nativeSessionId:string;sessionFile?:string},signal:AbortSignal):Promise<NativeSessionFingerprint>{
    this.assert();signal.throwIfAborted();
    if(!session.sessionFile)fail('MEMBER_CHECKPOINT_NATIVE','检查点缺少原生上下文文件');
    if(/[\x00-\x1f]/.test(session.sessionFile)||/^(?:\\\\|\/\/|[a-z]+:\/\/)/i.test(session.sessionFile))fail('MEMBER_CHECKPOINT_NATIVE','原生上下文不能使用设备、网络或协议路径');
    const root=await fs.realpath(this.root),file=path.resolve(session.sessionFile),relative=path.relative(root,file);
    if(!relative||path.isAbsolute(relative)||relative==='..'||relative.startsWith('..'+path.sep))fail('MEMBER_CHECKPOINT_NATIVE','原生上下文不属于当前受管目录');
    if(relative.split(path.sep).some(part=>part.includes(':')||/[. ]$/.test(part)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)))fail('MEMBER_CHECKPOINT_NATIVE','原生上下文路径包含设备名、备用数据流或歧义组件');
    let part=root;for(const name of relative.split(path.sep)){part=path.join(part,name);if((await fs.lstat(part)).isSymbolicLink())fail('MEMBER_CHECKPOINT_NATIVE','原生上下文不能经过链接或目录联接')}
    if(await fs.realpath(file)!==file)fail('MEMBER_CHECKPOINT_NATIVE','原生上下文实际路径不一致');
    const before=await fs.lstat(file);if(!before.isFile()||before.nlink!==1||before.size<1||before.size>nativeSessionByteLimit)fail('MEMBER_CHECKPOINT_NATIVE','原生上下文不是可核实的有界普通文件');
    const handle=await fs.open(file,constants.O_RDONLY|(process.platform==='win32'?0:constants.O_NOFOLLOW|constants.O_NONBLOCK));
    try{
      const opened=await handle.stat();if(!same(before,opened))fail('MEMBER_CHECKPOINT_NATIVE','打开原生上下文期间文件变化');
      const chunks:Buffer[]=[];let length=0;
      while(length<opened.size){this.assert();signal.throwIfAborted();const bytes=Buffer.alloc(Math.min(64*1024,opened.size-length)),read=await handle.read(bytes,0,bytes.length,length);if(!read.bytesRead)break;chunks.push(bytes.subarray(0,read.bytesRead));length+=read.bytesRead}
      const after=await handle.stat(),current=await fs.lstat(file);this.assert();signal.throwIfAborted();
      if(length!==opened.size||current.isSymbolicLink()||after.nlink!==1||current.nlink!==1||!same(opened,after)||!same(after,current)||await fs.realpath(file)!==file)fail('MEMBER_CHECKPOINT_NATIVE','读取原生上下文期间文件变化');
      const bytes=Buffer.concat(chunks),text=bytes.toString('utf8');if(!bytes.equals(Buffer.from(text))||!text.endsWith('\n'))fail('MEMBER_CHECKPOINT_NATIVE','原生上下文编码或尾行不完整');
      const lines=text.trimEnd().split('\n');if(lines.length>100000)fail('MEMBER_CHECKPOINT_NATIVE','原生上下文记录数量超过核实上限');
      let header:Record<string,unknown>;try{header=JSON.parse(lines[0]);if(!header||typeof header!=='object'||Array.isArray(header))throw Error('invalid header');for(const line of lines.slice(1)){const item=JSON.parse(line);if(!item||typeof item!=='object'||Array.isArray(item)||typeof item.type!=='string')throw Error('invalid entry')}}catch{fail('MEMBER_CHECKPOINT_NATIVE','原生上下文存在损坏记录，不能续执行')}
      if(header.type!=='session'||header.id!==session.nativeSessionId)fail('MEMBER_CHECKPOINT_NATIVE','原生上下文身份与成员通道不一致');
      return {byteLength:length,sha256:createHash('sha256').update(bytes).digest('hex')};
    }finally{await handle.close()}
  }
}
