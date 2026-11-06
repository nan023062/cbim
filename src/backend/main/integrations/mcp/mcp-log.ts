/**
 * 作用定位：McpCallLogs：每工作区独立的有界调用日志与落盘队列。
 * 设计原因：限制日志大小与队列，保留诊断元数据而不长期保存知识正文或凭据。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import type {McpCallLog} from '../../../../bridge/contracts/workspace';

export class McpCallLogs {
  private entries:McpCallLog[]=[];private queue:Promise<void>=Promise.resolve();private pending=0;error?:string;
  constructor(readonly file:string,readonly workspaceId:string,private maxBytes=2*1024*1024){}
  async init(){
    for(const file of [this.file+'.1',this.file])try{
      const size=(await fs.stat(file)).size;if(size>this.maxBytes*2)throw Error('日志文件超过读取限制');
      for(const line of (await fs.readFile(file,'utf8')).split('\n')){if(!line)continue;try{const value=JSON.parse(line);if(value.workspaceId===this.workspaceId&&typeof value.id==='string')this.entries.push(value)}catch{/* incomplete crash tail */}}
    }catch(e:any){if(e.code!=='ENOENT')this.error='历史调用日志读取失败：'+e.message}
    this.entries=this.entries.slice(-200);
  }
  add(value:McpCallLog){
    this.entries.push(value);this.entries=this.entries.slice(-200);
    if(this.pending>=500){this.error='调用日志写入积压，部分记录仅保留在内存';return}
    this.pending++;
    this.queue=this.queue.then(async()=>{
      await fs.mkdir(path.dirname(this.file),{recursive:true});
      let size=0;try{size=(await fs.stat(this.file)).size}catch(e:any){if(e.code!=='ENOENT')throw e}
      if(size>=this.maxBytes){await fs.rm(this.file+'.1',{force:true});await fs.rename(this.file,this.file+'.1')}
      await fs.appendFile(this.file,JSON.stringify(value)+'\n',{mode:0o600});
    }).catch(e=>{this.error='调用日志写入失败：'+e.message}).finally(()=>{this.pending--});
  }
  view(){return {entries:[...this.entries].reverse(),error:this.error,path:this.file,limit:200}}
  flush(){return this.queue}
}
