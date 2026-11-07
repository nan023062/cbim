/**
 * 作用定位：把原主运行的 canonical 调用与同一 Store 已提交命令只读关联，供桌面和主工具共用。
 * 设计原因：坏回包不代表提交失败；原参数哈希、领域指纹和提交事实分别核验，派发隐藏父版本只取原事务前态。
 * 职责边界：只读取已打开工作区，前后观察变化则保留未知；不执行、恢复、修日志、清除 unresolved 或签发业务验收。
 */
import {isDeepStrictEqual} from 'node:util';
import {fail} from '../../core/foundation/errors';
import {hash,json} from '../../core/foundation/serialization';
import type {KnowledgeWorkspace} from '../../core/knowledge/ports';
import type {RunSummary} from '../../core/brain/types';
import {checkedConversationAgentBinding} from '../../core/brain/conversation-binding';
import type {DispatchState,DispatchStore,DispatchCommandEvidence} from '../../core/tasks/dispatch-storage';
import type {DispatchScope} from '../../core/tasks/dispatch-scope';
import {goalInputRevision} from '../../core/tasks/scope-goal';
import {commandVerificationInputSchema,commandVerificationReportSchema,commandRecordSchema,isVerifiableMainToolName,commandReportToolName,type CommandVerificationInput,type CommandVerificationReport,type CommandRecord} from '../../core/tasks/command-verification';
import {projectCommandReceipt} from '../../core/tasks/command-verification-output';
import {executionToolFacts} from './execution-report-facts';
import {restoreMainCommand} from './main-command-request';

type Source=CommandVerificationReport['source'];
type ReadLog={summary?:RunSummary;source:Source;stamp:string;raw?:unknown;logPrefixHash?:string;throughSeq?:number};
/** 端口只读已有 canonical；不能为了查询创建运行管理器或打开工作区。 */
export interface CommandVerificationPorts {inspectMain(rootSessionId:string,runId:string):Promise<RunSummary>}

