/**
 * 目录归属：backend/scheduler-engine/goals；目标状态与核证恢复服务。
 * 作用定位：共享主调度原命令的指纹构造，从已核实 canonical 参数复原历史请求，包含原子前置增删。
 * 设计原因：运行原始 inputHash 与领域解析后的指纹不同；复原保留 trim、缺省和键序，不能用今日执行资格拒绝旧命令查询。
 * 职责边界：纯转换不读 Store、不授权、不执行；派发隐藏父版本只能由调用方提供可信原事务前态。
 */
import {z} from 'zod';
import {hash,json} from '../../core/foundation/serialization';
import {fail} from '../../core/foundation/errors';
import type {GraphIdentity} from '../../core/tasks/graph-types';
import type {DispatchCommand} from '../../core/dispatch/dispatch-storage';
import {dispatchTaskFields,dispatchTaskInput} from '../../core/tasks/dispatch-commands';
import {goalPlanInputSchema,goalReviewInputSchema} from '../../core/tasks/scope-goal';
import {cancelQueuedTasksInputSchema} from '../../core/tasks/queued-task-cancel';
import {replaceQueuedDependencyInputSchema} from '../../core/tasks/queued-dependency-replacement';
import {addQueuedDependencyInputSchema} from '../../core/tasks/queued-dependency-addition';
import {reviseQueuedDependenciesInputSchema} from '../../core/tasks/queued-dependency-revision';
import {resumeMemberInputSchema} from '../../core/tasks/queued-member-resume';
import {abandonCheckpointInputSchema} from '../../core/tasks/checkpoint-handoff';
import type {VerifiableMainToolName} from '../../core/tasks/command-verification';
import type {MainToolOutputBinding} from '../../core/tasks/main-tool-output';
import {mainToolCommandId} from '../tools/main-tool-contracts';

/** 保持既有字段插入顺序；不要改为 canonical 排序，否则已保存指纹将不再匹配。 */
export function goalCommand(operation:string,identity:GraphIdentity,scopeId:string,runId:string,commandId:string,draft:unknown):DispatchCommand{return {commandId,fingerprint:hash(json({operation,identity,scopeId,runId,draft}))}}
/** 原桌面/Auto 共用命令格式；actor 是既有命名空间，不据此推断真人操作。 */
export function dispatchCommand<T extends {commandId:string}>(operation:string,input:T):DispatchCommand{return {commandId:input.commandId,fingerprint:hash(json({operation,actor:'desktop-local-user',input}))}}
/** 撤销、加边、换边与放弃保留各自 context（runId 或 mainRunId），不能混用字段。 */
export function contextualMainCommand<T extends {commandId:string}>(operation:string,context:T,input:unknown):DispatchCommand{return {commandId:context.commandId,fingerprint:hash(json({operation,context,input}))}}
/** 预约原格式不在指纹正文重复 commandId；只读核实必须与提交方一致。 */
export function memberResumeCommand(identity:GraphIdentity,scopeId:string,mainRunId:string,commandId:string,input:unknown):DispatchCommand{return {commandId,fingerprint:hash(json({operation:'member.resume.request',identity,scopeId,mainRunId,input}))}}

const {assigneeAgentId,...taskFields}=dispatchTaskFields.shape;
// 旧工具允许缺省内置角色；这里只复原历史，执行工具仍独立要求明确岗位和角色。
const historicalTaskInput=z.object({agentId:assigneeAgentId.default('cbim:executor'),...taskFields}).strict();
/** 输入是领域再次解析后用于严格回执比对的公开请求；未给父版本时只返回可查的原命令键。 */
export interface RestoredMainCommand {commandId:string;fingerprint?:string;input:unknown}
export function restoreMainCommand(name:VerifiableMainToolName,binding:MainToolOutputBinding,toolCallId:string,raw:unknown,parentRevision?:number):RestoredMainCommand{
  const identity={workspaceId:binding.workspaceId,rootSessionId:binding.rootSessionId},scopeId=binding.scopeId,runId=binding.runId,commandId=mainToolCommandId(name,binding,toolCallId)!;
  if(name==='cbim_goal_plan'||name==='cbim_goal_review'){
    const draft=(name==='cbim_goal_plan'?goalPlanInputSchema:goalReviewInputSchema).parse(raw);
    return {...goalCommand(name==='cbim_goal_plan'?'goal.plan':'goal.review',identity,scopeId,runId,commandId,draft),input:draft};
  }
  if(name==='cbim_dispatch_task'){
    const parsed=historicalTaskInput.parse(raw),{agentId,...task}=parsed;
    if(agentId==='cbim:main')fail('COMMAND_INPUT_UNSUPPORTED','原派发角色不能是主调度');
    if(parentRevision===undefined)return {commandId,input:parsed};
    const request=dispatchTaskInput.parse({...identity,commandId,expectedParentRevision:parentRevision,task:{...task,assigneeAgentId:agentId}});
    return {...dispatchCommand('dispatch',{...request,scopeId}),input:parsed};
  }
  if(name==='cbim_dispatch_resume'){
    const input=resumeMemberInputSchema.parse(raw);return {...memberResumeCommand(identity,scopeId,runId,commandId,input),input};
  }
  if(name==='cbim_dispatch_abandon_checkpoint'){
    const input=abandonCheckpointInputSchema.parse(raw),context={...identity,scopeId,mainRunId:runId,commandId};
    return {...contextualMainCommand('member.checkpoint.abandon',context,input),input};
  }
  const input=name==='cbim_dispatch_cancel'?cancelQueuedTasksInputSchema.parse(raw):name==='cbim_dispatch_add_dependency'?addQueuedDependencyInputSchema.parse(raw):name==='cbim_dispatch_revise_dependencies'?reviseQueuedDependenciesInputSchema.parse(raw):replaceQueuedDependencyInputSchema.parse(raw);
  const operation=name==='cbim_dispatch_cancel'?'dispatch.cancelQueued':name==='cbim_dispatch_add_dependency'?'dispatch.addDependency':name==='cbim_dispatch_revise_dependencies'?'dispatch.reviseDependencies':'dispatch.replaceDependency';
  return {...contextualMainCommand(operation,{...identity,scopeId,runId,commandId},input),input};
}
