/**
 * 作用定位：从成员 canonical 运行日志核实一次结构化求助的安全交接候选。
 * 设计原因：模型调用成功不等于可交接；必须正常结束、没有未决工具且求助后没有新工作，才允许主调度另派新任务。
 * 外部写也算求助后的新工作；当前成员未装配反馈工具，历史核验仍按真实效果防守。
 */
import {fail} from '../../core/foundation/errors';
import {json} from '../../core/foundation/serialization';
import type {RunSummary} from '../../core/brain/types';
import type {DispatchRun} from '../../core/tasks/dispatch-execution';
import type {TaskNode} from '../../core/tasks/graph-types';
import {memberHelpInputSchema,memberHelpRecordSchema,memberHelpResultSchema,memberHelpStagedSchema,type MemberHelpRecord} from '../../core/tasks/member-help';
import {executionToolFacts} from './execution-report-facts';

/** 已登记求助或返回成功求助正文的运行不能同时签发交付候选；失败的无效调用仍可被模型修正。 */
export function hasMemberHelp(summary:RunSummary):boolean {
  return summary.events.some(event=>String(event.type)==='task.help_requested'||event.type==='tool.finished'&&event.data?.name==='cbim_task_help'&&!event.data.isError);
}
const equal=(a:unknown,b:unknown)=>json(a)===json(b);
function valid(value:unknown):asserts value {if(!value)fail('MEMBER_HELP_INVALID','求助记录未通过完整运行、授权回执和工具结束检查，请核实后重新安排任务')}
/**
 * 调用方须在引擎关闭后重读 canonical 日志。这里只核实并构造冻结记录，不启动任务、不消费邮件或签发用户授权。
 * failed/cancelled/未知副作用始终不能升级为安全求助；普通运行没有求助时返回 undefined。
 */
export function memberHelpCandidate(task:TaskNode,run:DispatchRun,summary:RunSummary):MemberHelpRecord|undefined {
  if(!hasMemberHelp(summary))return;
  valid(task.scopeId&&summary.status==='completed'&&!summary.logIntegrity?.partialTail&&!summary.unresolvedTools.length&&equal(summary.memberBinding,run.binding)&&summary.runId===run.binding.runId&&summary.task.taskId===task.taskId);
  valid(!summary.events.some(event=>event.type==='run.stop_requested'||event.type==='run.interrupted'));
  valid(summary.events.every((event,index)=>event.seq===index+1&&event.workspaceId===run.binding.workspaceId&&event.taskId===task.taskId&&event.runId===run.binding.runId&&event.data&&typeof event.data==='object'&&!Array.isArray(event.data)));
  const terminal=summary.events.at(-1);valid(terminal?.type==='run.settled'&&terminal.data.status==='completed');
  const requests=summary.events.filter(event=>String(event.type)==='task.help_requested');valid(requests.length===1);
  const requested=requests[0],parsed=memberHelpStagedSchema.safeParse(requested.data?.help);valid(parsed.success);
  const help=parsed.data;valid(equal(help.binding,run.binding)&&help.binding.planRevision===task.planRevision&&help.binding.agentInstanceId===task.assignee.agentInstanceId&&help.binding.agentSessionId===task.assignee.agentSessionId);
  const facts=executionToolFacts(summary,run);valid(!facts.invalid&&!facts.counts.unknown&&!facts.counts.not_authorized);
  const own=facts.items.find(item=>item.toolCallId===help.toolCallId);valid(own?.toolName==='cbim_task_help'&&own.status==='succeeded'&&own.allowedSeq!==undefined&&own.allowedSeq<requested.seq&&own.finishedSeq!==undefined&&own.finishedSeq>requested.seq);
  const proposed=summary.events.find(event=>event.type==='tool.proposed'&&event.data?.id===help.toolCallId),finished=summary.events.find(event=>event.seq===own.finishedSeq);
  const input=memberHelpInputSchema.safeParse(proposed?.data.input);valid(input.success&&equal(input.data,help.input));
  const result=finished?.data.result as {content?:unknown[]}|undefined;
  valid(result&&Array.isArray(result.content)&&result.content.length===1);
  const text=result.content[0] as {type?:string;text?:string};valid(text?.type==='text'&&typeof text.text==='string');
  let body:unknown;try{body=JSON.parse(text.text)}catch{valid(false)}
  const returned=memberHelpResultSchema.safeParse(body);valid(returned.success&&equal(returned.data.help,help));
  let lastEffectSeq=0;
  for(const item of facts.items){
    if(item.toolCallId===help.toolCallId)continue;
    const denied=summary.events.find(event=>event.type==='tool.denied'&&event.data?.id===item.toolCallId),end=item.finishedSeq??denied?.seq;
    // 求助前已经放行的调用必须先结束；后续只允许只读任务查询。失败/拒绝回执不会抹掉先前副作用。
    if(item.allowedSeq!==undefined){
      valid(end!==undefined&&(item.allowedSeq<requested.seq?end<requested.seq:item.toolName==='cbim_task_inspect'));
      if(item.effects.some(effect=>['business-write','knowledge-write','external-write','command'].includes(effect))||['write','edit','bash'].includes(item.toolName))lastEffectSeq=Math.max(lastEffectSeq,item.allowedSeq,end);
    }
  }
  for(const id of help.input.attemptedToolCallIds){
    const item=facts.items.find(value=>value.toolCallId===id),denied=summary.events.find(event=>event.type==='tool.denied'&&event.data?.id===id);
    valid(item&&id!==help.toolCallId&&item.receipt&&['succeeded','failed','denied'].includes(item.status)&&(item.finishedSeq??denied?.seq??Infinity)<requested.seq);
  }
  const record=memberHelpRecordSchema.safeParse({...help,requestedSeq:requested.seq,finishedSeq:own.finishedSeq,lastEffectSeq});valid(record.success);return record.data;
}
