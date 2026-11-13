/**
 * 目录归属：backend/engines/codex；Codex 引擎适配。
 * 作用定位：将 Codex 的 Responses 请求约束为本轮冻结模型、输出上限和已注册工具目录。
 * 设计原因：Codex 没有与 CBIM maxTokens 等价的启动字段；在实际发送前补上上限，再交给共用请求账本。
 * 职责边界：真实凭据只在父进程；不提供任意转发或专用远端压缩入口，失败后封住后续请求及工具。
 */
import http from 'node:http';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import type {ResolvedLlm} from '../../../logic/models';
import type {RequestBudgetPort} from '../../../logic/budget/rules/request-budget';
import {openRequestBudgetTransport,requestBudgetEndpoint} from '../transport/request-budget-transport';
import {RequestBudgetUsageStream} from '../transport/request-budget-usage';
import type {CodexToolSpec} from './tools';

/** 每次 run 独立创建；目录在生成前冻结，不接受子进程扩大模型、目标地址或工具集合。 */
export async function openCodexModelProxy(llm:ResolvedLlm,registered:CodexToolSpec[],catalog:CodexToolSpec[],port?:RequestBudgetPort,onCatalog?:()=>Promise<void>){
  llm=structuredClone(llm);
  const gate=port?await openRequestBudgetTransport(llm,port):undefined;
  if(gate){const response=await fetch(gate.url+'/ready',{method:'POST',headers:{authorization:'Bearer '+gate.token}});if(!response.ok)throw Error('Codex 请求预算准备失败');gate.assertReady()}
  const token=randomBytes(32).toString('hex'),known=new Set(registered.map(tool=>tool.name)),active=new Map<Promise<void>,AbortController>();
  let closing=false,failure:string|undefined,closePromise:Promise<void>|undefined;
  const totals={input:0,output:0,cacheRead:0,cacheWrite:0};let completed=0;
  const server=http.createServer((request,response)=>{
    const abort=new AbortController();const gone=()=>{if(!response.writableEnded)abort.abort()};response.on('close',gone);
    const work=(async()=>{
      try{
        const supplied=Buffer.from(request.headers.authorization??''),expected=Buffer.from('Bearer '+token);
        if(request.headers.origin||supplied.length!==expected.length||!timingSafeEqual(supplied,expected)){response.writeHead(403).end();return}
        if(closing||failure)throw Error(failure??'Codex 请求已停止');
        if(request.method!=='POST'||request.url!=='/responses')throw Error('Codex 请求了未接入的供应商接口');
        const chunks:Buffer[]=[];let bytes=0;for await(const chunk of request){bytes+=chunk.length;if(bytes>32*1024*1024)throw Error('Codex 请求过大');chunks.push(Buffer.from(chunk))}
        const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
        if(value.model!==llm.profile.model||value.stream!==true||value.background===true||value.previous_response_id)throw Error('Codex 请求与本轮冻结模型/会话不一致');
        // 本版本固定附带 request_user_input；不向模型发布它，交互仍只能走 CBIM 的受管提问工具。
        if(!Array.isArray(value.tools)||value.tools.some((tool:any)=>tool.type!=='function'||!known.has(tool.name)&&tool.name!=='request_user_input'))throw Error('Codex 请求包含未经 CBIM 注册的工具');
        const requested=value.max_output_tokens;
        if(requested!==undefined&&(!Number.isSafeInteger(requested)||requested<1))throw Error('Codex 输出上限无效');
        value.max_output_tokens=Math.min(requested??llm.profile.maxTokens,llm.profile.maxTokens);
        // thread/resume 保留旧 dynamic tools；实际请求按当前权限/参数契约裁剪，原生执行端也再次核对。
        value.tools=catalog.map(tool=>({type:'function',name:tool.name,description:tool.description,parameters:tool.inputSchema,strict:false}));
        await onCatalog?.();abort.signal.throwIfAborted();
        const headers:Record<string,string>={'content-type':'application/json','accept':'text/event-stream'};
        if(gate)headers.authorization='Bearer '+gate.token;else if(llm.profile.auth==='api-key')headers.authorization='Bearer '+llm.apiKey;
        const upstream=await fetch(gate?gate.url+'/request':requestBudgetEndpoint(llm),{method:'POST',headers,body:JSON.stringify(value),signal:abort.signal,redirect:'error'});
        if(!upstream.ok||!upstream.body||!upstream.headers.get('content-type')?.startsWith('text/event-stream')){await upstream.body?.cancel();throw Error(gate?.error()??'Codex 供应商没有返回可靠流式响应')}
        response.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-store'});
        const parser=new RequestBudgetUsageStream('openai-responses');
        for await(const chunk of upstream.body){abort.signal.throwIfAborted();for(const frame of parser.push(chunk))if(!response.write(frame))await new Promise<void>((resolve,reject)=>{const drained=()=>{response.off('close',closed);resolve()},closed=()=>{response.off('drain',drained);reject(Error('Codex 接收端已关闭'))};response.once('drain',drained);response.once('close',closed)})}
        // 按本轮实际 HTTP 响应求和，避免把恢复线程的历史累计用量再次记账。
        const result=parser.finish();for(const key of ['input','output','cacheRead','cacheWrite'] as const){totals[key]+=result.usage[key];if(!Number.isSafeInteger(totals[key]))throw Error('Codex 累计用量超过受管上限')}
        completed++;response.end(result.terminal);
      }catch(error){failure??=gate?.error()??(error instanceof Error?error.message:'Codex 模型传输失败');abort.abort();if(response.headersSent)response.destroy();else response.writeHead(409,{'content-type':'application/json'}).end(JSON.stringify({error:{type:'cbim_engine_denied',message:failure}}))}
      finally{response.off('close',gone)}
    })();active.set(work,abort);void work.finally(()=>active.delete(work));
  });
  server.requestTimeout=30000;server.headersTimeout=10000;
  await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});
  return {url:'http://127.0.0.1:'+(server.address() as import('node:net').AddressInfo).port,token,error:()=>failure??gate?.error(),
    usage(){return !closing&&!failure&&completed?{...totals}:undefined},
    async assertSettled(){while(active.size)await Promise.all([...active.keys()]);await gate?.assertSettled();if(closing||failure)throw Error(failure??'Codex 请求已停止')},
    close(){return closePromise??=(async()=>{closing=true;for(const controller of active.values())controller.abort();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));await Promise.allSettled([...active.keys()]);await gate?.close()})()},
  };
}
