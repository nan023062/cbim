/**
 * 作用定位：execution 内的递归调用协调，拥有父子关联、深度限制、业务结果核验、用户意见的两阶段保存、反馈与后代取消。
 * 设计原因：直接复用 LoopRuntime；全局准入和根预算由既有执行装配提供，不自建循环或并发账本。
 * 职责边界：根工作区租约由宿主保留，子进程额度由 prepare 的真实准入控制；费用走根请求账本。
 */
import {z} from 'zod';
import type {Agent} from '../../agents/agent';
import {AgentCallExchange} from '../../agents/exchange';
import {questionResultSchema,questionResultForInput,type QuestionInput} from '../../tools/rules/questions';
import {zodToJsonSchema} from 'zod-to-json-schema';
import type {MemberRunLaunch} from '../rules/member-run';
import type {LoopRuntime} from '../rules/runtime/runtime';
import type {TaskSpec} from '../rules/types';
import type {RunSummary} from '../rules/types';
import type {AgentCallReference,AgentCallContext,AgentCallLimits,AgentToolContext,AgentToolsBinding} from '../../agents/contracts';
import {AgentConstraintError,agentCallToolName,agentListToolName,agentReplyToolName} from '../../agents/contracts';
import {toolOutcome} from '../../tools/rules/outcome';
import {jsonToolResult,type ToolResult} from '../../tools/rules/results';

