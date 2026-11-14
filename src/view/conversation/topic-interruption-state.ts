/**
 * 作用定位：管理指定话题补充的冻结请求、持久恢复和只读回执查询，独立于聊天草稿及 React。
 * 设计原因：提交先保存同一命令；未知结果不能编辑后换 ID 重发。模型接收、全部成员退出和业务完成分别由后端事实证明。
 */
import {topicInterruptionRequestSchema,goalContinuationReceiptSchema} from '../../bridge/contracts/dispatch';
import type {TopicInterruptionRequest,GoalContinuationReceipt} from '../../bridge/contracts/dispatch';
import {JsonRecordStorage,SubscriptionSet,equalJson,type TextStorage} from '../foundations/utility';

export type TopicInterruptionTarget=Pick<TopicInterruptionRequest,'workspaceId'|'rootSessionId'|'scopeId'|'expectedInputRevision'>;
export interface TopicInterruptionPorts {
  storage:TextStorage;uuid:()=>string;
  submit:(request:TopicInterruptionRequest)=>Promise<unknown>;
  lookup:(request:Pick<TopicInterruptionRequest,'workspaceId'|'rootSessionId'|'scopeId'|'commandId'>)=>Promise<unknown>;
}
/** 回执必须精确匹配原请求，后续查询不能更换已受理运行或附件证明。 */
export function checkedTopicInterruptionReceipt(raw:unknown,request:TopicInterruptionRequest,previous?:GoalContinuationReceipt):GoalContinuationReceipt{
  const receipt=goalContinuationReceiptSchema.parse(raw),value=receipt.continuation;
  if(receipt.workspaceId!==request.workspaceId||receipt.rootSessionId!==request.rootSessionId||receipt.scopeId!==request.scopeId||value.continuationId!==request.commandId||value.wait.waitId!==request.commandId||value.wait.interruptionId!==request.commandId||value.inputRevision!==request.expectedInputRevision+1||!equalJson(value.input,request.input)||!equalJson(value.options,request.options)||previous&&!equalJson(value,previous.continuation))throw Error('回执与原话题补充不一致，请核实原请求');
  return receipt;
}
export interface TopicInterruptionState {ready:boolean;pending:boolean;request?:TopicInterruptionRequest;receipt?:GoalContinuationReceipt;error:string}

/** 一份控制器只拥有一个办公室、话题和输入版本；切换视图不能把旧响应写进新目标。 */
export class TopicInterruptionController {
  private value:TopicInterruptionState={ready:false,pending:false,error:''};
  private readonly records:JsonRecordStorage;
  private readonly listeners=new SubscriptionSet();
  private inFlight?:Promise<void>;
  private blocked=false;
  constructor(readonly target:TopicInterruptionTarget,private readonly ports:TopicInterruptionPorts){
    this.records=new JsonRecordStorage(ports.storage,'cbim.topic-input.v1.'+JSON.stringify([target.workspaceId,target.rootSessionId,target.scopeId,target.expectedInputRevision]),512*1024);
  }
  get snapshot(){return this.value}
  subscribe(listener:()=>void){return this.listeners.subscribe(listener)}
  private publish(value:Partial<TopicInterruptionState>){this.value={...this.value,...value};this.listeners.notify()}
  private validate(raw:unknown){
    const request=topicInterruptionRequestSchema.parse(raw);
    if(request.workspaceId!==this.target.workspaceId||request.rootSessionId!==this.target.rootSessionId||request.scopeId!==this.target.scopeId||request.expectedInputRevision!==this.target.expectedInputRevision)throw Error('本机补充记录属于其它办公室或输入版本，未发送');
    return request;
  }
  private run(work:()=>Promise<void>):Promise<void>{
    if(this.inFlight)return this.inFlight;
    this.publish({pending:true,error:''});
    const pending=Promise.resolve().then(work).catch(error=>this.publish({error:error instanceof Error?error.message:String(error)})).finally(()=>{this.inFlight=undefined;this.publish({pending:false})});
    this.inFlight=pending;return pending;
  }
  /** 重开只读本机请求及原回执；可采纳服务器上尚未消费的原请求，但绝不自动重发。 */
  restore(saved?:TopicInterruptionRequest):Promise<void>{return this.run(async()=>{
    try{
      const raw=this.records.read('本机话题补充记录过大，请核实后继续'),local=raw?this.validate(raw):undefined,canonical=saved?this.validate(saved):undefined;
      if(local&&canonical&&!equalJson(local,canonical))throw Error('本机补充与已保存的话题请求不同，请核实两份原请求');
      const request=local??canonical;
      if(request&&!local)this.records.write(request,'补充超出本机记录上限，未发送');
      this.publish({ready:true,request});
    }catch(error){this.blocked=true;throw error}
    if(this.value.request)await this.lookup();
  })}
  /** 普通草稿不传入此控制器；创建请求后，任何失败都保留冻结原文及选型。 */
  submit(message:string,options:TopicInterruptionRequest['options']):Promise<void>{return this.run(async()=>{
    if(!this.value.ready||this.blocked)throw Error('原补充记录尚未核实，未发送');
    if(this.value.request)throw Error('已有提交记录，请查询或重试原请求');
    const other=this.records.read('本机话题补充记录过大，请核实后继续');
    if(other){this.publish({request:this.validate(other)});throw Error('此话题已有提交记录，未创建重复请求')}
    const request=this.validate({...this.target,commandId:this.ports.uuid(),input:{message},options});
    this.records.write(request,'补充超出本机记录上限，未发送');this.publish({request});
    this.accept(await this.ports.submit(structuredClone(request)),request);
  })}
  private accept(raw:unknown,request:TopicInterruptionRequest){this.publish({receipt:checkedTopicInterruptionReceipt(raw,request,this.value.receipt),error:''})}
  private async lookup(){
    const request=this.value.request;if(!request)return;
    const receipt=await this.ports.lookup({workspaceId:request.workspaceId,rootSessionId:request.rootSessionId,scopeId:request.scopeId,commandId:request.commandId});
    if(receipt!==undefined)this.accept(receipt,request);
  }
  query(){return this.run(()=>this.lookup())}
  /** 只有用户明确点击才重试原请求；先查已受理结果，禁止换 ID、正文或权限。 */
  retry(){return this.run(async()=>{
    if(this.blocked||!this.value.request)throw Error('没有可重试的原补充记录');
    await this.lookup();if(this.value.receipt)return;
    const request=this.value.request;this.accept(await this.ports.submit(structuredClone(request)),request);
  })}
}
