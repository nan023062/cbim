/**
 * 作用定位：在唯一工作区日志提交及重放时核实递归业务身份登记。
 * 设计原因：保存与文件阶段共用事务屏障，但不允许混写；固定父调用、范围和知识不可换绑。
 */
import {isDeepStrictEqual as equal} from 'node:util';
import {fail} from '../../../core/errors';
import {hash,json} from '../../../core/platform/node/serialization';
import {safeId} from '../ports/identity';
import {validatePreparedDispatchKnowledge} from '../../tasks/rules/execution-context';
import {checkedMemberRunBinding} from './member-run';
import type {AgentBusinessRun} from './business-run';
import type {DispatchState,DispatchMutation,DispatchCommand} from '../../dispatch/rules/dispatch-storage';
const check=(value:unknown,message:string)=>{if(!value)fail('AGENT_RUN_AUDIT',message)};
/** 固定幂等键和内容摘要；同一状态不能换绑原身份。 */
export const agentBusinessRunCommand=(run:AgentBusinessRun)=>({commandId:'agent-business-run:'+run.binding.runId+':'+run.status,fingerprint:hash(json(run))});
export function projectAgentBusinessRuns(previous:DispatchState,mutation:DispatchMutation,command:DispatchCommand):Pick<DispatchState,'agentBusinessRuns'>{
  const old=previous.agentBusinessRuns??[];
  if(mutation.agentBusinessRuns===undefined){
    check(!command.commandId.startsWith('agent-business-run:'),'运行命令缺少登记');
    return previous.agentBusinessRuns===undefined?{}:{agentBusinessRuns:old};
  }
  check(Array.isArray(mutation.agentBusinessRuns)&&mutation.agentBusinessRuns.length===1&&Object.keys(mutation).every(key=>key==='agentBusinessRuns'||key==='receipt'),'运行登记必须独立单条提交');
  const value=mutation.agentBusinessRuns[0],b=value.binding,p=value.parent;
  check(value.protocol==='agent-tools-v1'&&['active','closed'].includes(value.status)&&Object.keys(value).every(key=>['protocol','binding','scopeId','parent','lineage','prepared','permission','status','createdAt','closedAt'].includes(key)),'运行协议或字段无效');
  validatePreparedDispatchKnowledge(value.prepared);
  checkedMemberRunBinding(b,{taskId:b.taskId,workspaceId:previous.workspaceId,root:'',goal:'',moduleIds:value.prepared.modules.map(m=>m.binding.moduleId),acceptance:[],agentId:value.prepared.agent.agentId,ownerBinding:value.prepared.memberContext?.binding},b.runId);
  check(b.workspaceId===previous.workspaceId&&value.prepared.workspaceId===b.workspaceId&&['read','ask','execute'].includes(value.permission)&&!!value.prepared.memberContext&&!value.prepared.fallbackBinding,'运行缺少原岗位或工作区身份');
  for(const id of [value.scopeId,p.callerTaskId,p.callerRunId])safeId(id);
  check(p.version===1&&p.workspaceId===b.workspaceId&&p.taskId===b.taskId&&p.runId===b.runId&&typeof p.toolCallId==='string'&&p.toolCallId.length>0&&p.toolCallId.length<=512&&Object.keys(p).every(key=>['version','workspaceId','callerTaskId','callerRunId','toolCallId','taskId','runId'].includes(key)),'父工具引用无效');
  check(Array.isArray(value.lineage)&&value.lineage.length>0&&value.lineage.length<=8&&equal(value.lineage[0],p),'调用来源链无效');
  for(const [index,link] of value.lineage.entries()){
    check(link.version===1&&link.workspaceId===b.workspaceId,'来源链跨工作区');
    for(const id of [link.taskId,link.runId,link.callerTaskId,link.callerRunId])safeId(id);
    const next=value.lineage[index+1];if(next)check(link.callerTaskId===next.taskId&&link.callerRunId===next.runId,'来源链不连续');
  }
  check(new Set(value.lineage.map(link=>link.runId)).size===value.lineage.length,'来源链循环');
  check(equal(command,agentBusinessRunCommand(value))&&equal(mutation.receipt,value),'运行命令或回执与登记不一致');
  check(Number.isFinite(Date.parse(value.createdAt)),'运行时间无效');
  const prior=old.find(run=>run.binding.runId===b.runId),scope=previous.scopes?.find(s=>s.scopeId===value.scopeId&&s.workspaceId===b.workspaceId&&s.rootSessionId===b.rootSessionId);
  if(!prior){
    check(value.status==='active'&&value.closedAt===undefined&&scope?.status==='active'&&!scope.budget?.blocked,'新业务运行必须属于活动周期');
    // 新核实允许普通递归读取，但持久事务也必须拒绝写权限和旧协议混入。
    if(scope?.recovery)check('executionModel' in scope.recovery.source&&scope.recovery.source.executionModel==='agent-tools-v1'&&value.permission==='read','只读递归核实不得扩大权限或借用旧恢复周期');
    check(!previous.runs?.some(run=>run.binding.runId===b.runId||run.binding.taskId===b.taskId)&&!old.some(run=>run.binding.taskId===b.taskId||(run.parent.callerRunId===p.callerRunId&&run.parent.toolCallId===p.toolCallId)),'运行身份不得复用');
    const parent=old.find(run=>run.binding.taskId===p.callerTaskId&&run.binding.runId===p.callerRunId&&run.scopeId===value.scopeId);
    const root=value.lineage.at(-1)!;
    check(root.callerTaskId===b.rootSessionId&&scope?.runTracking?.mainRunIds.at(-1)===root.callerRunId&&(!parent||parent.status==='active'),'父运行未登记或已关闭');
    if(parent){check(value.prepared.modules.every(module=>parent.prepared.modules.some(m=>m.binding.moduleId===module.binding.moduleId)),'子调用扩大父模块范围');check(['read','ask','execute'].indexOf(value.permission)<=['read','ask','execute'].indexOf(parent.permission),'子调用扩大父权限')}
    check(old.length<10000&&Buffer.byteLength(JSON.stringify([...old,value]))<=64*1024*1024,'业务运行审计容量已满，原记录不淘汰');
    return {agentBusinessRuns:[...old,structuredClone(value)]};
  }
  check(prior.status==='active'&&value.status==='closed'&&typeof value.closedAt==='string'&&Date.parse(value.closedAt)>=Date.parse(value.createdAt)&&equal({...prior,status:'closed',closedAt:value.closedAt},value),'只能在排空后封存原运行，不得修改固定事实');
  check(!old.some(run=>run.lineage.some(link=>link.callerRunId===b.runId)&&run.status==='active'),'后代尚未排空，不能封存父运行');
  return {agentBusinessRuns:old.map(run=>run.binding.runId===b.runId?structuredClone(value):run)};
}
