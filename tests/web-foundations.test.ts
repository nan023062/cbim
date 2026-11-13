import {expect,it,vi} from 'vitest';
import http from 'node:http';
import {PublicHttp,publicUrl,publicAddress,htmlMarkdown,truncateParagraphs,type PublicHttpTransport} from '../src/backend/core/foundation/web';
const signal=()=>new AbortController().signal;

it.each(['http://127.0.0.1','http://2130706433','http://0x7f000001','http://[::1]','http://[::ffff:127.0.0.1]','http://169.254.169.254/latest','http://10.0.0.1','http://100.64.0.1','http://192.168.1.1','http://172.31.1.1','http://[fc00::1]','http://localhost','file:///C:/secret','https://user:pass@example.com','http://example.com:8080'])('禁止 SSRF 地址 %s',value=>expect(()=>publicUrl(value)).toThrow());
it('所有 DNS 答案均需公开，私有混合、IPv6 保留及空答案均不发起请求',async()=>{
  for(const addresses of [[{address:'93.184.216.34',family:4},{address:'127.0.0.1',family:4}],[{address:'fe80::1',family:6}],[]]){
    const request=vi.fn(),client=new PublicHttp({lookup:async()=>addresses,request:request as unknown as typeof http.request});
    await expect(client.read('https://example.com',signal())).rejects.toMatchObject({code:'WEB_SSRF'});expect(request).not.toHaveBeenCalled();
  }
  expect(publicAddress('192.0.2.1')).toBe(false);expect(publicAddress('2001:db8::1')).toBe(false);expect(publicAddress('8.8.8.8')).toBe(true);
});
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
it('HTML 保留正文结构，去除导航和脚本，段落截断不切坏 Unicode',()=>{
  const page=htmlMarkdown('<title>标题</title><nav>菜单</nav><main><h1>正文</h1><p>第一段 &amp; 信息</p><p>第二段 <a href="/a">引用</a></p><script>secret()</script></main>','https://example.com');
  expect(page.title).toBe('标题');expect(page.markdown).toContain('# 正文');expect(page.markdown).toContain('[引用](https://example.com/a)');expect(page.markdown).not.toMatch(/菜单|secret/);
  expect(truncateParagraphs('一段\n\n第二段内容',6)).toEqual({markdown:'一段',truncated:true});expect(truncateParagraphs('😀😀😀',2)).toEqual({markdown:'😀😀',truncated:true});
});