/**
 * 目录归属：backend/engines/transport；模型请求代理与用量解析。
 * 作用定位：每运行创建只接受随机令牌的本机供应商代理，逐 HTTP 尝试预留并结算预算。
 * 设计原因：真实供应商凭据仅在父进程，路径/模型/输出上限固定；终态先落盘再交付，断流与退出不靠猜测释放额度。
 * 职责边界：网络 IO 不在 Store 事务内；流式提前调用工具须等待 assertSettled，close 取消实际请求并等待结算。
 */
import http from 'node:http';
import {randomBytes,timingSafeEqual,createHash} from 'node:crypto';
import type {ResolvedLlm} from '../../../logic/models';
import type {RequestBudgetPort,RequestBudgetTicket,RequestUnknownReason} from '../../core/models/request-budget';
import {RequestBudgetUsageStream} from './request-budget-usage';
import {requestBudgetReservation,requestBudgetCost} from '../../core/budget/model-request-budget-rules';
import {Fault} from '../../core/foundation/errors';
import {workspaceMemberModelHash} from '../../core/team/workspace-member-rules';

/** 所有引擎共用的实际 API 路径；不接受子进程指定目标或 HTTP 重定向。 */
export function requestBudgetEndpoint(llm:ResolvedLlm):string{
  const base=new URL(llm.profile.baseUrl);if(base.username||base.password||base.search||base.hash||!(base.protocol==='https:'||base.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(base.hostname)))throw Error('模型请求地址不受支持');
  const suffix=llm.profile.api==='openai-completions'?'/chat/completions':llm.profile.api==='openai-responses'?'/responses':base.pathname.replace(/\/+$/,'').endsWith('/v1')?'/messages?beta=true':'/v1/messages?beta=true';
  return base.href.replace(/\/+$/,'')+suffix;
}
/** 返回值只给当前引擎；任何失败一旦阻断，不能通过新调用 ID 或再次握手解除。 */
export async function openRequestBudgetTransport(llm:ResolvedLlm,port:RequestBudgetPort,options:{anthropicClient?:boolean}={}){
  llm=structuredClone(llm);const model=structuredClone(port.model);
  if(model.configurationHash!==workspaceMemberModelHash(llm.profile))throw Error('模型传输与原预算快照不一致，未启动门禁');
  if(llm.apiKey.includes('sk-ant-oat'))throw Error('逐请求预算当前仅支持配置的 API key，不支持 OAuth 凭据');
  const endpoint=requestBudgetEndpoint(llm),token=randomBytes(32).toString('hex');
  let closing=false,ready=options.anthropicClient===true,blocked:string|undefined,closingPromise:Promise<void>|undefined;
  const active=new Map<Promise<void>,AbortController>();
  const block=(message:string)=>{blocked??=message};
  const failure=(res:http.ServerResponse)=>{if(res.destroyed)return;if(res.headersSent)res.destroy();else res.writeHead(409,{'content-type':'application/json'}).end(JSON.stringify({error:{message:blocked??'模型请求已停止',type:'cbim_budget_denied'}}))};
  async function handle(req:http.IncomingMessage,res:http.ServerResponse,controller:AbortController){
    let ticket:RequestBudgetTicket|undefined,issued=false,sent=false,terminal=false,unknownReason:RequestUnknownReason='transport_failed';
    const abort=()=>{if(!res.writableEnded)controller.abort()};res.on('close',abort);req.on('aborted',abort);
    try{
      const auth=Buffer.from(req.headers.authorization??(options.anthropicClient&&typeof req.headers['x-api-key']==='string'?'Bearer '+req.headers['x-api-key']:'')),expected=Buffer.from('Bearer '+token);
      if(req.headers.origin||auth.length!==expected.length||!timingSafeEqual(auth,expected)){res.writeHead(403).end();return}
      if(req.method==='POST'&&req.url==='/ready'&&!ready&&!closing){ready=true;res.writeHead(200).end('{}');return}
      if(req.method!=='POST'||!(req.url==='/request'||options.anthropicClient&&req.url?.split('?')[0]==='/v1/messages')){res.writeHead(404).end();return}
      if(!ready||closing||blocked){failure(res);return}
      const parts:Buffer[]=[];let size=0;for await(const raw of req){const part=Buffer.from(raw);size+=part.length;if(size>32*1024*1024)throw Error('模型请求正文超过受管上限');parts.push(part)}
      const body=Buffer.concat(parts),value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(body));
      const limits=[value.max_tokens,value.max_completion_tokens,value.max_output_tokens].filter(v=>v!==undefined);
      const expectedKey=llm.profile.api==='openai-responses'?'max_output_tokens':llm.profile.api==='anthropic-messages'?'max_tokens':undefined;
      if(!value||value.model!==model.modelId||value.stream!==true||value.background===true||value.n!==undefined&&value.n!==1||limits.length!==1||expectedKey&&value[expectedKey]===undefined)throw Error('模型请求的协议、模型或输出上限与冻结配置不符');
      const maxOutputTokens=limits[0],reservation=requestBudgetReservation(model,maxOutputTokens);
      controller.signal.throwIfAborted();if(closing||blocked)throw Error('原运行已停止模型请求');
      ticket=await port.reserve({requestHash:createHash('sha256').update(body).digest('hex'),maxOutputTokens});
      controller.signal.throwIfAborted();if(closing||blocked)throw Error('原运行已停止模型请求');
      await ticket.issue();issued=true;
      controller.signal.throwIfAborted();if(closing||blocked)throw Error('原运行已停止模型请求');
      const headers:Record<string,string>={'content-type':'application/json','accept':'text/event-stream'};
      for(const key of ['anthropic-version','anthropic-beta']){const v=req.headers[key];if(typeof v==='string')headers[key]=v}
      if(llm.profile.auth==='api-key'){if(llm.profile.api==='anthropic-messages')headers['x-api-key']=llm.apiKey;else headers.authorization='Bearer '+llm.apiKey}
      // 设置 sent 与 fetch 之间没有 await；一旦调用传输，错误不再证明请求免费或未到达供应商。
      ticket.assertSend();sent=true;const reply=await fetch(endpoint,{method:'POST',headers,body,signal:controller.signal,redirect:'error'});
      if(!reply.ok||!reply.body||!reply.headers.get('content-type')?.toLowerCase().startsWith('text/event-stream')){await reply.body?.cancel();throw Error('供应商未返回可核实的流式响应')}
      const parser=new RequestBudgetUsageStream(model.api);res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-store'});
      unknownReason='protocol_unverifiable';
      for await(const part of reply.body){controller.signal.throwIfAborted();for(const frame of parser.push(part)){
        if(!res.write(frame))await new Promise<void>((resolve,reject)=>{const done=()=>{res.off('drain',done);res.off('close',gone);resolve()},gone=()=>{res.off('drain',done);reject(Error('模型请求接收端已关闭'))};res.once('drain',done);res.once('close',gone)});
      }}
      unknownReason='incomplete_usage';const result=parser.finish();
      await ticket.report(result.usage);terminal=true;
      const cost=requestBudgetCost(model,result.usage);
      if(result.usage.input+result.usage.cacheRead+result.usage.cacheWrite>model.contextWindow||result.usage.output>maxOutputTokens||cost!==undefined&&reservation.estimatedCostUsd!==undefined&&cost>reservation.estimatedCostUsd)throw Error('供应商报告超过原请求预留，已保存实际用量并停止后续执行');
      if(controller.signal.aborted||closing||blocked)throw Error('模型请求结算后原运行已停止');
      res.end(result.terminal);
    }catch(error){
      block(error instanceof Fault?error.message:sent?'模型请求未能可靠交付；已知用量保留，未决预留不释放':error instanceof Error?error.message:'模型请求未能发送');
      if(ticket&&!terminal){try{if(!sent)await ticket.notSent(closing?'closed_before_send':'cancelled_before_send');else if(issued)await ticket.unknown(closing?'closing':controller.signal.aborted?'cancelled':unknownReason)}catch{block('模型请求结算未能保存，原预留保持未决')}}
      controller.abort();failure(res);
    }finally{res.off('close',abort);req.off('aborted',abort)}
  }
  const server=http.createServer((req,res)=>{const controller=new AbortController();const pending=handle(req,res,controller).catch(()=>{block('模型请求收尾失败，原预留保持未决');res.destroy()});active.set(pending,controller);void pending.finally(()=>active.delete(pending))});
  server.requestTimeout=30000;server.headersTimeout=10000;
  await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});
  return {endpoint,token,url:'http://127.0.0.1:'+(server.address() as import('node:net').AddressInfo).port,
    assertReady(){if(!ready||closing)throw Error('逐请求预算门禁未完成启动核验')},
    error(){return blocked},
    /** 原生引擎可能在 SSE 完成前调用工具；先等实际请求全部结算，失败或停止不得进入工具授权。 */
    async assertSettled(){
      while(active.size)await Promise.all([...active.keys()]);
      if(closing||blocked)throw Error(blocked??'模型请求已停止');
    },
    /** 原生停止先取消实际 IO，保留已经可靠结算的用量；等待全部未决阶段落盘后才关闭资源。 */
    close(){return closingPromise??=(async()=>{closing=true;for(const controller of active.values())controller.abort();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));await Promise.allSettled([...active.keys()])})()},
  };
}
