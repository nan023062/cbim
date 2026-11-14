/**
 * 作用定位：自定义领域 Loop 的非流式生成/向量请求，复用逐请求预算与冻结模型快照。
 * 设计原因：供应商用量可靠结算后才交付正文；两个角色共享停止屏障，任一未知或超限均不自动重试。
 * 职责边界：只接受已解析的连接，不允许正文覆盖模型、端点或凭据；生命周期由单轮引擎持有。
 */
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import type {ResolvedEngineModel} from '../../../engines';
import type {RequestBudgetPort,RequestBudgetTicket,RequestUnknownReason} from '../../../budget/rules/request-budget';
import {requestBudgetModelFor} from '../../../budget/rules/model-request-configuration';
import {requestBudgetCost,requestBudgetReservation,requestBudgetInputCapacity} from '../../../budget/rules/model-request-budget-rules';
import {modelEndpointSchema} from '../../../models';
import {modelJsonUsage} from './request-budget-usage';

/** 一轮独占；即使调用者捕获错误，也不能换角色继续发送。无预算策略时仍检查协议、容量与用量。 */
export class ModelJsonRequests {
  private blocked=false;
  private pending=false;
  private readonly llm:ResolvedEngineModel;
  constructor(llm:ResolvedEngineModel,private readonly budget:(role:string)=>Promise<RequestBudgetPort|undefined>,private readonly signal:AbortSignal){this.llm=structuredClone(llm)}
  /** 固定 OpenAI Chat JSON 协议；输出上限来自冻结模型，调用者只提供消息和工具声明。 */
  chat(messages:readonly unknown[],tools:readonly unknown[]=[]){
    return this.request('primary',{messages,stream:false,max_tokens:this.llm.profile.maxTokens,...(tools.length?{tools,parallel_tool_calls:false}:{})});
  }
  /** 不猜兼容供应商是否支持 dimensions 参数；按冻结维度验证完整返回后才构建索引。 */
  embed(input:readonly string[]){
    if(!input.length||input.length>64||input.some(text=>!text.length))throw Error('向量输入必须为 1–64 个非空片段');
    return this.request('embedding',{input,encoding_format:'float'});
  }
  private async request(role:'primary'|'embedding',payload:Record<string,unknown>):Promise<Record<string,any>>{
    if(this.blocked||this.pending)throw Error('本轮模型请求已停止或尚未结算，不能重复发送');this.pending=true;
    let ticket:RequestBudgetTicket|undefined,sent=false,settled=false,reason:RequestUnknownReason='transport_failed';
    try{
      this.signal.throwIfAborted();
      const operation=role==='primary'?this.llm:this.llm.modelRoles?.embedding;
      if(!operation||role==='primary'&&operation.profile.api!=='openai-completions'||role==='embedding'&&operation.profile.api!=='openai-embeddings')throw Error('领域引擎模型角色或协议不匹配');
      const expected=requestBudgetModelFor(this.llm.profile,role),port=await this.budget(role);
      if(port&&!isDeepStrictEqual(port.model,expected))throw Error('模型请求与原预算快照不一致');
      if(role==='embedding'&&!isDeepStrictEqual(operation.profile,this.llm.profile.modelRoles?.roles.embedding?.profile))throw Error('向量连接与公开冻结快照不一致');
      const maxOutputTokens=role==='primary'?this.llm.profile.maxTokens:0,reservation=requestBudgetReservation(expected,maxOutputTokens);
      const endpoint=modelEndpointSchema.parse(operation.profile.baseUrl).replace(/\/+$/,'')+(role==='primary'?'/chat/completions':'/embeddings');
      const body=JSON.stringify({...payload,model:operation.profile.model});if(Buffer.byteLength(body)>4*1024*1024)throw Error('领域模型请求正文超过 4 MiB');
      this.signal.throwIfAborted();
      ticket=await port?.reserve({requestHash:createHash('sha256').update(body).digest('hex'),maxOutputTokens});
      this.signal.throwIfAborted();await ticket?.issue();this.signal.throwIfAborted();
      const headers:Record<string,string>={'content-type':'application/json','accept':'application/json'};
      if(operation.profile.auth==='api-key')headers.authorization='Bearer '+operation.apiKey;
      // assertSend 和真正发网之间不让出执行权；任何发送后的错误都不能证明供应商未计费。
      ticket?.assertSend();sent=true;
      const response=await fetch(endpoint,{method:'POST',headers,body,signal:this.signal,redirect:'error'});
      if(!response.ok||!response.body||!response.headers.get('content-type')?.toLowerCase().startsWith('application/json')){await response.body?.cancel();throw Error('供应商未返回可核实的 JSON 响应')}
      reason='protocol_unverifiable';const parts:Uint8Array[]=[];let size=0;
      for await(const part of response.body){this.signal.throwIfAborted();size+=part.length;if(size>8*1024*1024){reason='response_limit';throw Error('领域模型响应超过 8 MiB')}parts.push(part)}
      const result=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(parts)));
      if(!result||typeof result!=='object'||Array.isArray(result)||result.error)throw Error('模型响应不是有效操作结果');
      reason='incomplete_usage';const usage=modelJsonUsage(result.usage,role==='primary'?'generation':'embedding');
      await ticket?.report(usage);settled=true;
      const cost=requestBudgetCost(expected,usage);
      if(usage.input+usage.cacheRead+usage.cacheWrite>requestBudgetInputCapacity(expected)||usage.output>maxOutputTokens||cost!==undefined&&reservation.estimatedCostUsd!==undefined&&cost>reservation.estimatedCostUsd)throw Error('供应商用量超过原预留，已保存实际用量并停止');
      this.signal.throwIfAborted();return result;
    }catch(error){
      this.blocked=true;
      if(ticket&&!settled){if(!sent)await ticket.notSent('cancelled_before_send');else await ticket.unknown(this.signal.aborted?'cancelled':reason)}
      // 发网错误不透传任意供应商正文或包含凭据的底层异常。
      if(sent&&!settled)throw Error('模型请求用量或交付无法确认，本轮已停止；请核实原请求，未自动重试');
      throw error;
    }finally{this.pending=false}
  }
}
