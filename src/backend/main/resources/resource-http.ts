/**
 * 作用定位：RemoteRepository 与 serveRepository：HTTP 客户端和本机仓库共享服务。
 * 设计原因：资源身份、令牌和业务错误留在本层；utility 显式取消正文 reader，保留 Node 22 挂起修复，不依赖 fetch 继续转发信号。
 */
import http from 'node:http';
import {timingSafeEqual} from 'node:crypto';
import type {AddressInfo} from 'node:net';
import {readBoundedBytes,ByteLimitError} from '../../../core/utility';
import {fail} from '../../core/foundation/errors';
import {json} from '../../core/foundation/serialization';
import {MAX_BYTES,snapshotSchema,type RepositoryStore} from './resource-store';

export function repositoryUrl(input:string){let url:URL;try{url=new URL(input)}catch{fail('URL','请输入有效的 HTTP 或 HTTPS 仓库地址')}
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash||url.pathname!=='/')fail('URL','地址应为 HTTP(S) 服务根地址，不含路径、查询参数或账号密码');return url.origin;
}
export class RemoteRepository implements RepositoryStore{
  constructor(readonly url:string,private token:string,readonly expectedId?:string){}
  private async request(method='GET',body?:unknown,signal?:AbortSignal){
    const timeout=AbortSignal.timeout(8000),combined=signal?AbortSignal.any([signal,timeout]):timeout;
    const interrupted=()=>{if(signal?.aborted)fail('CANCELLED','仓库读取已取消；本次调用不会自动重试');if(timeout.aborted)fail('TIMEOUT','仓库请求超过 8 秒；本次调用不会自动重试')};
    interrupted();let response:Response;try{response=await fetch(this.url+'/v1/resources',{method,headers:{Authorization:'Bearer '+this.token,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),redirect:'error',signal:combined})}catch{interrupted();fail('CONNECTION',method==='GET'?'无法连接远端仓库，请检查地址、网络和服务状态':'远端写入结果未确认，请刷新仓库核对后再操作')}
    let bytes:Uint8Array;
    try{bytes=await readBoundedBytes(response.body,{maxBytes:MAX_BYTES+65536,signal:combined})}
    catch(error){if(error instanceof ByteLimitError)fail('SIZE','远端响应过大');interrupted();fail('CONNECTION','远端响应中断，请刷新核对结果')}
    interrupted();
    let payload:any;try{payload=JSON.parse(Buffer.from(bytes).toString('utf8'))}catch{fail('PROTOCOL','远端未返回 CBIM 仓库协议数据')}
    if(!response.ok){const code=response.status===401?'UNAUTHORIZED':response.status===403?'FORBIDDEN':response.status===409?'CONFLICT':'REMOTE_ERROR';fail(code,code==='UNAUTHORIZED'?'远端仓库令牌无效':code==='FORBIDDEN'?'当前仓库凭据不允许该操作':code==='CONFLICT'?'远端仓库已变化，请刷新后重新编辑':'远端仓库请求失败，请检查服务状态')}
    const parsed=snapshotSchema.safeParse(payload);if(!parsed.success)fail('PROTOCOL','远端数据不兼容 CBIM Resource Repository v1');if(this.expectedId&&parsed.data.repositoryId!==this.expectedId)fail('IDENTITY','远端仓库身份已变化，请重新连接');return parsed.data;
  }
  /** 真实 HTTP 读取；信号作用到响应正文，不保存凭据、不自动重试。 */
  read(signal?:AbortSignal){return this.request('GET',undefined,signal)}
  save(args:unknown){return this.request('POST',args)}
  remove(args:unknown){return this.request('DELETE',args)}
}
/** 既有共享令牌保留读写；独立只读令牌只能 GET，不能通过客户端声明或请求体提升权限。 */
export async function serveRepository(store:RepositoryStore,token:string,options:{host:'127.0.0.1'|'0.0.0.0';port:number;readOnlyToken?:string}){
  if(options.readOnlyToken===token)fail('TOKEN_SCOPE','只读令牌不能复用共享读写令牌');
  let closing=false;const operations=new Set<Promise<void>>();
  const server=http.createServer((req,res)=>{const work=(async()=>{const respond=(status:number,value:unknown)=>{if(!res.destroyed){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(json(value))}};
    try{if(closing)return respond(503,{code:'CLOSING'});if(req.headers.origin)return respond(403,{code:'ORIGIN'});const actual=Buffer.from(req.headers.authorization||''),matches=(value:string)=>{const expected=Buffer.from('Bearer '+value);return expected.length===actual.length&&timingSafeEqual(expected,actual)};
      const writable=matches(token),readOnly=!!options.readOnlyToken&&matches(options.readOnlyToken);if(!writable&&!readOnly)return respond(401,{code:'UNAUTHORIZED'});
      if(!writable&&req.method!=='GET')return respond(403,{code:'READ_ONLY'});
      if(req.url!=='/v1/resources')return respond(404,{code:'NOT_FOUND'});if(req.method==='GET')return respond(200,await store.read());if(!['POST','DELETE'].includes(req.method||''))return respond(405,{code:'METHOD'});
      let size=0;const chunks:Buffer[]=[];for await(const chunk of req){size+=chunk.length;if(size>1024*1024)return respond(413,{code:'SIZE'});chunks.push(chunk)}let args:unknown;try{args=JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{return respond(400,{code:'JSON'})}respond(200,await (req.method==='POST'?store.save(args):store.remove(args)));
    }catch(e:any){respond(e.code==='CONFLICT'||e.code==='IDENTITY'?409:e.name==='ZodError'?400:500,{code:e.code||'REQUEST_FAILED'})}
  })();operations.add(work);void work.finally(()=>operations.delete(work));});
  server.requestTimeout=10000;server.headersTimeout=10000;
  await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(options.port,options.host,()=>{server.off('error',reject);resolve()})});
  const port=(server.address() as AddressInfo).port;
  return {url:`http://127.0.0.1:${port}`,host:options.host,port,async close(){closing=true;const stopped=new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));server.closeIdleConnections();await Promise.allSettled([...operations]);server.closeIdleConnections();await stopped}};
}
