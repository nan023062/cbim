/**
 * 作用定位：大脑 执行层：内部知识 Schema/调用的本机临时桥及 Pi 扩展，工具授权先落盘再放行。
 * 设计原因：把知识服务 Schema 与一次性授权交给受控扩展；每轮根据实际活动工具刷新能力指引，避免沿用历史权限判断。每个模型回合及会话加载后以独立只读通道上报上下文计量及发送前实际输出额度；跨进程桥不依赖 MCP 协议。
 */
import http from 'node:http';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import type {ToolCall,ToolDecision} from '../types';

/** 从注入知识服务清单返回的工具 Schema，禁止仅凭名称伪造参数。 */
export interface KnowledgeToolSchema {name:string;description?:string;inputSchema:Record<string,unknown>}
/** 注入的工作区知识连接能力；call 原样传递身份与版本，不修复或重放写入。 */
export interface KnowledgeBridge {
  list():Promise<KnowledgeToolSchema[]>;
  call(name:string,args:Record<string,unknown>,signal:AbortSignal):Promise<unknown>;
}
/** 临时桥只接受本次实例令牌；工具授权绑定调用 ID、名称和原始参数。 */
export async function openBridge(knowledge:KnowledgeBridge,beforeTool:(call:ToolCall)=>Promise<ToolDecision>,onContext?:(usage:{tokens:number|null;contextWindow:number})=>Promise<void>,onRequestLimit?:(limit:number)=>Promise<void>){
  const tools=await knowledge.list();
  if(tools.some(t=>!/^cbim_[a-z0-9_]+$/.test(t.name)))throw Error('CBIM 工具名必须使用 cbim_ 前缀');
  const names=new Set(tools.map(t=>t.name)),token=randomBytes(32).toString('hex');
  // One authorization per tool call, bound to exact input; never infer trust from its name alone.
  const grants=new Map<string,{name:string;input:string}>();
  const server=http.createServer(async(req,res)=>{
    const auth=Buffer.from(req.headers.authorization||''),expected=Buffer.from('Bearer '+token);
    if(req.headers.origin||auth.length!==expected.length||!timingSafeEqual(auth,expected)){res.writeHead(403).end();return}
    const controller=new AbortController();res.on('close',()=>{if(!res.writableEnded)controller.abort()});
    try{
      if(req.method==='GET'&&req.url==='/catalog'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(tools));return}
      if(req.method!=='POST'||!['/gate','/call','/context','/request-limit'].includes(req.url||'')){res.writeHead(404).end();return}
      let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>4*1024*1024)throw Error('工具参数过大')}
      if(req.url==='/request-limit'){
        const value=JSON.parse(body);if(!Number.isInteger(value.maxTokens)||value.maxTokens<1||value.maxTokens>2000000)throw Error('无效请求额度');
        await onRequestLimit?.(value.maxTokens);res.setHeader('Content-Type','application/json');res.end('{}');return;
      }
      if(req.url==='/context'){
        const value=JSON.parse(body);
        if(!Number.isFinite(value.contextWindow)||value.contextWindow<=0||!(value.tokens===null||Number.isFinite(value.tokens)&&value.tokens>=0))throw Error('无效上下文计量');
        await onContext?.({tokens:value.tokens,contextWindow:value.contextWindow});res.setHeader('Content-Type','application/json');res.end('{}');return;
      }
      const call=JSON.parse(body) as ToolCall;
      if(typeof call.id!=='string'||typeof call.name!=='string'||!call.input||typeof call.input!=='object'||Array.isArray(call.input))throw Error('无效工具调用');
      let result:unknown;
      if(req.url==='/gate'){
        const decision=await beforeTool(call);result=decision;
        if(decision.allow&&names.has(call.name))grants.set(call.id,{name:call.name,input:JSON.stringify(call.input)});
      }else{
        const grant=grants.get(call.id);grants.delete(call.id);
        if(!names.has(call.name)||!grant||grant.name!==call.name||grant.input!==JSON.stringify(call.input))throw Error('工具调用未获本次执行授权');
        result=await knowledge.call(call.name,call.input,controller.signal);
      }
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify(result));
    }catch(error){res.writeHead(400,{'Content-Type':'application/json'}).end(JSON.stringify({error:error instanceof Error?error.message:String(error)}))}
  });
  await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});
  const port=(server.address() as import('node:net').AddressInfo).port;
  return {url:`http://127.0.0.1:${port}`,token,tools,close:async()=>{grants.clear();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))}};
}

