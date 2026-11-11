/**
 * 作用定位：仅公开 HTTP/HTTPS 的有界传输，供网页工具使用。
 * 设计原因：校验全部 DNS 结果并固定本次连接地址，阻止重绑定；调用者逐跳重新授权，传输不自动跳转或携带 Cookie。
 */
import http from 'node:http';
import https from 'node:https';
import {lookup} from 'node:dns/promises';
import {isIP} from 'node:net';
import {gunzipSync,inflateSync,brotliDecompressSync} from 'node:zlib';
import ipaddr from 'ipaddr.js';
import {fail} from '../../core/foundation/errors';

const limit=1024*1024;
export function publicAddress(address:string):boolean {
  try{return ipaddr.process(address).range()==='unicast'}catch{return false}
}
/** URL 的规范化先于 DNS；仅常规 Web 端口，禁止凭据、非公网 IP 与本地名称。 */
export function publicUrl(value:string):URL {
  let url:URL;try{url=new URL(value)}catch{return fail('WEB_URL','网页地址无效')}
  const host=url.hostname.replace(/^\[|\]$/g,'');
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.port&&url.port!=='80'&&url.port!=='443'||!host||host==='localhost'||host.endsWith('.localhost')||host.endsWith('.local')||host.endsWith('.internal')||!host.includes('.')&&!isIP(host)||isIP(host)&&!publicAddress(host))fail('WEB_SSRF','只能读取公开 HTTP/HTTPS 网页，禁止本机、内网、保留地址和非常规端口');
  url.hash='';return url;
}
export interface PublicHttpResponse {status:number;headers:http.IncomingHttpHeaders;body:string}
/** 测试端口只由可信装配提供，不属于 IPC 或模型参数。lookup 返回全部地址，request 必须遵守传入 lookup。 */
export interface PublicHttpTransport {
  lookup(host:string):Promise<Array<{address:string;family:number}>>;
  request:typeof http.request;
}
/** 每个请求独立销毁连接，最多 1 MiB（压缩前后）和 15 秒；从不自动重试。 */
export class PublicHttp {
  constructor(private readonly transport?:PublicHttpTransport){}
  async read(raw:string,signal:AbortSignal,options:{headers?:Record<string,string>}={}):Promise<PublicHttpResponse>{
    const url=publicUrl(raw),host=url.hostname.replace(/^\[|\]$/g,''),deadline=AbortSignal.any([signal,AbortSignal.timeout(15000)]);
    deadline.throwIfAborted();
    const addresses=await new Promise<Array<{address:string;family:number}>>((resolve,reject)=>{
      const abort=()=>reject(deadline.reason);deadline.addEventListener('abort',abort,{once:true});
      const pending=isIP(host)?Promise.resolve([{address:host,family:isIP(host)}]):(this.transport?.lookup(host)??lookup(host,{all:true}));
      void pending.then(resolve,()=>reject(Error('WEB_DNS: 域名解析失败'))).finally(()=>deadline.removeEventListener('abort',abort));
    });
    deadline.throwIfAborted();
    if(!addresses.length||addresses.some(item=>!publicAddress(item.address)))fail('WEB_SSRF','域名解析包含非公开地址，未建立连接');
    const address=addresses[0],request=this.transport?.request??(url.protocol==='https:'?https.request:http.request);
    return new Promise((resolve,reject)=>{
      const req=request(url,{agent:false,family:address.family,signal:deadline,headers:{'User-Agent':'CBIMBot/0.1','Accept':'text/html,text/plain,application/json','Accept-Encoding':'identity',...options.headers},lookup:(_host,_options,callback)=>callback(null,address.address,address.family)},response=>{
        const chunks:Buffer[]=[];let size=0;
        response.on('error',()=>reject(Error('WEB_NETWORK: 网页响应中断')));
        response.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>limit){req.destroy();reject(Error('WEB_SIZE: 响应超过 1 MiB'))}else chunks.push(chunk)});
        response.on('end',()=>{
          try{
            if(deadline.aborted)throw deadline.reason;
            let bytes=Buffer.concat(chunks);const encoding=response.headers['content-encoding'];
            if(encoding==='gzip')bytes=gunzipSync(bytes,{maxOutputLength:limit});
            else if(encoding==='deflate')bytes=inflateSync(bytes,{maxOutputLength:limit});
            else if(encoding==='br')bytes=brotliDecompressSync(bytes,{maxOutputLength:limit});
            else if(encoding&&encoding!=='identity')throw Error('WEB_ENCODING: 不支持的内容压缩');
            if(bytes.length>limit)throw Error('WEB_SIZE: 解压后响应超过 1 MiB');
            resolve({status:response.statusCode??0,headers:response.headers,body:new TextDecoder('utf-8',{fatal:true}).decode(bytes)});
          }catch{reject(Error('WEB_CONTENT: 响应过大、编码无效或不受支持'))}
        });
      });
      req.on('error',()=>reject(Error(deadline.aborted?'WEB_ABORTED: 网页请求已取消或超时':'WEB_NETWORK: 网页网络连接失败')));
      req.end();
    });
  }
}
