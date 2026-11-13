/**
 * 作用定位：保存一次原主工具调用的显式核实状态，校验报告身份并隔离迟到的异步响应。
 * 设计原因：工具失败与事务已保存可能同时成立；查询不得自动重试执行、清除未确认项或随轮询反复回读。读取失败保留旧报告并提示其时效。
 * 来源边界：旧或不完整轨道缺少 task 时只保留原展示，不创建核实入口，也不把角色名当成完整主会话身份。
 * 订阅边界：前端 SubscriptionSet 只持有监听器；通知时机、状态、轮询及销毁仍由本控制器决定。
 */
import {SubscriptionSet} from '../foundations/utility';
import {commandVerificationInputSchema,commandVerificationReportSchema} from '../../bridge/contracts/command-verification';
import type {CommandVerificationInput,CommandVerificationReport} from '../../bridge/contracts/command-verification';
import type {RunSummary} from '../../bridge/contracts/execution';

/** expectedToolName 来自所展示的原轨道，只用于响应核对，不传给后端充当命令依据。 */
export type CommandVerificationSelection=CommandVerificationInput&{expectedToolName:string};
export interface CommandVerificationState {report?:CommandVerificationReport;loading:boolean;error:string}
export const commandVerificationKey=(selection:CommandVerificationSelection)=>JSON.stringify([selection.workspaceId,selection.rootSessionId,selection.runId,selection.toolCallId,selection.expectedToolName]);

/** 仅真实主实例的工具轨道可装配入口；成员日志和无绑定旧日志不能按角色名推测主运行。 */
export function mainCommandSelection(run:RunSummary,toolCallId:string,toolName:string):CommandVerificationSelection|undefined{
  const binding=run.conversationBinding,task=run.task;
  if(!task||task.mode!=='chat'||task.agentId!=='cbim:main'||run.memberBinding||!binding||binding.agentId!=='cbim:main'||binding.workspaceId!==task.workspaceId||binding.rootSessionId!==task.taskId)return;
  const parsed=commandVerificationInputSchema.safeParse({workspaceId:task.workspaceId,rootSessionId:binding.rootSessionId,runId:run.runId,toolCallId});
  return parsed.success?{...parsed.data,expectedToolName:toolName}:undefined;
}

/** 严格校验后才替换报告；其它会话、运行、调用或工具的回包不能显示为当前原命令证据。 */
export function applyCommandVerification(raw:unknown,selection:CommandVerificationSelection):CommandVerificationReport{
  const report=commandVerificationReportSchema.parse(raw),identity=report.identity;
  if(identity.workspaceId!==selection.workspaceId||identity.rootSessionId!==selection.rootSessionId||identity.runId!==selection.runId||identity.toolCallId!==selection.toolCallId)throw Error('核实报告不属于所选原命令');
  if(report.source.toolName&&report.source.toolName!==selection.expectedToolName)throw Error('核实报告的工具与原调用不一致');
  return report;
}

/** 日志追加仅提示报告时效，不否定已经核实的原提交，也不自行再次访问后端。 */
export function commandVerificationStale(report:CommandVerificationReport|undefined,latestSeq:number):boolean{
  return !!report&&(report.consistency==='changed_during_read'||report.basis.throughSeq!==undefined&&latestSeq>report.basis.throughSeq);
}

/** 控制器只拥有一组原身份；构造和订阅不读取，inspect 是唯一请求入口。 */
export class CommandVerificationController {
  private value:CommandVerificationState={loading:false,error:''};
  private generation=0;
  private listeners=new SubscriptionSet();
  readonly selection:CommandVerificationSelection;
  constructor(selection:CommandVerificationSelection,private read:(request:CommandVerificationInput)=>Promise<unknown>){this.selection={...selection}}
  get snapshot(){return this.value}
  subscribe=(listener:()=>void)=>{return this.listeners.subscribe(listener)};
  private publish(value:CommandVerificationState){this.value=value;this.listeners.notify()}
  /** 卸载只取消观察，忽略迟到回包；不停止原任务、不修改服务端日志。 */
  cancel(){this.generation++;this.value={...this.value,loading:false}}
  /** 同一实例在途时合并重复点击；失败保留旧报告，绝不转调原工具或自动重读。 */
  async inspect(){
    if(this.value.loading)return;
    const {workspaceId,rootSessionId,runId,toolCallId}=this.selection,generation=this.generation;
    this.publish({...this.value,loading:true,error:''});
    try{const raw=await this.read({workspaceId,rootSessionId,runId,toolCallId});if(generation!==this.generation)return;this.publish({report:applyCommandVerification(raw,this.selection),loading:false,error:''})}
    catch(cause){if(generation===this.generation)this.publish({...this.value,loading:false,error:cause instanceof Error?cause.message:'原命令核实失败，请重新读取'})}
  }
}
