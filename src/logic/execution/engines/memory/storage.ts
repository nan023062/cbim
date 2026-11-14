/**
 * 作用定位：记忆包的私有会话及派生向量缓存；正式知识只能经注入工具访问。
 * 设计原因：会话追加并同步后才继续执行，未正常收口的历史不能自动恢复；缓存按完整来源/模型代际独占写入，无活动索引混用。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {atomic} from '../../../../core/platform/node/files';
import {safeId} from '../../ports/identity';
import type {EngineContext} from '../../rules/types';
import {finishMemoryIndex,type MemoryIndexPlan,type MemoryIndex} from '../../../knowledge/rules/memory-index';
import {memoryMessageSchema,type MemoryMessage} from './protocol';

async function directory(home:string,name:string){const root=path.resolve(home,name);await fs.mkdir(root,{recursive:true});if(await fs.realpath(root)!==root)throw Error('记忆私有目录不能经过链接');return root}
async function read(root:string,file:string,limit:number){
  if(path.dirname(file)!==root||await fs.realpath(file)!==file)throw Error('记忆文件不属于受管私有目录');
  const before=await fs.lstat(file);if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1||before.size>limit)throw Error('记忆文件不是有界普通文件');
  const handle=await fs.open(file,'r');
  try{
    const opened=await handle.stat();if(opened.ino!==before.ino||opened.dev!==before.dev)throw Error('记忆文件打开期间变化');
    const parts:Buffer[]=[];let length=0;
    while(length<=before.size){const buffer=Buffer.alloc(Math.min(65536,before.size+1-length));if(!buffer.length)break;const {bytesRead}=await handle.read(buffer,0,buffer.length,length);if(!bytesRead)break;parts.push(buffer.subarray(0,bytesRead));length+=bytesRead}
    const bytes=Buffer.concat(parts),after=await handle.stat(),current=await fs.lstat(file);
    if(bytes.length>limit||after.size!==before.size||after.mtimeMs!==before.mtimeMs||current.ino!==before.ino||current.isSymbolicLink())throw Error('记忆文件读取期间变化');
    return new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  }finally{await handle.close()}
}
async function create(file:string,value:string){const handle=await fs.open(file,'wx',0o600);try{await handle.writeFile(value,'utf8');await handle.sync()}finally{await handle.close()}}

/** 每轮独占现有宿主租约保护的会话；不修复尾行、不截断旧历史，也不重放其中的调用。 */
export class MemorySession {
  private bytes:number;
  readonly messages:MemoryMessage[];
  private constructor(readonly id:string,readonly file:string,private readonly root:string,text:string,messages:MemoryMessage[]){this.bytes=Buffer.byteLength(text);this.messages=messages}
  static async open(home:string,context:EngineContext){
    const root=await directory(home,'sessions'),id=safeId(context.nativeSessionId??randomUUID()),file=path.join(root,id+'.jsonl');
    const header={type:'cbim_session',version:1,engine:'memory',id,workspaceId:context.task.workspaceId,taskId:context.task.taskId,root:path.resolve(context.task.root)};
    if(context.sessionFile){
      if(!context.nativeSessionId||path.resolve(context.sessionFile)!==file)throw Error('记忆会话恢复身份不一致');
      await context.assertMemberResume?.();const text=await read(root,file,1024*1024);if(!text.endsWith('\n'))throw Error('记忆会话尾行不完整，不能自动续跑');
      const entries=text.trimEnd().split('\n').map(line=>JSON.parse(line));if(!isDeepStrictEqual(entries[0],header))throw Error('记忆会话不属于当前任务或工作区');
      const messages:MemoryMessage[]=[];let active:string|undefined,pendingTool:string|undefined;
      for(const entry of entries.slice(1)){
        if(entry.type==='turn.started'){if(active||typeof entry.runId!=='string')throw Error('记忆会话存在未结束轮次');active=safeId(entry.runId)}
        else if(entry.type==='message'){
          if(!active)throw Error('记忆会话消息缺少运行');const message=memoryMessageSchema.parse(entry.message);
          if(message.role==='tool'){if(message.tool_call_id!==pendingTool)throw Error('记忆会话工具回执身份不一致');pendingTool=undefined}
          else {if(pendingTool)throw Error('记忆会话仍有未结束工具');if(message.role==='assistant')pendingTool=message.tool_calls?.[0].id}
          messages.push(message);
        }
        else if(entry.type==='turn.completed'){const last=messages.at(-1);if(!active||entry.runId!==active||pendingTool||last?.role!=='assistant'||last.tool_calls)throw Error('记忆会话终态或原工具结果无法核实');active=undefined}
        else throw Error('记忆会话存在未知记录');
      }
      if(active)throw Error('记忆会话上轮未可靠完成；请核实原运行后新建上下文，不自动续跑');
      await context.assertMemberResume?.();return new MemorySession(id,file,root,text,messages);
    }
    const text=JSON.stringify(header)+'\n';await create(file,text);return new MemorySession(id,file,root,text,[]);
  }
  /** 每条先同步到磁盘；失败不尝试重写。模型和工具只消费已经保存的消息。 */
  async append(entry:{type:'turn.started';runId:string}|{type:'turn.completed';runId:string}|{type:'message';message:MemoryMessage}){
    const value=JSON.stringify(entry)+'\n',size=Buffer.byteLength(value);if(this.bytes+size>1024*1024)throw Error('记忆会话达到 1 MiB 上限，请新建上下文并保留来源摘要');
    if(await fs.realpath(this.file)!==this.file||path.dirname(this.file)!==this.root)throw Error('记忆会话路径发生变化');
    const before=await fs.lstat(this.file);if(!before.isFile()||before.nlink!==1||before.size!==this.bytes)throw Error('记忆会话已被其它写入修改');
    const handle=await fs.open(this.file,'a');try{const opened=await handle.stat();if(opened.ino!==before.ino||opened.dev!==before.dev||opened.size!==before.size)throw Error('记忆会话写入身份变化');await handle.writeFile(value);await handle.sync()}finally{await handle.close()}
    this.bytes+=size;if(entry.type==='message')this.messages.push(structuredClone(entry.message));
  }
}

/** 完整缓存以不可变 key 单独存储；缺失才生成，损坏直接报告，不自行删除或循环下载/重建。 */
export class MemoryIndexCache {
  constructor(private readonly home:string){}
  async load(plan:MemoryIndexPlan):Promise<MemoryIndex|undefined>{
    const root=await directory(this.home,'memory-index'),file=path.join(root,plan.key+'.json');let text:string;
    try{text=await read(root,file,16*1024*1024)}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return;throw error}
    const value=JSON.parse(text);if(value.key!==plan.key||Object.keys(value).some(key=>!['key','vectors'].includes(key)))throw Error('记忆索引缓存身份异常');return finishMemoryIndex(plan,value.vectors);
  }
  /** 完整临时文件同步后原子落盘；磁盘失败不影响正式知识。旧代保留，缓存清理留给后续显式管理。 */
  async save(index:MemoryIndex){
    const root=await directory(this.home,'memory-index'),value=JSON.stringify({key:index.key,vectors:index.vectors});if(Buffer.byteLength(value)>16*1024*1024)throw Error('记忆索引缓存超过 16 MiB');
    if(await this.load(index))return;await atomic(path.join(root,index.key+'.json'),value);
  }
}
