/**
 * 作用定位：匿名浏览器专用的本机 HTTP/CONNECT 出口，TLS 与页面协议仍由 Chromium 执行。
 * 设计原因：浏览器保留原生网络行为，同时每个连接校验全部 DNS 并固定公网 IP，避免 DNS 重绑定。
 * 生命周期：每次读取独占随机端口；取消或关闭时销毁全部套接字，不向业务层暴露代理地址。
 */
import http from 'node:http';
import {lookup} from 'node:dns/promises';
import {connect,isIP,type Socket} from 'node:net';
import {publicAddress,publicUrl} from './public-http';

/** 仅可信宿主/测试装配可替换解析和 TCP 连接；页面、IPC 与模型不能传入此对象。 */
export interface BrowserProxyTransport {
  lookup(host:string):Promise<Array<{address:string;family:number}>>;
  connect(address:string,port:number):Socket;
}
/** 一个读取任务一个出口；累计传输上限包括 TLS 密文，不能当作单个解压资源大小。 */
export async function openBrowserProxy(signal:AbortSignal,onFailure:(error:Error)=>void,transport?:BrowserProxyTransport){
  signal.throwIfAborted();
  const sockets=new Set<Socket>();let bytes=0,connections=0,closed=false;
  const server=http.createServer();
  const destroy=()=>{closed=true;for(const socket of sockets)socket.destroy();server.close()};
  const fail=(error:unknown)=>{onFailure(error instanceof Error?error:Error('WEB_NETWORK: 浏览器代理连接失败'));destroy()};
  const track=(socket:Socket)=>{
    sockets.add(socket);socket.on('close',()=>sockets.delete(socket));socket.on('error',()=>{});
    socket.setTimeout(15000,()=>socket.destroy());return socket;
  };
  const count=(chunk:Buffer)=>{bytes+=chunk.length;if(bytes>32*1024*1024)fail(Error('WEB_BROWSER_LIMIT: 浏览器传输超过 32 MiB'))};
  const target=async(raw:string)=>{
    signal.throwIfAborted();if(closed)throw Error('WEB_ABORTED: 浏览器代理已关闭');
    const url=publicUrl(raw),host=url.hostname.replace(/^\[|\]$/g,'');
    const addresses=isIP(host)?[{address:host,family:isIP(host)}]:await (transport?.lookup(host)??lookup(host,{all:true}));
    signal.throwIfAborted();if(closed)throw Error('WEB_ABORTED: 浏览器代理已关闭');
    if(!addresses.length||addresses.some(item=>!publicAddress(item.address)))throw Error('WEB_SSRF: 域名解析包含非公开地址，未建立连接');
    if(++connections>160)throw Error('WEB_BROWSER_LIMIT: 浏览器连接超过读取上限');
    return {url,address:addresses[0].address,port:Number(url.port||(url.protocol==='https:'?443:80))};
  };
  const dial=(address:string,port:number)=>track(transport?.connect(address,port)??connect({host:address,port}));
  server.on('connection',socket=>track(socket));
  server.on('clientError',(_error,socket)=>socket.destroy());
  server.on('connect',(request,client,head)=>{
    void (async()=>{
      const {address,port}=await target(`https://${request.url}/`);
      if(client.destroyed)return;
      const remote=dial(address,port);remote.on('data',count);client.on('data',count);
      remote.once('connect',()=>{client.write('HTTP/1.1 200 Connection Established\r\n\r\n');if(head.length){count(head);remote.write(head)}client.pipe(remote);remote.pipe(client)});
      remote.on('close',()=>client.destroy());client.on('close',()=>remote.destroy());
    })().catch(fail);
  });
  server.on('request',(request,response)=>{
    void (async()=>{
      if(request.method!=='GET') {response.writeHead(405);response.end();return}
      const {url,address,port}=await target(request.url??'');
      if(url.protocol!=='http:')throw Error('WEB_SSRF: 代理明文请求必须使用 HTTP');
      const headers:http.OutgoingHttpHeaders={...request.headers,host:url.host};delete headers['proxy-authorization'];delete headers['proxy-connection'];
      // agent:false 会另建默认 Agent，不能与 createConnection 组合来保证固定地址。
      const agent=new http.Agent({keepAlive:false});agent.createConnection=()=>dial(address,port);
      const upstream=http.request(url,{method:'GET',headers,agent,signal},incoming=>{
        response.writeHead(incoming.statusCode??502,incoming.headers);incoming.on('data',count);incoming.pipe(response);
        incoming.on('error',()=>response.destroy());
      });
      response.on('close',()=>{upstream.destroy();agent.destroy()});upstream.on('error',()=>{if(!response.headersSent)response.writeHead(502);response.end()});upstream.end();
    })().catch(fail);
  });
  signal.addEventListener('abort',destroy,{once:true});
  try{
    await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>{server.removeListener('error',reject);resolve()})});
    signal.throwIfAborted();
    const address=server.address();if(!address||typeof address==='string')throw Error('WEB_NETWORK: 浏览器代理未启动');
    return {port:address.port,close:()=>{signal.removeEventListener('abort',destroy);destroy()}};
  }catch(error){signal.removeEventListener('abort',destroy);destroy();throw error}
}