export interface AgentSchedulerPorts {
  /** 仅展示现有 execution 准入服务的快照，不在协调器中另建额度。 */
  capacity?():{current:number;limit:number};
  /** 只读已登记能力目录；目录可见不自动授予执行权限。 */
  list?():Promise<unknown>;
  /** 仅根调用装配真实用户问题队列；子 Agent 不得直接使用人工评审入口。 */
  requestReview?(input:QuestionInput,signal:AbortSignal):Promise<unknown>;
  /** 必须取得真实子执行名额，冻结目标定义/权限/模型，失败不得开始运行。 */
  prepare(input:{agentId:string;message:string;business?:{moduleIds:string[];acceptance:string[];workflowSelections?:{moduleId:string;workflowId:string}[]};parent:AgentCallContext;signal:AbortSignal;reference:(taskId:string,runId:string)=>AgentCallReference;requestQuestion(input:unknown,signal:AbortSignal):Promise<unknown>}):Promise<{agent:Agent;task:TaskSpec;runtime:Pick<LoopRuntime,'start'|'close'>&Partial<Pick<LoopRuntime,'startMember'>>;launch?:MemberRunLaunch;verify?(summary:RunSummary,signal:AbortSignal):Promise<unknown>;beforeRun?(runId:string):Promise<void>;release():void|Promise<void>}>;
}
const callInput=z.object({agentId:z.string().min(1).max(512),message:z.string().trim().min(1).max(100000),business:z.object({moduleIds:z.array(z.string().min(1)).min(1).max(50),acceptance:z.array(z.string().min(1)).max(100),workflowSelections:z.array(z.object({moduleId:z.string().min(1),workflowId:z.string().min(1)}).strict()).max(50).optional()}).strict().optional()}).strict();
const replyInput=z.object({callId:z.string().min(1),questionId:z.string().min(1),result:questionResultSchema}).strict();
function errorResult(code:string,message:string,detail:Record<string,unknown>={}):ToolResult{return {...jsonToolResult(agentCallToolName,{error:{code,message,...detail}}),details:{outcome:toolOutcome(detail.started===false?'rejected':'unknown')},isError:true}}
/** 单根运行共享调度器；调用键含父运行，避免不同 Agent 的原生工具 ID 碰撞。 */
export class AgentCallScheduler {
  private readonly attempts=new Map<string,{input:string;result:Promise<ToolResult>}>();
  private readonly activeCalls=new Map<string,{controller:AbortController;done:Promise<ToolResult>;exchange:AgentCallExchange}>();
  /** 退出未确认仍保留真实占用；后续只重试排空，不重放工作。 */
  private readonly stranded=new Map<string,Awaited<ReturnType<AgentSchedulerPorts['prepare']>>>();
  private readonly replyHistory=new Map<string,AgentCallExchange>();
  /** 仅保存本父调用的只读核验闭包；不重启子运行，不接受模型传入证明。 */
  private readonly checks=new Map<string,(signal:AbortSignal)=>Promise<unknown>>();
  /** 原交付通过时的证据用于固定人工意见对象；当前字节每次另查，不能覆盖原证明。 */
  private readonly reviewProofs=new Map<string,unknown>();
  /** 等待用户的工具同样归根生命周期；停止和 close 必须取消其队列并等待原 Promise 收尾。 */
  private readonly reviewControllers=new Map<string,AbortController>();
  private readonly reviews=new Map<string,{callId:string;result:Promise<ToolResult>}>();
  /** 负面人工决定不授权返工；同一运行禁止另起子调用，须等待新的用户指令。 */
  private readonly humanBlocked=new Set<string>();
  private closed=false;
  constructor(private readonly limits:AgentCallLimits,private readonly ports:AgentSchedulerPorts){
    if(!Number.isSafeInteger(limits.maxDepth)||limits.maxDepth<0)throw Error('Agent 调用限额无效');
    this.limits=Object.freeze({...limits});
  }
  /** 每个循环取得自己的工具绑定；停止只取消该调用者的直属调用，AbortSignal 继续向后代传播。 */
  bind(context:AgentToolContext,depth=0):AgentToolsBinding {
    let pending=0;
    const prefix=context.runId+':';
    return {allowsWhileWaiting:(name)=>{const active=[...this.activeCalls].filter(([key])=>key.startsWith(prefix));return active.length>0&&active.every(([,call])=>call.exchange.waiting())&&[agentReplyToolName,agentListToolName,'cbim_ask_user_question'].includes(name)},active:()=>pending>0||[...this.stranded.keys()].some(key=>key.startsWith(prefix)),stop:async()=>{for(const [key,controller] of this.reviewControllers)if(key.startsWith(prefix))controller.abort();await Promise.allSettled([...this.reviews].filter(([key])=>key.startsWith(prefix)).map(([,review])=>review.result));const active=[...this.activeCalls].filter(([key])=>key.startsWith(prefix)).map(([,value])=>value);for(const item of active)item.controller.abort();await Promise.allSettled(active.map(item=>item.done));await this.drain(prefix)},capability:{id:'agent-call',instructions:['明确业务模块的调用须提供 business.moduleIds 与 acceptance；宿主冻结该模块 Workflow。业务返回的 verification 只证明当时证据与文件一致，不替代人工验收；交付前用 cbim_agent_result_check 按原 callId 复核当前字节，失败不能报告完成。','调用其他 Agent 与普通工具相同；结果和提问只返回直接调用方。仅可调用本轮实际配置能力。深度、并发或预算错误不是成功，不重复相同调用或绕过权限。'],tools:{
      list:async()=>[...(depth===0&&this.ports.requestReview?[{name:'cbim_agent_result_review',description:'请用户评价本次子 Agent 交付。保存意见后再明确选择是否继续；文件变化不能接受，意见不授权自动返工。',inputSchema:{type:'object',properties:{callId:{type:'string'}},required:['callId'],additionalProperties:false}}]:[]),{name:'cbim_agent_result_check',description:'按当前调用者原 callId 重新核验子 Agent 的交付证据及实际文件；不重启执行，不代替用户验收。',inputSchema:{type:'object',properties:{callId:{type:'string'}},required:['callId'],additionalProperties:false}},{name:agentReplyToolName,description:'回答原 Agent 调用返回的求助，等待原子运行继续；不创建新任务。result 必须对应原问题。',inputSchema:zodToJsonSchema(replyInput) as Record<string,unknown>},...(this.ports.list?[{name:agentListToolName,description:'读取已登记可调用 Agent 的真实 ID、名称、模型与可用性。',inputSchema:{type:'object',properties:{},additionalProperties:false}}]:[]),{name:agentCallToolName,description:'调用一个已配置 Agent，等待其真实执行结果；执行 Agent 也可使用此工具。',inputSchema:zodToJsonSchema(callInput) as Record<string,unknown>}],
      call:async(name,args,signal,id)=>{
        if(name==='cbim_agent_result_review'){
          const parsed=z.object({callId:z.string().min(1)}).strict().safeParse(args);
          if(!parsed.success||!id)return errorResult('AGENT_REVIEW_INPUT','需要原 callId');
          if(depth!==0||!this.ports.requestReview)return errorResult('AGENT_REVIEW_UNAVAILABLE','只有主 Agent 可以请求真实用户评价');
          const key=prefix+id,existing=this.reviews.get(key);
          if(existing)return existing.callId===parsed.data.callId?existing.result:errorResult('AGENT_REVIEW_CONFLICT','同一评审调用不能更换交付对象');
          const controller=new AbortController();this.reviewControllers.set(key,controller);
          const result=this.review(context,parsed.data.callId,id,AbortSignal.any([signal,controller.signal])).finally(()=>this.reviewControllers.delete(key));
          this.reviews.set(key,{callId:parsed.data.callId,result});return result;
        }
        if(name==='cbim_agent_result_check'){
          const parsed=z.object({callId:z.string().min(1)}).strict().safeParse(args);
          if(!parsed.success||!id)return errorResult('AGENT_RESULT_INPUT','需要原 callId');
          try{signal.throwIfAborted();if(this.closed)throw Error('调用已关闭');context.assertExclusive(id);const check=this.checks.get(prefix+parsed.data.callId);if(!check)return errorResult('AGENT_RESULT_UNAVAILABLE','本调用者没有可核验的已完成业务调用');return jsonToolResult(name,await check(signal))}catch(error){return errorResult((error as {code?:string}).code??'AGENT_RESULT_FAILED',String(error))}
        }
        if(name===agentReplyToolName){
          if(!id||signal.aborted||this.closed)return errorResult('AGENT_CALL_CANCELLED','答复调用已停止');
          const parsed=replyInput.safeParse(args);if(!parsed.success)return errorResult('AGENT_REPLY_INPUT','答复必须包含原 callId、questionId 和严格答案');
          try{context.assertExclusive(id);const entry=this.activeCalls.get(prefix+parsed.data.callId);
            const cache=this.replyHistory.get(prefix+parsed.data.callId);const exchange=entry?.exchange??cache;
            if(!exchange)return errorResult('AGENT_CALL_IDENTITY','原调用不属于当前调用者或已丢失，不重建执行');
            const abort=()=>entry?.controller.abort(signal.reason);signal.addEventListener('abort',abort,{once:true});try{return await exchange.reply(parsed.data.questionId,parsed.data.result)}finally{signal.removeEventListener('abort',abort)}
          }catch(error){return errorResult((error as {code?:string}).code??'AGENT_REPLY_FAILED',error instanceof Error?error.message:String(error))}
        }
        if(name===agentListToolName&&this.ports.list){if(Object.keys(args).length)return errorResult('AGENT_LIST_INPUT','Agent 目录不接受身份或权限参数');signal.throwIfAborted();return jsonToolResult(agentListToolName,await this.ports.list())}
        if(name!==agentCallToolName||!id)return errorResult('AGENT_CALL_IDENTITY','缺少已授权工具调用身份');
        const parsed=callInput.safeParse(args);if(!parsed.success)return errorResult('AGENT_CALL_INPUT','需要有效 agentId 和 message，不能传入调用方或权限字段');
        const key=prefix+id,input=JSON.stringify(parsed.data),existing=this.attempts.get(key);
        if(existing)return existing.input===input?existing.result:errorResult('AGENT_CALL_CONFLICT','原调用身份已用于不同指令');
        if(this.humanBlocked.has(context.runId))return errorResult('AGENT_HUMAN_DECISION_REQUIRED','负面意见已保存；继续仅处理意见，不授权新子运行。请等待新的用户执行指令',{started:false});
        if(this.closed||signal.aborted)return errorResult('AGENT_CALL_CANCELLED','调用已停止',{started:false});
        if(depth+1>this.limits.maxDepth)return errorResult('AGENT_DEPTH_LIMIT','递归深度超过限制',{limit:this.limits.maxDepth,current:depth,requested:depth+1,unit:'depth',started:false});
        try{context.assertExclusive(id)}catch(error){return errorResult('AGENT_CALL_BUSY',error instanceof Error?error.message:String(error),{started:false})}
        // 执行额度仅由 prepare 使用全局准入服务领取；这里仅跟踪父工具批次。
        pending++;
        const controller=new AbortController(),abort=()=>controller.abort(signal.reason);signal.addEventListener('abort',abort,{once:true});
        let reference:AgentCallReference|undefined;
        const exchange=new AgentCallExchange(async(phase,questionId,questions,answer)=>{
          if(!reference)throw Error('子运行身份尚未登记');
          await context.emit({type:'tool.updated',data:{id,name:agentCallToolName,agentCall:reference,agentCallState:phase,questionId,...(questions?{questions}:{}),...(answer?{answer}:{})}});
          return jsonToolResult(agentCallToolName,{status:'waiting',callId:id,questionId,questions,agentCall:reference,nextStep:'用 cbim_agent_reply 回答原问题，继续此调用；不要重新调用 Agent'});
        });
        // 原循环关闭后先撤销活动占用，再交回父引擎，避免父收尾看到已结束的子调用。
        const clearActive=()=>{signal.removeEventListener('abort',abort);pending--;this.activeCalls.delete(key)};
        const done=this.execute(context,depth,id,parsed.data,controller.signal,exchange,ref=>{reference=ref}).then(async result=>{
          if(exchange.yielded&&reference)await context.emit({type:'tool.updated',data:{id,name:agentCallToolName,agentCall:reference,agentCallState:result.isError?'failed':'completed',result,isError:result.isError===true}});
          return result;
        }).then(result=>{clearActive();exchange.finish(result);return result},error=>{clearActive();exchange.fail(error);throw error});
        void done.catch(()=>{});
        const result=exchange.wait();this.attempts.set(key,{input,result});this.replyHistory.set(key,exchange);this.activeCalls.set(key,{controller,done,exchange});return result;
      },
    }}};
  }
  private async execute(context:AgentToolContext,depth:number,id:string,input:z.infer<typeof callInput>,signal:AbortSignal,exchange:AgentCallExchange,onReference:(ref:AgentCallReference)=>void):Promise<ToolResult>{
    let prepared:Awaited<ReturnType<AgentSchedulerPorts['prepare']>>|undefined,reference:AgentCallReference|undefined;
    const ref=(taskId:string,runId:string):AgentCallReference=>({version:1,workspaceId:context.task.workspaceId,callerTaskId:context.task.taskId,callerRunId:context.runId,toolCallId:id,taskId,runId});
    try{
      signal.throwIfAborted();prepared=await this.ports.prepare({...input,parent:{task:context.task,runId:context.runId,depth},signal,reference:ref,requestQuestion:(input,questionSignal)=>exchange.ask(input,AbortSignal.any([signal,questionSignal]))});signal.throwIfAborted();
      const control={signal,beforeRun:async({runId}:{runId:string})=>{reference=ref(prepared!.agent.conversation.taskId,runId);onReference(reference);await context.emit({type:'tool.updated',data:{id,name:agentCallToolName,agentCall:reference,limits:{depth:depth+1,maxDepth:this.limits.maxDepth,...this.capacity()}}});await prepared!.beforeRun?.(runId)}};
      const run=prepared.launch?await prepared.runtime.startMember!(prepared.task,input.message,prepared.launch,control):await prepared.runtime.start(prepared.task,input.message,undefined,undefined,control);
      const summary=await run.done;
      let verification:unknown;
      if(prepared.verify&&summary.status==='completed'&&!summary.unresolvedTools.length){const verify=prepared.verify;this.checks.set(context.runId+':'+id,signal=>verify(summary,signal));verification=await verify(summary,signal);this.reviewProofs.set(context.runId+':'+id,structuredClone(verification))}
      const output={agentCall:reference,status:summary.status,summary:this.message(summary),...(verification?{verification}:{}),unresolvedTools:summary.unresolvedTools};
      return {...jsonToolResult(agentCallToolName,output),...(summary.status!=='completed'||summary.unresolvedTools.length?{isError:true}:{})};
    }catch(error){const failure=error as {code?:string;message?:string};return errorResult(failure.code??(signal.aborted?'AGENT_CALL_CANCELLED':'AGENT_CALL_FAILED'),failure.message??String(error),{started:!!reference,...(error instanceof AgentConstraintError?error.constraint:{}),...(reference?{agentCall:reference}: {})})}
    finally{if(prepared){try{await prepared.runtime.close();await prepared.release()}catch(error){this.stranded.set(context.runId+':'+id,prepared);throw error}}}
  }

