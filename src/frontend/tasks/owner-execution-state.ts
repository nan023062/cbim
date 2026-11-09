/**
 * 作用定位：将任务内冻结的负责人绑定投影为只读展示状态，供对话卡片、任务节点与详情共用。
 * 设计原因：缺省旧记录不能从静态 Agent 猜岗位；局部校验只证明记录自身对应，不把历史快照当作当前领取许可。
 */
import type {TaskNode} from '../../bridge/contracts/dispatch';
import {ownerExecutionBindingMatches,taskOwnerInspectOutputSchema,type OwnerExecutionBinding,type TaskOwnerInspectInput,type TaskOwnerInspectOutput} from '../../bridge/contracts/owner-execution';

export type OwnerTaskView={kind:'bound';binding:OwnerExecutionBinding}|{kind:'invalid'}|{kind:'legacy';needsReplan:boolean};
/** 旧在途只展示原事实；未领取或未消费检查点不能借阅读历史获得新的执行身份。 */
export function ownerTaskView(task:TaskNode):OwnerTaskView {
  if(task.ownerBinding===undefined)return {kind:'legacy',needsReplan:!task.activeRunId&&['planned','queued','waiting','checkpointed'].includes(task.status)};
  if(!ownerExecutionBindingMatches(task.ownerBinding,task.identity.workspaceId,task.assignee.agentId,task.modules.map(module=>module.moduleId)))return {kind:'invalid'};
  return {kind:'bound',binding:task.ownerBinding};
}

const canonical=(value:unknown):string=>JSON.stringify(value&&typeof value==='object'?Array.isArray(value)?value.map(item=>JSON.parse(canonical(item))):Object.fromEntries(Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>[k,JSON.parse(canonical(v))])):value)??'null';
/** 图版本变化使旧观察失效；序列化仅用于本地视图隔离，不是服务端许可或哈希。 */
export function ownerInspectionKey(task:TaskNode):string{return canonical({identity:task.identity,taskId:task.taskId,revision:task.revision,ownerBinding:task.ownerBinding,agentId:task.assignee.agentId,moduleIds:task.modules.map(module=>module.moduleId)})}
export interface OwnerInspectionView {report:TaskOwnerInspectOutput;comparison:'matching'|'changed'|'unavailable'|'legacy';issues:string[]}
/** 核对原冻结记录及此次读取的完整模块集合，再比较当前选择；不从只读响应启动或修复任务。 */
export function checkedOwnerInspection(raw:unknown,task:TaskNode):OwnerInspectionView {
  const parsed=taskOwnerInspectOutputSchema.safeParse(raw),modules=task.modules.map(module=>module.moduleId);
  if(!parsed.success)throw Error('负责人核实响应无效，请重新读取');
  const report=parsed.data,current=report.current;
  if(report.identity.workspaceId!==task.identity.workspaceId||report.identity.rootSessionId!==task.identity.rootSessionId||report.taskId!==task.taskId||report.taskRevision!==task.revision||canonical(report.ownerBinding)!==canonical(task.ownerBinding)||current.workspaceId!==task.identity.workspaceId||current.moduleIds.length!==modules.length||modules.some(id=>!current.moduleIds.includes(id)))throw Error('负责人核实响应不属于当前任务版本，请重新读取');
  const previous=ownerTaskView(task);if(previous.kind==='invalid')throw Error('原岗位绑定无效，请先重新同步任务');
  const issues=current.groups.flatMap(group=>group.issues.map(issue=>issue.message));
  if(previous.kind==='legacy')return {report,comparison:'legacy',issues};
  if(issues.length)return {report,comparison:'unavailable',issues};
  const binding=previous.binding;
  const matching=current.groups.every(group=>{
    const selection=group.selection;
    return selection&&group.agentId===binding.capability.agentId&&selection.memberId===binding.memberId&&selection.expectedMemberRevision===binding.memberRevision&&selection.expectedCapabilityHash===binding.capability.capabilityHash&&selection.expectedConfigurationHash===binding.model.configurationHash&&selection.expectedOwners.every(owner=>{const old=binding.owners.find(item=>item.moduleId===owner.moduleId);return old&&old.bindingId===owner.bindingId&&old.revision===owner.revision&&old.ownerMemberId===owner.ownerMemberId});
  });
  return {report,comparison:matching?'matching':'changed',issues};
}

export interface OwnerInspectionState {key:string;loading:boolean;view?:OwnerInspectionView;error?:string}
/** 一次显式核实的内存控制器；切换或新版本作废迟到结果，不取消后端已完成的只读观察。 */
export class OwnerInspectionController {
  private task:TaskNode;
  private serial=0;
  private inFlight?:Promise<void>;
  private listeners=new Set<()=>void>();
  private value:OwnerInspectionState;
  constructor(task:TaskNode,private readonly read:(input:TaskOwnerInspectInput)=>Promise<unknown>){this.task=structuredClone(task);this.value={key:ownerInspectionKey(task),loading:false}}
  get snapshot():OwnerInspectionState{return this.value}
  subscribe(listener:()=>void){this.listeners.add(listener);return()=>{this.listeners.delete(listener)}}
  private publish(value:OwnerInspectionState){this.value=value;for(const listener of this.listeners)listener()}
  /** 仅同步观察对象，不自动读取；新节点/版本不会沿用旧报告或进行中的操作状态。 */
  observe(task:TaskNode){const key=ownerInspectionKey(task);if(key===this.value.key)return;this.serial++;this.inFlight=undefined;this.task=structuredClone(task);this.publish({key,loading:false})}
  /** 同一版本双击合并；无轮询，网络失败保留同版本旧报告并明确显示过期读取错误。 */
  inspect():Promise<void>{
    if(this.inFlight)return this.inFlight;
    const task=this.task,key=this.value.key,serial=++this.serial;
    this.publish({...this.value,loading:true,error:undefined});
    const work=Promise.resolve().then(()=>this.read({...task.identity,taskId:task.taskId})).then(raw=>{const view=checkedOwnerInspection(raw,task);if(this.serial===serial)this.publish({key,loading:false,view})}).catch(cause=>{if(this.serial===serial)this.publish({...this.value,loading:false,error:cause instanceof Error?cause.message:'负责人核实失败，请重试读取'})}).finally(()=>{if(this.serial===serial)this.inFlight=undefined});
    this.inFlight=work;return work;
  }
  /** 卸载只阻止本地迟到发布，不声称取消了服务端读取。 */
  dispose(){this.serial++;this.inFlight=undefined;this.listeners.clear()}
}