export class CommandVerificationService {
  constructor(private readonly owner:Pick<KnowledgeWorkspace,'entry'|'assert'>,private readonly store:Pick<DispatchStore,'read'|'commandEvidence'>,private readonly ports?:CommandVerificationPorts){}
  /** 原 run/call 必须明确；取消只结束本次读取，不修改任何原事实。 */
  async read(raw:unknown,signal?:AbortSignal):Promise<CommandVerificationReport>{
    const parsed=commandVerificationInputSchema.safeParse(raw);
    if(!parsed.success)fail('COMMAND_REPORT_INPUT','原命令查询身份无效');
    const input=parsed.data;
    const alive=()=>{signal?.throwIfAborted();this.owner.assert();if(input.workspaceId!==this.owner.entry.id)fail('COMMAND_REPORT_IDENTITY','原命令查询不属于当前工作区')};
    alive();
    const before=await this.state();alive();
    const first=await this.log(input,before);alive();
    const scope=this.scope(before,input);
    let command:CommandRecord={state:'unverifiable',reason:'source_unverified'},evidence:DispatchCommandEvidence|undefined,commandId:string|undefined,queryFailed=false;
    if(first.source.state==='verified'&&first.source.toolName){
      const name=first.source.toolName;
      if(!isVerifiableMainToolName(name))command={state:'not_applicable',reason:['cbim_goal_inspect','cbim_dispatch_inspect',commandReportToolName].includes(name)?'readonly_tool':'unsupported_family'};
      else if(!scope)command={state:'unverifiable',reason:'scope_unverified'};
      else if(!first.source.allowedSeq||first.source.outcome==='denied'||first.source.outcome==='not_authorized')command={state:'unverifiable',reason:'source_unverified'};
      else {
        const binding={workspaceId:input.workspaceId,rootSessionId:input.rootSessionId,scopeId:scope.scopeId,runId:input.runId};
        try {
          const restored=restoreMainCommand(name,binding,input.toolCallId,first.raw);commandId=restored.commandId;
          try{evidence=await this.store.commandEvidence(commandId)}catch{queryFailed=true}
          alive();
          if(queryFailed)command={state:'unverifiable',reason:'store_unavailable'};
          else if(!evidence)command={state:'absent',commandId};
          else {
            const graph=evidence.graph;
            const validPrestate=graph&&graph.identity.workspaceId===input.workspaceId&&graph.identity.rootSessionId===input.rootSessionId&&graph.before&&graph.before.cursor.workspaceId===input.workspaceId&&graph.before.cursor.rootSessionId===input.rootSessionId&&graph.afterCursor.workspaceId===input.workspaceId&&graph.afterCursor.rootSessionId===input.rootSessionId&&graph.afterCursor.streamId===graph.before.cursor.streamId&&graph.afterCursor.seq===graph.before.cursor.seq+1&&Number.isSafeInteger(graph.before.rootRevision)&&graph.before.rootRevision>0;
            if(name==='cbim_dispatch_task'&&(!validPrestate||graph?.cause!=='task.dispatched'))command={state:'unverifiable',reason:'missing_prestate'};
            else {
              const complete=restoreMainCommand(name,binding,input.toolCallId,first.raw,name==='cbim_dispatch_task'?graph!.before!.rootRevision:undefined);
              if(complete.fingerprint!==evidence.fingerprint)command={state:'unverifiable',reason:'fingerprint_mismatch'};
              else try {
                const result=projectCommandReceipt(name,evidence.receipt,{binding,input:complete.input,expectedCommandId:commandId});
                if('cursor' in result||'graphCursor' in result){
                  const cursor='cursor' in result?result.cursor:result.graphCursor;
                  if(!validPrestate||cursor.streamId!==graph!.afterCursor.streamId||cursor.seq!==graph!.afterCursor.seq)throw new Error('receipt cursor');
                }
                if(result.toolName==='cbim_dispatch_task'){
                  // 原assignment的command/message/task/from身份固定；旧协议可修订任务计划及assignee，不能拿今日版本否定旧派发。
                  const assignments=before?.outbox.filter(message=>message.kind==='assignment'&&message.commandId===commandId&&message.identity.workspaceId===input.workspaceId&&message.identity.rootSessionId===input.rootSessionId)??[];
                  const task=before?.graphs.find(value=>value.identity.workspaceId===input.workspaceId&&value.identity.rootSessionId===input.rootSessionId)?.tasks.find(task=>task.taskId===result.taskId);
                  const assignment=assignments[0];
                  if(assignments.length!==1||!assignment||assignment.kind!=='assignment'||assignment.messageId!==result.messageId||assignment.taskId!==result.taskId||assignment.resumeFrom||!task||task.scopeId!==scope.scopeId||assignment.from.agentId!==task.requester.agentId||assignment.from.agentInstanceId!==task.requester.agentInstanceId||assignment.from.agentSessionId!==task.requester.agentSessionId)throw new Error('assignment identity');
                }
                command=commandRecordSchema.parse({state:'committed',commandId,requestFingerprint:evidence.fingerprint,receiptHash:hash(json(evidence.receipt)),commit:evidence.commit,result});
              }catch{command={state:'unverifiable',reason:'receipt_invalid'}}
            }
          }
        }catch(error){alive();command={state:'unverifiable',reason:'unsupported_input'}}
      }
    }
    // 不仅比较命令键：原日志、周期/主身份和提交证据都必须保持同一观察。
    let afterEvidence:DispatchCommandEvidence|undefined;
    if(commandId&&!queryFailed){try{afterEvidence=await this.store.commandEvidence(commandId)}catch{queryFailed=true}}
    alive();
    // 反向闭合观察区间：Store前态→日志→命令→命令→日志→Store后态，不能在最后日志IO前提前宣布Store稳定。
    const last=await this.log(input,before);alive();
    const after=await this.state();alive();
    const changed=first.stamp!==last.stamp||this.stamp(before,input)!==this.stamp(after,input)||commandId!==undefined&&!queryFailed&&!isDeepStrictEqual(evidence,afterEvidence);
    if(changed)command={state:'unverifiable',reason:'changed_during_read'};
    else if(queryFailed||!before||!after)command={state:'unverifiable',reason:'store_unavailable'};
    const issues:CommandVerificationReport['issues']=[];
    if(changed)issues.push({code:'COMMAND_OBSERVATION_CHANGED',severity:'warning',message:'读取期间原日志或调度事实发生变化，本次不返回已提交结论。'});
    if(command.state==='absent')issues.push({code:'COMMAND_RECORD_ABSENT',severity:'warning',message:'仅表示原命令键下查无已确认记录，不证明未执行、回滚或可以重试。'});
    if(command.state==='unverifiable'&&!changed)issues.push({code:'COMMAND_UNVERIFIABLE',severity:'warning',message:'现有资料不足以核实原命令；保留原未知状态，不自动重放。'});
    const scopeView=scope?{scopeId:scope.scopeId,status:scope.status,...(scope.goal?{goalRevision:scope.goal.revision,inputRevision:goalInputRevision(scope.goal),...(scope.goal.plan?{planRevision:scope.goal.plan.revision}:{})}:{}),...(scope.outcome?{outcome:scope.outcome}:{})}:undefined;
    return commandVerificationReportSchema.parse({version:1,identity:input,checkedAt:new Date().toISOString(),basis:{key:hash(json({input,log:first.stamp,state:this.stamp(before,input),command,changed})),adapterVersion:1,...(first.logPrefixHash?{logPrefixHash:first.logPrefixHash,throughSeq:first.throughSeq}:{})},consistency:changed?'changed_during_read':'stable',source:first.source,command,...(scopeView?{scope:scopeView}:{}),issues,readOnly:true,acceptance:'not_evaluated'});
  }
  private async state():Promise<DispatchState|undefined>{try{return await this.store.read()}catch{return undefined}}
  private scope(state:DispatchState|undefined,input:CommandVerificationInput):DispatchScope|undefined{
    const scopes=state?.scopes?.filter(scope=>scope.workspaceId===input.workspaceId&&scope.rootSessionId===input.rootSessionId&&scope.runTracking?.mainRunIds.includes(input.runId));
    return scopes?.length===1?scopes[0]:undefined;
  }
  /** 只冻结本根会话的相关事实；其他工作区/主会话的无关提交不使本报告过期。 */
  private stamp(state:DispatchState|undefined,input:CommandVerificationInput){
    const graph=state?.graphs.find(graph=>graph.identity.rootSessionId===input.rootSessionId&&graph.identity.workspaceId===input.workspaceId),root=graph?.root.agent;
    return hash(json({available:!!state,scope:this.scope(state,input),root,graphCursor:graph?.cursor,member:state?.members.find(member=>member.agentInstanceId===root?.agentInstanceId),sessions:state?.sessions.filter(session=>session.agentInstanceId===root?.agentInstanceId&&session.rootSessionId===input.rootSessionId),assignments:state?.outbox.filter(message=>message.kind==='assignment'&&message.identity.workspaceId===input.workspaceId&&message.identity.rootSessionId===input.rootSessionId)}));
  }
  private async log(input:CommandVerificationInput,state:DispatchState|undefined):Promise<ReadLog>{
    if(!this.ports)return {source:{state:'unavailable'},stamp:'unavailable'};
    let summary:RunSummary;
    try{summary=await this.ports.inspectMain(input.rootSessionId,input.runId)}catch(error){
      const code=(error as {code?:string})?.code,state:Source['state']=code==='ENOENT'?'missing':code==='RUN_LOG_EMPTY'?'incomplete':['RUN_LOG_INVALID','CONVERSATION_IDENTITY'].includes(code??'')?'invalid':'unavailable';
      return {source:{state},stamp:state};
    }
    // 未核身份的资料不向公开 source 泄漏原工具、run 状态或参数摘要。
    try{
      if(summary.task.workspaceId!==input.workspaceId||summary.task.taskId!==input.rootSessionId||summary.runId!==input.runId||summary.task.mode!=='chat'||summary.task.agentId!=='cbim:main'||summary.memberBinding)throw new Error('identity');
      if(!summary.conversationBinding)return {source:{state:'legacy_unverified'},stamp:hash(json(summary))};
      const binding=checkedConversationAgentBinding(summary.conversationBinding,summary.task),graph=state?.graphs.find(graph=>graph.identity.workspaceId===input.workspaceId&&graph.identity.rootSessionId===input.rootSessionId),root=graph?.root.agent;
      const member=state?.members.find(member=>member.agentInstanceId===binding.agentInstanceId),session=state?.sessions.find(session=>session.agentSessionId===binding.agentSessionId);
      const mailbox=state?.sessions.find(session=>session.agentSessionId===root?.agentSessionId);
      // 图根的结果邮箱与普通对话通道是两个真实 session；分别核归属，不能按通道相同猜绑定。
      if(!root||!member||!session||!mailbox||root.agentId!==binding.agentId||root.agentInstanceId!==binding.agentInstanceId||member.workspaceId!==binding.workspaceId||member.teamId!==binding.teamId||member.agentId!==binding.agentId||member.mainRootSessionId!==binding.rootSessionId||!member.agentSessionIds.includes(binding.agentSessionId)||!member.agentSessionIds.includes(mailbox.agentSessionId)||session.workspaceId!==binding.workspaceId||session.teamId!==binding.teamId||session.agentId!==binding.agentId||session.agentInstanceId!==binding.agentInstanceId||session.rootSessionId!==binding.rootSessionId||session.purpose!=='conversation'||mailbox.workspaceId!==binding.workspaceId||mailbox.teamId!==binding.teamId||mailbox.agentId!==binding.agentId||mailbox.agentInstanceId!==binding.agentInstanceId||mailbox.rootSessionId!==binding.rootSessionId||mailbox.purpose==='conversation')throw new Error('binding');
      if(!summary.events.length||summary.events[0].type!=='run.started'||summary.events.filter(event=>event.type==='run.started').length!==1||summary.events.some((event,index)=>event.version!==1||event.seq!==index+1||event.workspaceId!==input.workspaceId||event.taskId!==input.rootSessionId||event.runId!==input.runId))throw new Error('events');
      const terminal=summary.events.filter(event=>event.type==='run.settled'||event.type==='run.interrupted');
      // 本报告可查询真实在途调用；终态只有一个。停止收尾可迟到写 stop_requested，不能在终态后新发工具。
      if(terminal.length>1||terminal.length===1&&summary.events.some(event=>event.seq>terminal[0].seq&&event.type!=='run.stop_requested'))throw new Error('terminal order');
      const started=summary.events[0].data;
      if(!isDeepStrictEqual(started.task,summary.task)||!isDeepStrictEqual(started.conversationBinding,summary.conversationBinding))throw new Error('started');
      const stamp=hash(json(summary)),logPrefixHash=hash(json(summary.events)),throughSeq=summary.events.at(-1)!.seq;
      if(summary.logIntegrity?.partialTail)return {source:{state:'incomplete'},stamp,logPrefixHash,throughSeq};
      if(!summary.logIntegrity)return {source:{state:'legacy_unverified'},stamp,logPrefixHash,throughSeq};
      const facts=executionToolFacts(summary,{binding:{workspaceId:input.workspaceId,taskId:input.rootSessionId,runId:input.runId}},{toolCallIdLimit:512}),item=facts.items.find(item=>item.toolCallId===input.toolCallId);
      if(facts.invalid)return {source:{state:'invalid'},stamp,logPrefixHash,throughSeq};
      if(!item?.proposedSeq)return {source:{state:'missing'},stamp,logPrefixHash,throughSeq};
      // 八项主写入口的真实分类固定为工作区 maintenance；链内自洽不等于此入口获得过正确授权。
      if(isVerifiableMainToolName(item.toolName)&&item.allowedSeq&&(item.effects.length!==1||item.effects[0]!=='maintenance'||item.scope.kind!=='workspace'||item.scope.workspaceId!==input.workspaceId))return {source:{state:'invalid'},stamp,logPrefixHash,throughSeq};
      const original=summary.events.find(event=>event.seq===item.proposedSeq)!.data.input;
      return {summary,raw:original,stamp,logPrefixHash,throughSeq,source:{state:'verified',toolName:item.toolName,runStatus:summary.status,proposedSeq:item.proposedSeq,...(item.allowedSeq?{allowedSeq:item.allowedSeq}:{}),...(item.finishedSeq?{finishedSeq:item.finishedSeq}:{}),inputHash:hash(JSON.stringify(original)??'undefined'),outcome:item.status}};
    }catch{return {source:{state:'invalid'},stamp:'invalid'}}
  }
}
