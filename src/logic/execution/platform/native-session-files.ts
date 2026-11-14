/**
 * 作用定位：在本工作区受管会话目录内按官方声明的原生格式核实已关闭上下文，供成员检查点与续执行使用。
 * 设计原因：相同 sessionId 不证明历史字节未改变；独立有界指纹绑定真实文件和完整 JSONL，自定义 Loop 使用 CBIM 格式，不默认当成 Codex。
 * 职责边界：只读、不修复尾行；拒绝链接、越界、未知身份和读取竞争，不提供任意文件哈希入口。
 */
import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fail} from '../../../core/errors';
import {engineDescriptor,type LoopEngine} from '../../engines';

/** 原生历史含模型消息和图片，采用独立 64 MiB 上限；超限明确拒绝续执行，不能截断作证。 */
export const nativeSessionByteLimit=64*1024*1024;
export interface NativeSessionFingerprint {byteLength:number;sha256:string}
const same=(a:import('node:fs').Stats,b:import('node:fs').Stats)=>a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&a.mtimeMs===b.mtimeMs&&a.ctimeMs===b.ctimeMs;
export class NativeSessionFiles {
  constructor(private readonly root:string,private readonly assert:()=>void,private readonly engine:LoopEngine='pi'){}
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
      const format=engineDescriptor(this.engine).nativeHistoryFormat;
      if(format==='pi'){if(header.type!=='session'||header.id!==session.nativeSessionId)fail('MEMBER_CHECKPOINT_NATIVE','原生上下文身份与成员通道不一致')}
      else if(format==='claude'){const entries=lines.map(line=>JSON.parse(line)),identified=entries.filter(entry=>typeof entry.sessionId==='string');if(path.basename(file)!==session.nativeSessionId+'.jsonl'||!identified.length||identified.some(entry=>entry.sessionId!==session.nativeSessionId))fail('MEMBER_CHECKPOINT_NATIVE','Claude Code 上下文身份与成员通道不一致')}
      else if(format==='codex'){const payload=header.payload as Record<string,unknown>|undefined;if(header.type!=='session_meta'||payload?.id!==session.nativeSessionId||!path.basename(file).endsWith('-'+session.nativeSessionId+'.jsonl')||lines.slice(1).some(line=>JSON.parse(line).type==='session_meta'))fail('MEMBER_CHECKPOINT_NATIVE','Codex 上下文身份与成员通道不一致')}
      else if(format==='cbim'){if(header.type!=='cbim_session'||header.version!==1||header.engine!==this.engine||header.id!==session.nativeSessionId||path.basename(file)!==session.nativeSessionId+'.jsonl'||lines.slice(1).some(line=>JSON.parse(line).type==='cbim_session'))fail('MEMBER_CHECKPOINT_NATIVE','领域引擎上下文身份与成员通道不一致')}
      else fail('MEMBER_CHECKPOINT_NATIVE','未声明可验证的原生会话格式');
      return {byteLength:length,sha256:createHash('sha256').update(bytes).digest('hex')};
    }finally{await handle.close()}
  }
}
