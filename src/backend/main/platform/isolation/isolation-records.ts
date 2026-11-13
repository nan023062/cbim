/**
 * 目录归属：backend/main/platform/isolation；隔离进程与残留资源平台。
 * 作用定位：原隔离执行的私有追加记录，保存启动前来源与资源清理阶段。
 * 设计原因：宿主崩溃后仍须区分原任务资源和同名临时目录；fsync 后才允许下一项外部操作。
 * 职责边界：工作区唯一锁由上层持有；读取不创建目录、修复尾部或重放程序，损坏日志保持不可核实。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import {z} from 'zod';
import {hash} from '../../../../core/platform/node/serialization';
import {safeId} from '../../../../logic/execution/ports/identity';
import {fail} from '../../../../core/errors';
import {isolationRecordSchema,isolationProcessSchema,type IsolationRecord} from './isolation-record';
const changeSchema=z.discriminatedUnion('kind',[
  z.object({kind:z.literal('prepared'),record:isolationRecordSchema}).strict(),
  z.object({kind:z.literal('started'),process:isolationProcessSchema}).strict(),
  z.object({kind:z.literal('settled')}).strict(),z.object({kind:z.literal('cleaned')}).strict(),
  z.object({kind:z.literal('cleanup_requested'),commandId:z.string().uuid(),basis:z.string().regex(/^[a-f0-9]{64}$/)}).strict(),
  z.object({kind:z.literal('cleanup_complete'),commandId:z.string().uuid()}).strict(),
]);
export type IsolationChange=z.infer<typeof changeSchema>;
const frameSchema=z.object({sequence:z.number().int().positive(),previous:z.string(),at:z.string().datetime(),change:changeSchema,checksum:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
export interface IsolationHead {record:IsolationRecord;changes:IsolationChange[];revision:number;checksum:string;phase:IsolationChange['kind']}
/** ID 来源为原 run/call 的摘要；重复调用不能分配第二个执行身份。 */
export function isolationOperationId(runId:string,toolCallId:string){return hash(JSON.stringify(['isolated-node-v1',runId,toolCallId]))}
export class FileIsolationRecords {
  private tail:Promise<void>=Promise.resolve();private failure?:unknown;
  constructor(readonly directory:string){}
  private file(runId:string,operationId:string){safeId(runId);if(!/^[a-f0-9]{64}$/.test(operationId))fail('ISOLATION_RECORD_ID','原调用标识无效');return path.join(this.directory,runId,operationId+'.jsonl')}
  private async regular(file:string){const stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>256*1024)fail('ISOLATION_RECORD_INVALID','隔离记录不是有界普通文件')}
  private validate(changes:IsolationChange[]){
    const first=changes[0];if(first?.kind!=='prepared')fail('ISOLATION_RECORD_INVALID','缺少原隔离来源');let phase:IsolationChange['kind']='prepared',commandId:string|undefined;
    for(const change of changes.slice(1)){
      const allowed=change.kind==='started'?phase==='prepared':change.kind==='settled'?['prepared','started'].includes(phase):change.kind==='cleaned'?['prepared','started','settled'].includes(phase):change.kind==='cleanup_requested'?['prepared','started','settled'].includes(phase):change.kind==='cleanup_complete'?phase==='cleanup_requested'&&change.commandId===commandId:false;
      if(!allowed)fail('ISOLATION_RECORD_INVALID','隔离资源阶段顺序不一致');if(change.kind==='cleanup_requested')commandId=change.commandId;phase=change.kind;
    }return first.record;
  }
  /** 只读原完整帧。ENOENT 只代表没有新协议记录，绝不等于旧调用未执行。 */
  async read(runId:string,operationId:string):Promise<IsolationHead|undefined>{
    const file=this.file(runId,operationId);try{await this.regular(file)}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return;throw error}
    const text=await fs.readFile(file,'utf8');if(!text.endsWith('\n'))fail('ISOLATION_RECORD_INVALID','隔离记录尾部不完整');const lines=text.trimEnd().split('\n');if(!lines.length||lines.length>32)fail('ISOLATION_RECORD_LIMIT','隔离记录数量不合法');let previous='';const changes:IsolationChange[]=[];
    for(const [index,line]of lines.entries()){const frame=frameSchema.parse(JSON.parse(line)),{checksum,...body}=frame;if(body.sequence!==index+1||body.previous!==previous||hash(JSON.stringify(body))!==checksum)fail('ISOLATION_RECORD_INVALID','隔离记录哈希链不一致');changes.push(body.change);previous=checksum}
    const record=this.validate(changes);if(record.origin.binding.runId!==runId||isolationOperationId(runId,record.origin.toolCallId)!==operationId)fail('ISOLATION_RECORD_ID','隔离记录不属于原调用');return {record,changes,revision:changes.length,checksum:previous,phase:changes.at(-1)!.kind};
  }
  async list(runId:string){const directory=path.dirname(this.file(runId,'0'.repeat(64)));let names:string[];try{const stat=await fs.lstat(directory);if(!stat.isDirectory()||stat.isSymbolicLink())fail('ISOLATION_RECORD_INVALID','隔离记录目录被替换');names=await fs.readdir(directory)}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return [];throw error}if(names.length>256||names.some(name=>!/^([a-f0-9]{64})\.jsonl$/.test(name)))fail('ISOLATION_RECORD_LIMIT','隔离记录目录超限或包含未知文件');const results:MemoryEntry[]=[];for(const name of names.sort()){const operationId=name.slice(0,-6),head=await this.read(runId,operationId);if(!head)fail('ISOLATION_RECORD_CHANGED','读取期间隔离记录消失');results.push({operationId,head})}return results}
  /** 只追加合法阶段并等待实际 sync；写入未知封闭本实例，不能继续发出资源操作。 */
  append(runId:string,operationId:string,change:IsolationChange,expectedRevision:number):Promise<IsolationHead>{
    const fixed=changeSchema.parse(structuredClone(change));const result=this.tail.then(async()=>{if(this.failure)throw this.failure;const prior=await this.read(runId,operationId);if((prior?.revision??0)!==expectedRevision)fail('ISOLATION_RECORD_CONFLICT','隔离记录版本已变化');const changes=[...prior?.changes??[],fixed];const record=this.validate(changes);if(record.origin.binding.runId!==runId||isolationOperationId(runId,record.origin.toolCallId)!==operationId)fail('ISOLATION_RECORD_ID','隔离记录不属于原调用');if(changes.length>32)fail('ISOLATION_RECORD_LIMIT','隔离记录已达上限');const file=this.file(runId,operationId);await fs.mkdir(path.dirname(file),{recursive:true});const body={sequence:changes.length,previous:prior?.checksum??'',at:new Date().toISOString(),change:fixed},checksum=hash(JSON.stringify(body));
      try{const handle=await fs.open(file,prior?'a':'wx',0o600);try{await handle.writeFile(JSON.stringify({...body,checksum})+'\n');await handle.sync()}finally{await handle.close()}}catch(error){this.failure=Object.assign(Error('隔离资源阶段未确认可靠保存，请保留原记录并重新核实'),{code:'ISOLATION_RECORD_SAVE_UNKNOWN',cause:error});throw this.failure}
      return {record:changes[0].kind==='prepared'?changes[0].record:prior!.record,changes,revision:changes.length,checksum,phase:fixed.kind};});this.tail=result.then(()=>{},()=>{});return result;
  }
  async drain(){await this.tail}
}
interface MemoryEntry {operationId:string;head:IsolationHead}