/** Only this extension loads; it registers the actual cbim_ schemas and gates all tools. */
export const bridgeExtension=`
export default async function(pi) {
  const url=process.env.CBIM_LOOP_BRIDGE_URL, token=process.env.CBIM_LOOP_BRIDGE_TOKEN;
  delete process.env.CBIM_LOOP_BRIDGE_URL; delete process.env.CBIM_LOOP_BRIDGE_TOKEN;
  async function request(route, body, signal) {
    const response=await fetch(url+route,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:signal||AbortSignal.timeout(30000)});
    const value=await response.json();if(!response.ok)throw Error(value.error||'CBIM bridge unavailable');return value;
  }
  // 原生上下文是估计值，压缩后未知必须传 null；不发送提示词或推理正文。
  async function reportContext(_event,ctx){try{const usage=ctx.getContextUsage();if(usage)await request('/context',{tokens:usage.tokens,contextWindow:usage.contextWindow})}catch{}}
  pi.on('before_provider_request',async event=>{
    // 仅记录原生请求的数值上限；不改写 payload，不记录消息、工具定义、密钥或推理。
    const payload=event.payload;const limit=payload?.max_tokens??payload?.max_completion_tokens??payload?.max_output_tokens;
    if(Number.isInteger(limit)&&limit>0)try{await request('/request-limit',{maxTokens:limit})}catch{}
  });
  pi.on('session_start',reportContext);pi.on('turn_end',reportContext);pi.on('agent_end',reportContext);pi.on('session_compact',reportContext);
  const tools=await request('/catalog');
  for(const tool of tools) pi.registerTool({name:tool.name,label:tool.name,description:tool.description||tool.name,parameters:tool.inputSchema,
    async execute(id,input,signal){const result=await request('/call',{id,name:tool.name,input},signal);if(result.isError)throw Error(JSON.stringify(result.content));return {...result,details:{source:'cbim'}};}
  });
  // 恢复会话时以真实活动工具为准；这里只更新指引，不添加工具、不绕过 gate。
  pi.on('before_agent_start',async(event)=>{
    const active=pi.getActiveTools();
    event.systemPromptOptions.promptGuidelines.push('本轮实际活动工具：'+active.join(', ')+'。权限事实以本轮工具和调用结果为准，不沿用历史助手消息中的只读、不可写或缺少工具结论。');
    if(active.includes('write'))event.systemPromptOptions.promptGuidelines.push('本轮可调用 write 创建工作区业务文件（包括根目录下的 tetris.html），edit 修改文件；实际写入仍需通过 CBIM 授权。业务写入与知识提交共用本轮权限；知识必须通过 cbim_ 工具操作，不能用原生工具直接修改 .cbim/。用户要求实现时应调用工具落盘并验证，不用长篇源码回复代替执行；仅在真实拒绝或错误后报告对应阻塞。');
    else event.systemPromptOptions.promptGuidelines.push('本轮未启用 write，请遵守只读权限；需要落盘时提示用户选择逐次询问或允许执行。');
  });
  pi.on('tool_call',async(event)=>{
    // 人工批准可能超过 30 秒；生命周期仍由本轮超时和停止控制，不自动放行。
    try{const decision=await request('/gate',{id:event.toolCallId,name:event.toolName,input:event.input},AbortSignal.timeout(30*60*1000));if(!decision.allow)return {block:true,reason:decision.reason||'CBIM rejected tool'};}
    catch(error){return {block:true,reason:String(error),terminate:true};}
  });
}
`;