  /** 人工评价是原工具的两阶段等待：意见先可靠记入日志，用户明确继续才返回模型；不派发子任务。 */
  private async review(context:AgentToolContext,callId:string,id:string,signal:AbortSignal):Promise<ToolResult>{
    const key=context.runId+':'+callId,check=this.checks.get(key),original=this.reviewProofs.get(key);
    try{
      signal.throwIfAborted();context.assertExclusive(id);
      if(this.closed||!check||!original)return errorResult('AGENT_REVIEW_UNAVAILABLE','没有本调用者原始已验证交付');
      let current:unknown,verified=false;
      try{current=await check(signal);verified=true}catch(error){signal.throwIfAborted();current={state:'unverified',code:(error as {code?:string}).code??'AGENT_RESULT_FAILED'}}
      const allowedDecisions=verified?['accept','reject','request_evidence']:['reject','request_evidence'];
      const labels:Record<string,string>={accept:'接受此成果',reject:'不接受此成果',request_evidence:'要求补充证据'};
      const question:QuestionInput={questions:[{question:verified?'如何评价此调用的成果？文件当前复核通过，仍需你的业务判断。':'此调用的文件已变化或无法复核，不能接受旧证据。请记录你的意见。',options:allowedDecisions.map(decision=>({label:labels[decision]}))}]};
      const answer=questionResultForInput(question).parse(await this.ports.requestReview!(question,signal));
      signal.throwIfAborted();if('cancelled' in answer)return jsonToolResult('cbim_agent_result_review',{cancelled:true});
      const decision=allowedDecisions.find(value=>labels[value]===answer.answers[0].answer);
      if(!decision)return errorResult('AGENT_REVIEW_INPUT','请选择可用的人工决定；其它输入不等于接受授权');
      // 用户阅读期间仍可能发生外部修改；接受前再核原文件，不能沿用展示时的快照。
      if(decision==='accept')current=await check(signal);
      signal.throwIfAborted();context.assertExclusive(id);
      const record={version:1,callerTaskId:context.task.taskId,callerRunId:context.runId,callId,reviewToolCallId:id,original,current,allowedDecisions,decision,answer:answer.answers[0],recordedAt:new Date().toISOString()};
      await context.emit({type:'tool.updated',data:{id,name:'cbim_agent_result_review',humanDecision:record,phase:'decision_saved'}});
      if(decision!=='accept')this.humanBlocked.add(context.runId);
      const continuation:QuestionInput={questions:[{question:'意见已保存。是否让主 Agent 继续处理这条意见？继续不授权自动返工或重放原调用。',options:[{label:'继续处理意见'},{label:'只保存意见'}]}]};
      const next=questionResultForInput(continuation).parse(await this.ports.requestReview!(continuation,signal));
      signal.throwIfAborted();
      const continued=!('cancelled' in next)&&next.answers[0].answer==='继续处理意见';
      // 保存意见与交回模型之间可能隔很久；继续不能消费已经过期的接受。
      // 原 humanDecision 是历史事实，复核失败只记录拒绝释放，不改写旧意见或重放子运行。
      if(continued&&decision==='accept'){
        try{await check(signal);signal.throwIfAborted()}
        catch(error){
          this.humanBlocked.add(context.runId);
          if(!signal.aborted)await context.emit({type:'tool.updated',data:{id,name:'cbim_agent_result_review',phase:'decision_released',continued:false,reason:'verification_failed'}});
          throw error;
        }
      }
      if(!continued)this.humanBlocked.add(context.runId);
      await context.emit({type:'tool.updated',data:{id,name:'cbim_agent_result_review',phase:'decision_released',continued}});
      return jsonToolResult('cbim_agent_result_review',{record,continued,executionAuthorized:false});
    }catch(error){return errorResult((error as {code?:string}).code??(signal.aborted?'AGENT_CALL_CANCELLED':'AGENT_REVIEW_FAILED'),error instanceof Error?error.message:String(error))}
  }
  private capacity(){const usage=this.ports.capacity?.();return usage?{concurrent:usage.current,maxConcurrent:usage.limit}:{}}
  private message(run:RunSummary):string {
    const messages=run.events.filter(event=>event.type==='message').map(event=>typeof event.data.text==='string'?event.data.text:typeof event.data.content==='string'?event.data.content:'').filter(Boolean);
    return messages.join('\n\n').slice(-100000)||'执行已结束，详细过程见调用记录；没有可提取的公开文字回复。';
  }
  private async drain(prefix=''){for(const [key,value] of this.stranded){if(!key.startsWith(prefix))continue;await value.runtime.close();await value.release();this.stranded.delete(key)}}
  async close(){this.closed=true;for(const controller of this.reviewControllers.values())controller.abort();await Promise.allSettled([...this.reviews.values()].map(review=>review.result));const active=[...this.activeCalls.values()];for(const item of active)item.controller.abort();await Promise.allSettled(active.map(item=>item.done));await this.drain()}
}
