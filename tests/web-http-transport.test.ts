import {expect,it,vi} from 'vitest';
import http from 'node:http';
import {PublicHttp,type PublicHttpTransport} from '../src/core/platform/node/web';
const signal=()=>new AbortController().signal;
it('真实 HTTP 传输固定已校验 DNS 地址，取消与字节上限均终止连接',async()=>{
  const server=http.createServer((req,res)=>{if(req.url==='/slow')return;if(req.url==='/big'){res.end('x'.repeat(1024*1024+1));return}res.writeHead(200,{'content-type':'text/plain'});res.end('正文 😀')});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const lookups=vi.fn(async()=>[{address:'93.184.216.34',family:4}]),captured:any[]=[];
  const transport:PublicHttpTransport={lookup:lookups,request:((url:URL,options:any,done:any)=>{
    captured.push(options);options.lookup(url.hostname,{},(error:unknown,address:string,family:number)=>{expect(error).toBeNull();expect(address).toBe('93.184.216.34');expect(family).toBe(4)});
    expect(options.family).toBe(4);
    // 仅测试传输将已核验请求映射到自有本地服务器；生产无地址绕过开关。
    return http.request(new URL(url.pathname,`http://127.0.0.1:${(server.address() as any).port}`),{signal:options.signal,agent:false},done);
  }) as typeof http.request};
  try{
    const client=new PublicHttp(transport);expect((await client.read('https://example.com/',signal())).body).toBe('正文 😀');expect(lookups).toHaveBeenCalledTimes(1);
    await expect(client.read('https://example.com/big',signal())).rejects.toThrow(/WEB_SIZE|WEB_CONTENT/);
    const controller=new AbortController(),pending=client.read('https://example.com/slow',controller.signal);setTimeout(()=>controller.abort(),20);await expect(pending).rejects.toThrow();
    expect(captured[0].agent).toBe(false);
  }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))}
});
