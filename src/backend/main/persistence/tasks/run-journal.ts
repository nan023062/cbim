/**
 * 作用定位：本机执行事件日志，顺序追加并 fsync，从记录恢复摘要和未确认工具。
 * 设计原因：先持久化后发布；重建工具回执和任务计划修订，旧日志不补造计划，模型运行完成不自动验收。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import type {EngineEvent, RunSummary, StoredEvent, TaskSpec} from '../../../core/brain/types';
import type {ToolReceipt} from '../../../core/tools/types';


/** Append-only authority; fsync before callbacks receive the event. */
export class RunJournal {
  private tail:Promise<unknown>=Promise.resolve();
  private events:StoredEvent[]=[];
  constructor(readonly directory:string,readonly task:TaskSpec,readonly runId:string){}
  async init(){
    await fs.mkdir(this.directory,{recursive:true});
    const file=await fs.open(path.join(this.directory,'events.jsonl'),'wx',0o600);await file.close();
  }
  /** 顺序追加并 fsync 后返回；一旦写失败，此日志队列后续写入继续失败以阻止无证据执行。 */
  append(event:EngineEvent):Promise<StoredEvent>{
    const write=this.tail.then(async()=>{
      const record:StoredEvent={...event,version:1,seq:this.events.length+1,taskId:this.task.taskId,workspaceId:this.task.workspaceId,runId:this.runId,time:new Date().toISOString()};
      const file=await fs.open(path.join(this.directory,'events.jsonl'),'a',0o600);
      try{await file.writeFile(JSON.stringify(record)+'\n');await file.sync()}finally{await file.close()}
      this.events.push(record);return record;
    });
    // A failed write poisons this journal: later operations must not execute without evidence.
    this.tail=write;void write.catch(()=>{});return write;
  }
  async flush(){await this.tail}
  /** 只解析完整行并验证身份及顺序；已放行但无结果的工具使状态为 interrupted。 */
  static async read(directory:string):Promise<RunSummary>{
    const text=await fs.readFile(path.join(directory,'events.jsonl'),'utf8');
    const lines=text.split('\n');lines.pop(); // A crash may leave one incomplete tail; never interpret it.
    const events=lines.filter(Boolean).map(line=>JSON.parse(line) as StoredEvent);
    if(!events.length||events[0].type!=='run.started')throw Error('运行记录不完整');
    const first=events[0],task=first.data.task as TaskSpec;
    for(let i=0;i<events.length;i++)if(events[i].version!==1||events[i].seq!==i+1||events[i].runId!==first.runId||events[i].taskId!==task.taskId||events[i].workspaceId!==task.workspaceId)throw Error('运行记录身份或顺序错误');
    const pending=new Set<string>();let sessionFile:string|undefined;let status:RunSummary['status']='interrupted';
    for(const event of events){
      if(event.type==='session.bound')sessionFile=String(event.data.sessionFile);
      if(event.type==='tool.allowed')pending.add(String(event.data.id));
      if(event.type==='tool.finished')pending.delete(String(event.data.id));
      if(event.type==='tool.denied')pending.delete(String(event.data.id));
      if(event.type==='run.settled')status=event.data.status as RunSummary['status'];
      if(event.type==='run.interrupted')status='interrupted';
    }
    if(pending.size)status='interrupted';
    const receipts=new Map<string,ToolReceipt>();
    for(const event of events){
      const records=event.type==='run.interrupted'?(event.data.receipts??[]):['tool.denied','tool.finished'].includes(event.type)&&event.data.receipt?[event.data.receipt]:[];
      for(const receipt of records as ToolReceipt[]){
        if(receipt.workspaceId!==task.workspaceId||receipt.taskId!==task.taskId||receipt.runId!==first.runId)throw Error('工具回执身份与运行不匹配');
        receipts.set(receipt.toolCallId,receipt);
      }
    }
    const taskProgress=events.filter(e=>e.type==='task.updated').at(-1)?.data.progress as RunSummary['taskProgress'];
    return {task,runId:first.runId,status,acceptance:'not_evaluated',sessionFile,unresolvedTools:[...pending],toolReceipts:[...receipts.values()],taskProgress,events};
  }
}
