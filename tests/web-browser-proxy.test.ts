import {expect,it,vi} from 'vitest';
import http from 'node:http';
import {connect,createServer,type Socket} from 'node:net';
import {openBrowserProxy} from '../src/foundations/web';

const publicAnswers=[{address:'93.184.216.34',family:4}];
function get(port:number,url:string,method='GET'){
  return new Promise<{status:number;body:string}>((resolve,reject)=>{
    const request=http.request({host:'127.0.0.1',port,path:url,method,agent:false},response=>{
      let body='';response.on('data',chunk=>body+=chunk);response.on('end',()=>resolve({status:response.statusCode!,body}));response.on('error',reject);
    });request.on('error',reject);request.end();
  });
}
it('明文代理固定已验证 IP，保留目标 Host，拒绝非 GET，取消后端口关闭',async()=>{
  const server=http.createServer((req,res)=>res.end(`${req.headers.host}${req.url}`));
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const controller=new AbortController(),failure=vi.fn(),dial=vi.fn(()=>connect({host:'127.0.0.1',port:(server.address() as {port:number}).port}));
  const proxy=await openBrowserProxy(controller.signal,failure,{lookup:async()=>publicAnswers,connect:dial});
  try{
    expect(await get(proxy.port,'http://example.test/page?q=1')).toEqual({status:200,body:'example.test/page?q=1'});
    expect(dial).toHaveBeenCalledWith(publicAnswers[0].address,80);
    expect((await get(proxy.port,'http://example.test/write','POST')).status).toBe(405);expect(dial).toHaveBeenCalledTimes(1);
    controller.abort();await expect(get(proxy.port,'http://example.test/')).rejects.toThrow();expect(failure).not.toHaveBeenCalled();
  }finally{proxy.close();server.closeAllConnections();server.close()}
});
it.each([[],[{address:'127.0.0.1',family:4}],[...publicAnswers,{address:'::1',family:6}]].map(answers=>({answers})))('代理拒绝非公网或混合 DNS 答案 $answers，未连接目标',async({answers})=>{
  const failure=vi.fn(),dial=vi.fn(),proxy=await openBrowserProxy(new AbortController().signal,failure,{lookup:async()=>answers,connect:dial});
  try{
    await expect(get(proxy.port,'http://example.test/')).rejects.toThrow();
    expect(dial).not.toHaveBeenCalled();expect(failure.mock.calls[0][0].message).toContain('WEB_SSRF');
  }finally{proxy.close()}
});
it('CONNECT 固定公网地址并透明传输字节，关闭出口同时关闭已建立的隧道',async()=>{
  const server=createServer(socket=>socket.pipe(socket));
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const failure=vi.fn(),dial=vi.fn(()=>connect({host:'127.0.0.1',port:(server.address() as {port:number}).port}));
  const proxy=await openBrowserProxy(new AbortController().signal,failure,{lookup:async()=>publicAnswers,connect:dial});
  let tunnel:Socket|undefined;
  try{
    tunnel=await new Promise<Socket>((resolve,reject)=>{
      const request=http.request({host:'127.0.0.1',port:proxy.port,method:'CONNECT',path:'example.test:443',agent:false});
      request.on('connect',(response,socket)=>{expect(response.statusCode).toBe(200);resolve(socket)});request.on('error',reject);request.end();
    });
    expect(dial).toHaveBeenCalledWith(publicAnswers[0].address,443);
    const received=new Promise<Buffer>(resolve=>tunnel!.once('data',resolve));tunnel.write(Buffer.from([0x16,3,1,0,42]));
    expect(await received).toEqual(Buffer.from([0x16,3,1,0,42]));
    const closed=new Promise<void>(resolve=>tunnel!.once('close',()=>resolve()));proxy.close();await closed;expect(failure).not.toHaveBeenCalled();
  }finally{tunnel?.destroy();proxy.close();server.close()}
});
it('DNS 解析期间取消不会在迟到结果之后建立 TCP 连接',async()=>{
  let finish!:(value:typeof publicAnswers)=>void,started!:()=>void;
  const entered=new Promise<void>(resolve=>started=resolve),lookup=()=>{started();return new Promise<typeof publicAnswers>(resolve=>finish=resolve)};
  const dial=vi.fn(),controller=new AbortController(),proxy=await openBrowserProxy(controller.signal,()=>{},{lookup,connect:dial});
  try{
    const request=get(proxy.port,'http://example.test/').catch(()=>{});await entered;controller.abort();finish(publicAnswers);await request;
    await new Promise<void>(resolve=>setImmediate(resolve));expect(dial).not.toHaveBeenCalled();
  }finally{proxy.close()}
});
it('响应超过累计字节上限时中断连接并保留限制原因',async()=>{
  const server=http.createServer((_req,res)=>res.end(Buffer.alloc(33*1024*1024,120)));
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const failure=vi.fn(),proxy=await openBrowserProxy(new AbortController().signal,failure,{lookup:async()=>publicAnswers,connect:()=>connect({host:'127.0.0.1',port:(server.address() as {port:number}).port})});
  try{
    await expect(get(proxy.port,'http://example.test/big')).rejects.toThrow();
    expect(failure.mock.calls[0][0].message).toContain('WEB_BROWSER_LIMIT');
  }finally{proxy.close();server.closeAllConnections();server.close()}
});
