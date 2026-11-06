/**
 * 作用定位：本机执行事件日志，顺序追加并 fsync，从记录恢复摘要和未确认工具。
 * 设计原因：先持久化后发布；核验运行绑定、回执和来源，读取完整前缀时保留尾行未完整写入的事实。损坏仅返回稳定错误码，不把 JSON 片段带到界面；读取不截断、不修复历史。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import type {EngineEvent, RunSummary, StoredEvent, TaskSpec} from '../../../core/brain/types';
import type {ToolReceipt} from '../../../core/tools/types';
import {checkedMemberRunBinding} from '../../../core/brain/member-run';
import {checkedRunInputSource} from '../../../core/brain/input-source';
import {checkedConversationAgentBinding} from '../../../core/brain/conversation-binding';
import {Fault,fail} from '../../../core/foundation/errors';


/** 只追加的运行事实来源；事件可靠落盘后才返回，观察者由上层运行时通知。 */
export class RunJournal {
  private tail:Promise<unknown>=Promise.resolve();
  private events:StoredEvent[]=[];
  constructor(readonly directory:string,readonly task:TaskSpec,readonly runId:string){}
  /** 创建新轮次日志；已有 events.jsonl 时失败，不覆盖历史或把旧日志当作新轮次续写。 */
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
    // 失败保留在队列上，后续事件不能跳过缺失证据继续追加。
    this.tail=write;void write.catch(()=>{});return write;
  }
  /** 等待截至调用时已排队的写入；日志曾写失败时继续拒绝，不能作为已可靠结算的证明。 */
  async flush(){await this.tail}
  /** 只解析完整行并验证身份及顺序；未完整尾行通过 logIntegrity 报告，已放行无结果为 interrupted。IO 错误保留系统码，坏记录使用 RUN_LOG_INVALID。 */
  static async read(directory:string):Promise<RunSummary>{
    const text=await fs.readFile(path.join(directory,'events.jsonl'),'utf8');
    if(text.length===0)fail('RUN_LOG_EMPTY','运行记录尚无首条完整事件');
    try{
    const lines=text.split('\n'),partialTail=lines.pop()!==''; // 只读有效前缀，报告但不截断未完成的最后一行。
    const events=lines.filter(Boolean).map(line=>JSON.parse(line) as StoredEvent);
    if(!events.length||events[0].type!=='run.started')throw Error('运行记录不完整');
    const first=events[0],task=first.data.task as TaskSpec;
    if(first.data.memberBinding!==undefined&&first.data.conversationBinding!==undefined)throw Error('主对话实例绑定不能与成员任务绑定混用');
    const memberBinding=first.data.memberBinding===undefined?undefined:checkedMemberRunBinding(first.data.memberBinding,task,first.runId);
    const conversationBinding=first.data.conversationBinding===undefined?undefined:checkedConversationAgentBinding(first.data.conversationBinding,task);
    const source=first.data.source===undefined?undefined:checkedRunInputSource(first.data.source);
    if(source&&(task.mode!=='chat'||memberBinding||!first.data.resumeFrom))throw Error('成员结果来源与主对话运行不匹配');
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
    return {task,runId:first.runId,status,acceptance:'not_evaluated',sessionFile,...(memberBinding?{memberBinding}:{}),...(conversationBinding?{conversationBinding}:{}),...(source?{source}:{}),unresolvedTools:[...pending],toolReceipts:[...receipts.values()],taskProgress,events,logIntegrity:{partialTail}};
    }catch(cause){if(cause instanceof Fault)throw cause;fail('RUN_LOG_INVALID','运行记录损坏或身份不一致，无法核实完整执行事实')}
  }
}
