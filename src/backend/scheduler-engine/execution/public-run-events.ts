/**
 * 作用定位：把主会话和成员运行事件转换为可展示的公开消息、工具状态、计划与证据摘要。
 * 设计原因：任务详情与静态 Agent 历史使用同一字段白名单，排除原生会话路径、冻结知识、工具输入正文及私有推理；公开正文限长，但不声称识别正文中的全部敏感信息。
 * 职责边界：这里只做纯投影，读取方须先核验完整归属；人工决定的系统转交仅公开来源种类和固定摘要，不当用户原话或透传意见正文，不把运行结束当作验收。
 * 仓库范围：保留真实链接器、仓库、共享代际与操作，正文/地址/凭据不经公开投影透传。
 */
import path from 'node:path';
import type {StoredEvent,TaskSpec} from '../../core/brain/types';
import type {TaskProgress} from '../../core/tasks/progress';
import type {ToolReceipt} from '../../core/tools/types';
import {repositoryToolScopeSchema} from '../../core/tools/scope-schema';

/** 已核实的运行身份；成员、主对话和旧日志都不能通过投影改变其归属。 */
export interface PublicRunIdentity {workspaceId:string;taskId:string;runId:string}

const record=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
const text=(value:unknown,max=256000)=>typeof value==='string'?value.slice(0,max):undefined;
const number=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)&&value>=0?value:undefined;
const texts=(value:unknown,max=16000)=>Array.isArray(value)?value.filter((item):item is string=>typeof item==='string').map(item=>item.slice(0,max)):[];
/** 仓库范围保留完整捕获身份，但不公开 URL、令牌、授权版本或任意附加字段。 */
function publicScope(value:unknown,binding:PublicRunIdentity):ToolReceipt['scope']{
  const scope=record(value);
  if(scope.kind==='repository'){
    const parsed=repositoryToolScopeSchema.safeParse({kind:scope.kind,workspaceId:scope.workspaceId,connectorId:scope.connectorId,repositoryId:scope.repositoryId,connectionId:scope.connectionId,operation:scope.operation});
    if(parsed.success&&parsed.data.workspaceId===binding.workspaceId)return parsed.data;
    return {kind:'unknown',workspaceId:binding.workspaceId};
  }
  return {kind:['workspace','knowledge','unknown'].includes(String(scope.kind))?scope.kind as 'workspace'|'knowledge'|'unknown':'unknown',workspaceId:binding.workspaceId};
}
const labels=new Set(['正在思考…','正在生成…','Pi 运行配置已应用','上下文用量已更新','模型请求额度','模型连接重试中','模型连接已恢复','模型重试已结束','正在整理对话上下文','上下文整理已取消','上下文整理失败','上下文整理结束','上下文摘要等待重试','正在重试上下文摘要','上下文摘要重试结束','本轮用量已汇总','正在插入用户补充','已插入，当前动作完成后处理','插入未确认，请核实后继续']);
function usage(value:unknown){const input=record(value),out:Record<string,unknown>={};for(const key of ['input','output','cacheRead','cacheWrite','totalTokens','reasoning'])if(number(input[key])!==undefined)out[key]=input[key];const cost=record(input.cost),costs:Record<string,number>={};for(const key of ['input','output','cacheRead','cacheWrite','total'])if(number(cost[key])!==undefined)costs[key]=cost[key] as number;if(Object.keys(costs).length)out.cost=costs;return out}
function progress(value:unknown):TaskProgress|undefined{
  const data=record(value);if(!Number.isSafeInteger(data.version)||!Array.isArray(data.steps)||!['executing','awaiting_review'].includes(String(data.state)))return;
  const delivery=record(data.delivery);
  return {version:data.version as number,goal:text(data.goal,16000)??'',acceptance:texts(data.acceptance).slice(0,50),reason:text(data.reason,4000)??'',state:data.state as TaskProgress['state'],steps:data.steps.slice(0,50).map(value=>{const step=record(value);return {id:text(step.id,80)??'',title:text(step.title,4000)??'',owner:text(step.owner,4000)??'',state:['pending','working','reported_done'].includes(String(step.state))?step.state as 'pending'|'working'|'reported_done':'pending',evidence:texts(step.evidence,128).slice(0,30)}}),...(typeof delivery.summary==='string'?{delivery:{summary:delivery.summary.slice(0,4000),limitations:texts(delivery.limitations,4000).slice(0,30)}}:{})};
}
function receipt(value:unknown,binding:PublicRunIdentity):ToolReceipt|undefined{
  const data=record(value);
  if(data.version!==1||data.workspaceId!==binding.workspaceId||data.taskId!==binding.taskId||data.runId!==binding.runId||!['succeeded','failed','denied','unknown'].includes(String(data.outcome)))return;
  return {version:1,toolCallId:text(data.toolCallId,128)??'',toolName:text(data.toolName,128)??'',workspaceId:binding.workspaceId,taskId:binding.taskId,runId:binding.runId,outcome:data.outcome as ToolReceipt['outcome'],inputHash:text(data.inputHash,64)??'',...(typeof data.resultHash==='string'?{resultHash:data.resultHash.slice(0,64)}:{}),effects:texts(data.effects,40).filter((effect):effect is ToolReceipt['effects'][number]=>['read','preview','maintenance','business-write','knowledge-write','command'].includes(effect)),scope:publicScope(data.scope,binding),recordedAt:text(data.recordedAt,40)??''};
}
/** 只保留工作区内业务文件的定位；不返回 .cbim、外部路径、命令参数或写入正文。 */
function businessPath(value:unknown,root:string){
  if(typeof value!=='string'||value.length>4096||/[\x00-\x1f]/.test(value))return;
  const relative=path.relative(root,path.resolve(root,value));
  if(!relative||relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative)||relative.split(/[\\/]/).some(part=>part.toLowerCase()==='.cbim'))return;
  return relative.replace(/\\/g,'/');
}
/** 显式选择每种事件的公开字段；不把未审核的新字段经 spread 透传给前端。 */
export function projectRunEvent(event:StoredEvent,identity:PublicRunIdentity,task:TaskSpec):StoredEvent{
  const source=record(event.data);let type=event.type,data:Record<string,unknown>;
  switch(type){
    case 'run.started':{
      // 成员启动 message 可能包含冻结提示词，只展示正式任务目标；主对话保留本轮用户原话，回注正文不冒充用户输入。
      const kind=task.mode==='chat'?record(source.source).kind:undefined,returned=kind==='member-results'||kind==='human_decisions';
      const message=kind==='human_decisions'?'按已保存的人工决定继续（系统转交）':returned?'成员任务结果回注（系统数据）':task.mode==='chat'?text(source.message,16000)??task.goal:task.goal;
      data={task:structuredClone(task),message,...(returned?{source:{kind}}:{}),...(source.engine==='pi'?{engine:'pi'}:{})};break;
    }
    case 'session.bound':type='engine.status';data={label:'成员会话已连接'};break;
    case 'message':
      if(!['user','assistant'].includes(String(source.role))){type='engine.status';data={label:'执行记录已更新'};break}
      data={role:source.role,text:text(source.text)??'',...(['stop','length','error','aborted','toolUse'].includes(String(source.stopReason))?{stopReason:source.stopReason}:{}),usage:usage(source.usage),...(number(source.generationDurationMs)!==undefined?{generationDurationMs:source.generationDurationMs}:{}),...(typeof source.pricingKnown==='boolean'?{pricingKnown:source.pricingKnown}:{})};break;
    case 'message.delta':data={text:text(source.text)??''};break;
    case 'tool.proposed':case 'tool.allowed':case 'tool.denied':case 'tool.started':case 'tool.updated':case 'tool.finished':{
      const safeReceipt=receipt(source.receipt,identity),locator=businessPath(record(source.input).path,task.root);
      data={id:text(source.id,128)??'',name:text(source.name,128)??safeReceipt?.toolName??'',...(locator?{input:{path:locator}}:{}),...(safeReceipt?{receipt:safeReceipt}:{})};
      if(type==='tool.allowed'){data.allow=true;const scope=publicScope(source.scope,identity);if(scope.kind==='repository')data.scope=scope}
      if(type==='tool.denied'){data.allow=false;data.reason='操作未获授权；详细策略信息保留在本机运行记录'}
      if(type==='tool.finished'||type==='tool.updated'){
        data.isError=source.isError===true;data.result={content:[{type:'text',text:type==='tool.updated'?'工具执行中；进度正文未公开':source.isError?'工具执行失败；详细错误正文未公开':'工具已完成；详细正文未公开'}]};
        if(record(source.result).truncated===true)data.truncated=true;
      }
      break;
    }
    case 'task.updated':{const state=progress(source.progress);data=state?{progress:state}:{};break}
    case 'engine.status':{
      data={label:labels.has(String(source.label))?source.label:'运行状态已更新'};
      if(['activity','context','request-limit','run-usage','insertion'].includes(String(source.metric)))data.metric=source.metric;
      for(const key of ['tokens','contextWindow','maxTokens','workingContextWindow','compactionPercent','attempt','delayMs','cost'])if(number(source[key])!==undefined)data[key]=source[key];
      if(source.metric==='run-usage')data.tokens=usage(source.tokens);
      for(const key of ['pricingKnown','autoCompaction','willRetry'])if(typeof source[key]==='boolean')data[key]=source[key];
      for(const key of ['thinkingLevel','requestedThinking'])if(['off','minimal','low','medium','high','xhigh'].includes(String(source[key])))data[key]=source[key];
      break;
    }
    case 'run.stop_requested':data={};break;
    case 'run.settled':data={status:['completed','cancelled','failed'].includes(String(source.status))?source.status:'failed',acceptance:'not_evaluated',...(source.error?{error:'本轮执行失败，请核实工具状态与产物'}:{})};break;
    case 'run.interrupted':data={error:'执行中断，请核实未确认的操作与产物',unresolvedTools:texts(source.unresolvedTools,128),receipts:Array.isArray(source.receipts)?source.receipts.map(item=>receipt(item,identity)).filter(Boolean):[]};break;
    default:type='engine.status';data={label:'执行记录已更新'};
  }
  return {version:1,seq:event.seq,taskId:task.taskId,runId:identity.runId,workspaceId:task.workspaceId,time:event.time,type,data};
}

