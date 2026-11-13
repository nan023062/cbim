/**
 * 目录归属：logic/file-operations/platform/files；受控文件、产物读取与验证平台。
 * 作用定位：保存受控写入的私有 before/intended-after 字节，公开回执只引用 UUID 与哈希。
 * 设计原因：业务写之前两份字节必须 fsync；孤儿文件也占实际容量，不清理历史或把未知保存当未保存。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {fail} from '../../../../core/errors';
import {controlledFileLimits} from '../../rules/controlled-file-operation';
import {controlledFileBlobRefSchema,type ControlledFileBlobRef} from '../../rules/controlled-file-event';
const fact=(bytes:Uint8Array)=>({byteLength:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
export class ControlledFileBlobs {
  private tail:Promise<unknown>=Promise.resolve();
  constructor(private readonly directory:string){}
  private async checkedDirectory(create=false){const absolute=path.resolve(this.directory),root=path.parse(absolute).root;let current=root;for(const part of ['',...path.relative(root,absolute).split(path.sep)]){if(part)current=path.join(current,part);let stat;try{stat=await fs.lstat(current)}catch(error){if(!create||(error as {code?:string}).code!=='ENOENT')throw error;await fs.mkdir(current,{mode:0o700});stat=await fs.lstat(current)}if(stat.isSymbolicLink()||!stat.isDirectory())fail('CONTROLLED_BLOB_PATH','备份目录不是可靠私有目录')}}
  /** 同一工作区容量预留串行；写失败留下的临时字节不会被排除额度。 */
  savePair(operationId:string,before:Uint8Array,after:Uint8Array):Promise<{before:ControlledFileBlobRef;intendedAfter:ControlledFileBlobRef}>{
    const run=this.tail.then(async()=>{
      await this.checkedDirectory(true);let bytes=0;for(const name of await fs.readdir(this.directory)){const stat=await fs.lstat(path.join(this.directory,name));if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1)fail('CONTROLLED_BLOB_PATH','备份目录存在无法核实的对象');bytes+=stat.size}
      if(before.length>controlledFileLimits.contentBytes||after.length>controlledFileLimits.contentBytes||bytes+before.length+after.length>controlledFileLimits.blobBytes)fail('CONTROLLED_BLOB_LIMIT','备份容量已达上限，未写业务文件');
      return {before:await this.save(operationId,'before',before),intendedAfter:await this.save(operationId,'intended_after',after)};
    });this.tail=run.catch(()=>{});return run;
  }
  private async save(operationId:string,role:'before'|'intended_after',bytes:Uint8Array):Promise<ControlledFileBlobRef>{
    const blobId=randomUUID(),target=path.join(this.directory,blobId),temporary=target+'.tmp';const handle=await fs.open(temporary,'wx',0o600);
    try{await handle.writeFile(bytes);await handle.sync()}finally{await handle.close()}
    await fs.rename(temporary,target);const ref=controlledFileBlobRefSchema.parse({version:1,blobId,createdForOperationId:operationId,role,...fact(bytes)});await this.read(ref);return ref;
  }
  /** 引用并不是路径；逐次验证实际私有文件、大小和哈希，绝不重读原业务 source 代替备份。 */
  async read(input:ControlledFileBlobRef):Promise<Buffer>{
    const ref=controlledFileBlobRefSchema.parse(input);await this.checkedDirectory();const filename=path.join(this.directory,ref.blobId),before=await fs.lstat(filename);
    if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1||before.size!==ref.byteLength)fail('CONTROLLED_BLOB_INVALID','原备份文件不可核实');
    const handle=await fs.open(filename,'r');try{const opened=await handle.stat();if(opened.ino!==before.ino||opened.dev!==before.dev||opened.size!==ref.byteLength||opened.nlink!==1)fail('CONTROLLED_BLOB_INVALID','打开备份时身份变化');
      // 多读一字节只为识别并发增长；绝不让私有文件的当前长度决定无界分配。
      const buffer=Buffer.alloc(ref.byteLength+1);let length=0;while(length<buffer.length){const {bytesRead}=await handle.read(buffer,length,buffer.length-length,length);if(!bytesRead)break;length+=bytesRead}const bytes=buffer.subarray(0,length),after=await handle.stat(),current=await fs.lstat(filename);
      if(bytes.length!==ref.byteLength||after.size!==ref.byteLength||current.size!==ref.byteLength||fact(bytes).sha256!==ref.sha256||after.ino!==opened.ino||after.nlink!==1||after.mtimeMs!==opened.mtimeMs||after.ctimeMs!==opened.ctimeMs||current.ino!==opened.ino||current.nlink!==1||current.isSymbolicLink())fail('CONTROLLED_BLOB_INVALID','备份字节或身份变化');return bytes}finally{await handle.close()}
  }
}
