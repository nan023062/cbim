/**
 * 作用定位：将 HTTP/MCP 请求与响应接入调用日志和流量统计。
 * 设计原因：在传输边界统一记录调用结果，限制正文缓冲并清除令牌，兼顾诊断与数据边界。
 */
import {randomUUID} from 'node:crypto';
import type {IncomingMessage,ServerResponse} from 'node:http';
import type {Workspace} from '../../workspace/workspace';

// Capture bounded JSON solely to extract protocol metadata; never persist bodies or headers.
export function traceMcp(workspace:Workspace,req:IncomingMessage,res:ServerResponse){
  const start=Date.now(),metrics=workspace.mcp;metrics.start();
  let received=0,sent=0,input:Buffer[]=[],output:Buffer[]=[],inputSize=0,outputSize=0,finished=false;
  let failure:{code:string;message:string}|undefined;
  let toolOverride:string|undefined;
  const buffer=(chunk:any,encoding?:BufferEncoding)=>typeof chunk==='string'?Buffer.from(chunk,encoding):Buffer.isBuffer(chunk)?chunk:ArrayBuffer.isView(chunk)?Buffer.from(chunk.buffer,chunk.byteOffset,chunk.byteLength):Buffer.alloc(0);
  const capture=(chunk:Buffer,incoming:boolean)=>{
    if(incoming){received+=chunk.length;metrics.bytes(chunk.length,0);inputSize+=chunk.length;if(inputSize<=65536)input.push(chunk);else input=[]}
    else{sent+=chunk.length;metrics.bytes(0,chunk.length);outputSize+=chunk.length;if(outputSize<=65536)output.push(chunk);else output=[]}
  };
  const push=req.push.bind(req);req.push=((chunk:any,encoding?:BufferEncoding)=>{capture(buffer(chunk,encoding),true);return push(chunk,encoding)}) as typeof req.push;
  const write=res.write.bind(res),end=res.end.bind(res);
  res.write=((...args:any[])=>{capture(buffer(args[0],typeof args[1]==='string'?args[1] as BufferEncoding:undefined),false);return (write as any)(...args)}) as typeof res.write;
  res.end=((...args:any[])=>{capture(buffer(args[0],typeof args[1]==='string'?args[1] as BufferEncoding:undefined),false);return (end as any)(...args)}) as typeof res.end;
  const safe=(value:unknown,limit=800)=>String(value??'').replaceAll(workspace.readToken,'[redacted]').replaceAll(workspace.writeToken,'[redacted]').replace(/Bearer\s+\S+/gi,'Bearer [redacted]').slice(0,limit);
  const parse=(chunks:Buffer[])=>{try{return JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{return undefined}};
  const finish=()=>{
    if(finished)return;finished=true;
    const request=parse(input),response=parse(output);input=[];output=[];
    if(!failure&&response?.error)failure={code:String(response.error.code),message:response.error.message};
    if(!failure&&response?.result?.isError){const content=response.result.content?.find((c:any)=>c.type==='text');let detail:any;try{detail=JSON.parse(content?.text)}catch{}failure={code:detail?.code||'TOOL_ERROR',message:detail?.message||content?.text||'工具返回错误'}}
    if(!failure&&res.statusCode>=400)failure={code:'HTTP_'+res.statusCode,message:({401:'鉴权失败：凭据缺失或过期',403:'请求来源被拒绝',404:'实例链接不存在',405:'不支持该 HTTP 方法（无状态 MCP 不提供持续 GET 连接）',503:'工作区正在停止或不可用'} as Record<number,string>)[res.statusCode]||'HTTP 请求失败'};
    if(!failure&&!res.writableFinished)failure={code:'CONNECTION_CLOSED',message:'响应完成前连接中断'};
    metrics.finish(!!failure);
    workspace.calls.add({id:randomUUID(),time:new Date(start).toISOString(),workspaceId:workspace.entry.id,instanceId:workspace.instanceId,httpMethod:req.method||'UNKNOWN',method:toolOverride?'tools/call':request?.method?safe(request.method,100):undefined,tool:toolOverride|| (request?.method==='tools/call'?safe(request.params?.name,100):undefined),status:res.statusCode,result:failure?'error':'ok',code:failure?safe(failure.code,100):undefined,message:failure?safe(failure.message):undefined,durationMs:Date.now()-start,receivedBytes:received,sentBytes:sent});
  };
  res.once('finish',finish);res.once('close',finish);
  return {tool:(name:string)=>{toolOverride=name},fail:(code:unknown,message:unknown)=>{failure={code:safe(code,100),message:safe(message)}}};
}
