import http from 'node:http';
import {timingSafeEqual} from 'node:crypto';
import type {AddressInfo} from 'node:net';
import {fail,json} from './paths';
import {MAX_BYTES,snapshotSchema,type RepositoryStore} from './resource-store';

export function repositoryUrl(input:string){let url:URL;try{url=new URL(input)}catch{fail('URL','请输入有效的 HTTP 或 HTTPS 仓库地址')}
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash||url.pathname!=='/')fail('URL','地址应为 HTTP(S) 服务根地址，不含路径、查询参数或账号密码');return url.origin;
}
export class RemoteRepository implements RepositoryStore{
  constructor(readonly url:string,private token:string,readonly expectedId?:string){}
  private async request(method='GET',body?:unknown){let response:Response;try{response=await fetch(this.url+'/v1/resources',{method,headers:{Authorization:'Bearer '+this.token,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(8000)})}catch{fail('CONNECTION',method==='GET'?'无法连接远端仓库，请检查地址、网络和服务状态':'远端写入结果未确认，请刷新仓库核对后再操作')}
    let bytes=0;const chunks:Uint8Array[]=[];const reader=response.body?.getReader();try{if(reader)for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>MAX_BYTES+65536){await reader.cancel();fail('SIZE','远端响应过大')}chunks.push(value)}}catch(e:any){if(e.code==='SIZE')throw e;fail('CONNECTION','远端响应中断，请刷新核对结果')}
    let payload:any;try{payload=JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{fail('PROTOCOL','远端未返回 CBIM 仓库协议数据')}
    if(!response.ok){const code=response.status===401?'UNAUTHORIZED':response.status===409?'CONFLICT':'REMOTE_ERROR';fail(code,code==='UNAUTHORIZED'?'远端仓库令牌无效':code==='CONFLICT'?'远端仓库已变化，请刷新后重新编辑':'远端仓库请求失败，请检查服务状态')}
    const parsed=snapshotSchema.safeParse(payload);if(!parsed.success)fail('PROTOCOL','远端数据不兼容 CBIM Resource Repository v1');if(this.expectedId&&parsed.data.repositoryId!==this.expectedId)fail('IDENTITY','远端仓库身份已变化，请重新连接');return parsed.data;
  }
  read(){return this.request()}
  save(args:unknown){return this.request('POST',args)}
  remove(args:unknown){return this.request('DELETE',args)}
}
export async function serveRepository(store:RepositoryStore,token:string,options:{host:'127.0.0.1'|'0.0.0.0';port:number}){
  let closing=false;const operations=new Set<Promise<void>>();
  const server=http.createServer((req,res)=>{const work=(async()=>{const respond=(status:number,value:unknown)=>{if(!res.destroyed){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(json(value))}};
    try{if(closing)return respond(503,{code:'CLOSING'});if(req.headers.origin)return respond(403,{code:'ORIGIN'});const expected=Buffer.from('Bearer '+token),actual=Buffer.from(req.headers.authorization||'');if(expected.length!==actual.length||!timingSafeEqual(expected,actual))return respond(401,{code:'UNAUTHORIZED'});
      if(req.url!=='/v1/resources')return respond(404,{code:'NOT_FOUND'});if(req.method==='GET')return respond(200,await store.read());if(!['POST','DELETE'].includes(req.method||''))return respond(405,{code:'METHOD'});
      let size=0;const chunks:Buffer[]=[];for await(const chunk of req){size+=chunk.length;if(size>1024*1024)return respond(413,{code:'SIZE'});chunks.push(chunk)}let args:unknown;try{args=JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{return respond(400,{code:'JSON'})}respond(200,await (req.method==='POST'?store.save(args):store.remove(args)));
    }catch(e:any){respond(e.code==='CONFLICT'||e.code==='IDENTITY'?409:e.name==='ZodError'?400:500,{code:e.code||'REQUEST_FAILED'})}
  })();operations.add(work);void work.finally(()=>operations.delete(work));});
  server.requestTimeout=10000;server.headersTimeout=10000;
  await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(options.port,options.host,()=>{server.off('error',reject);resolve()})});
  const port=(server.address() as AddressInfo).port;
  return {url:`http://127.0.0.1:${port}`,host:options.host,port,async close(){closing=true;const stopped=new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));server.closeIdleConnections();await Promise.allSettled([...operations]);server.closeIdleConnections();await stopped}};
}
