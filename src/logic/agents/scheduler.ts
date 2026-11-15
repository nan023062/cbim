/**
 * 作用定位：独立 Agent 调度系统，拥有调用关系、递归准入、结果回传和后代停止。
 * 设计原因：调度通过窄端口创建对象和循环，不依赖主调度、Application 或具体引擎。
 * 职责边界：根工作区租约由宿主保留，子进程额度由 prepare 的真实准入控制；费用走根请求账本。
 */
import {z} from 'zod';
import {Agent} from './agent';
import {AgentExecutionLoop} from './loop';
import type {RunSummary} from '../execution/rules/types';
import type {AgentCallReference,AgentCallContext,AgentCallLimits,AgentToolContext,AgentToolsBinding} from './contracts';
import {AgentConstraintError} from './contracts';
import {jsonToolResult,type ToolResult} from '../tools/rules/results';

export interface AgentSchedulerPorts {
  /** 只读已登记能力目录；目录可见不自动授予执行权限。 */
  list?():Promise<unknown>;
  /** 必须取得真实子执行名额，冻结目标定义/权限/模型，失败不得开始运行。 */
  prepare(input:{agentId:string;message:string;parent:AgentCallContext;signal:AbortSignal;reference:(taskId:string,runId:string)=>AgentCallReference}):Promise<{agent:Agent;loop:AgentExecutionLoop;release():void}>;
}
const callInput=z.object({agentId:z.string().min(1).max(512),message:z.string().trim().min(1).max(100000)}).strict();
export const agentCallToolName='cbim_agent_call';
export const agentListToolName='cbim_agent_list';
function errorResult(code:string,message:string,detail:Record<string,unknown>={}):ToolResult{return {...jsonToolResult(agentCallToolName,{error:{code,message,...detail}}),isError:true}}
/** 单根运行共享调度器；调用键含父运行，避免不同 Agent 的原生工具 ID 碰撞。 */
export class AgentCallScheduler {
  private readonly attempts=new Map<string,{input:string;result:Promise<ToolResult>}>();
  private readonly activeCalls=new Map<string,{controller:AbortController;done:Promise<ToolResult>}>();
  /** 退出未确认仍保留真实占用；后续只重试排空，不重放工作。 */
  private readonly stranded=new Map<string,Awaited<ReturnType<AgentSchedulerPorts['prepare']>>>();
  private closed=false;
  private reserved=0;
  constructor(private readonly limits:AgentCallLimits,private readonly ports:AgentSchedulerPorts){
    if(!Number.isSafeInteger(limits.maxDepth)||limits.maxDepth<0||!Number.isSafeInteger(limits.maxConcurrent)||limits.maxConcurrent<1)throw Error('Agent 调用限额无效');
    this.limits=Object.freeze({...limits});
  }
  /** 每个循环取得自己的工具绑定；停止只取消该调用者的直属调用，AbortSignal 继续向后代传播。 */
  bind(context:AgentToolContext,depth=0):AgentToolsBinding {
    let pending=0;
    const prefix=context.runId+':';
    return {active:()=>pending>0||[...this.stranded.keys()].some(key=>key.startsWith(prefix)),stop:async()=>{const active=[...this.activeCalls].filter(([key])=>key.startsWith(prefix)).map(([,value])=>value);for(const item of active)item.controller.abort();await Promise.allSettled(active.map(item=>item.done));await this.drain(prefix)},capability:{id:'agent-call',instructions:['调用其他 Agent 与普通工具相同；结果和提问只返回直接调用方。仅可调用本轮实际配置能力。深度、并发或预算错误不是成功，不重复相同调用或绕过权限。'],tools:{
      list:async()=>[...(this.ports.list?[{name:agentListToolName,description:'读取已登记可调用 Agent 的真实 ID、名称、模型与可用性。',inputSchema:{type:'object',properties:{},additionalProperties:false}}]:[]),{name:agentCallToolName,description:'调用一个已配置 Agent，等待其真实执行结果；执行 Agent 也可使用此工具。',inputSchema:{type:'object',properties:{agentId:{type:'string',description:'已登记岗位的 memberId'},message:{type:'string',description:'给该 Agent 的指令和必要上下文'}},required:['agentId','message'],additionalProperties:false}}],
      call:async(name,args,signal,id)=>{
        if(name===agentListToolName&&this.ports.list){if(Object.keys(args).length)return errorResult('AGENT_LIST_INPUT','Agent 目录不接受身份或权限参数');signal.throwIfAborted();return jsonToolResult(agentListToolName,await this.ports.list())}
        if(name!==agentCallToolName||!id)return errorResult('AGENT_CALL_IDENTITY','缺少已授权工具调用身份');
        const parsed=callInput.safeParse(args);if(!parsed.success)return errorResult('AGENT_CALL_INPUT','需要有效 agentId 和 message，不能传入调用方或权限字段');
        const key=prefix+id,input=JSON.stringify(parsed.data),existing=this.attempts.get(key);
        if(existing)return existing.input===input?existing.result:errorResult('AGENT_CALL_CONFLICT','原调用身份已用于不同指令');
        if(this.closed||signal.aborted)return errorResult('AGENT_CALL_CANCELLED','调用已停止',{started:false});
        if(depth+1>this.limits.maxDepth)return errorResult('AGENT_DEPTH_LIMIT','递归深度超过限制',{limit:this.limits.maxDepth,current:depth,requested:depth+1,unit:'depth',started:false});
        if(this.reserved>=this.limits.maxConcurrent)return errorResult('AGENT_CONCURRENCY_LIMIT','Agent 执行并发已达上限',{limit:this.limits.maxConcurrent,current:this.reserved,requested:1,unit:'process',started:false});
        try{context.assertExclusive(id)}catch(error){return errorResult('AGENT_CALL_BUSY',error instanceof Error?error.message:String(error),{started:false})}
        // 同步预留早于任何 await，父工具批次在整个子运行中封住新操作。
        this.reserved++;pending++;
        const controller=new AbortController(),abort=()=>controller.abort(signal.reason);signal.addEventListener('abort',abort,{once:true});
        const result=this.execute(context,depth,id,parsed.data,controller.signal).finally(()=>{signal.removeEventListener('abort',abort);this.reserved--;pending--;this.activeCalls.delete(key)});
        this.attempts.set(key,{input,result});this.activeCalls.set(key,{controller,done:result});return result;
      },
    }}};
  }
  private async execute(context:AgentToolContext,depth:number,id:string,input:z.infer<typeof callInput>,signal:AbortSignal):Promise<ToolResult>{
    let prepared:Awaited<ReturnType<AgentSchedulerPorts['prepare']>>|undefined,reference:AgentCallReference|undefined;
    const ref=(taskId:string,runId:string):AgentCallReference=>({version:1,workspaceId:context.task.workspaceId,callerTaskId:context.task.taskId,callerRunId:context.runId,toolCallId:id,taskId,runId});
    try{
      signal.throwIfAborted();prepared=await this.ports.prepare({...input,parent:{task:context.task,runId:context.runId,depth},signal,reference:ref});signal.throwIfAborted();
      const summary=await prepared.loop.run(input.message,signal,async runId=>{reference=ref(prepared!.agent.conversation.taskId,runId);await context.emit({type:'tool.updated',data:{id,name:agentCallToolName,agentCall:reference,limits:{depth:depth+1,maxDepth:this.limits.maxDepth,concurrent:this.reserved,maxConcurrent:this.limits.maxConcurrent}}})});
      const output={agentCall:reference,status:summary.status,summary:this.message(summary),unresolvedTools:summary.unresolvedTools};
      return {...jsonToolResult(agentCallToolName,output),...(summary.status!=='completed'||summary.unresolvedTools.length?{isError:true}:{})};
    }catch(error){const failure=error as {code?:string;message?:string};return errorResult(failure.code??(signal.aborted?'AGENT_CALL_CANCELLED':'AGENT_CALL_FAILED'),failure.message??String(error),{started:!!reference,...(error instanceof AgentConstraintError?error.constraint:{}),...(reference?{agentCall:reference}: {})})}
    finally{if(prepared){try{await prepared.loop.close();prepared.release()}catch(error){this.stranded.set(context.runId+':'+id,prepared);throw error}}}
  }
  private message(run:RunSummary):string {
    const messages=run.events.filter(event=>event.type==='message').map(event=>typeof event.data.text==='string'?event.data.text:typeof event.data.content==='string'?event.data.content:'').filter(Boolean);
    return messages.join('\n\n').slice(-100000)||'执行已结束，详细过程见调用记录；没有可提取的公开文字回复。';
  }
  private async drain(prefix=''){for(const [key,value] of this.stranded){if(!key.startsWith(prefix))continue;await value.loop.close();value.release();this.stranded.delete(key)}}
  async close(){this.closed=true;const active=[...this.activeCalls.values()];for(const item of active)item.controller.abort();await Promise.allSettled(active.map(item=>item.done));await this.drain()}
}
