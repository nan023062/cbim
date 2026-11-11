import {expect,it,vi} from 'vitest';
import http from 'node:http';
import {PublicHttp,publicUrl,publicAddress,type PublicHttpTransport} from '../src/backend/main/platform/public-http';
import {WebService} from '../src/backend/main/resources/web-service';
import {htmlMarkdown,truncateParagraphs} from '../src/backend/main/resources/web-content';
import {WebTools} from '../src/backend/scheduler-engine/tools/web-tools';

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
function service(responses:Record<string,{status?:number;body?:string;headers?:http.IncomingHttpHeaders}>){
  let time=Date.now();const read=vi.fn(async(url:string)=>{const r=responses[new URL(url).pathname]??{status:404};return {status:r.status??200,headers:r.headers??{'content-type':'text/html; charset=utf-8'},body:r.body??''}});
  const wait=vi.fn(async(ms:number)=>{time+=ms});const web=new WebService({resolve:()=> 'secret-key'},{read},{now:()=>time,wait,interval:1000});
  return {web,read,wait,advance:(ms:number)=>{time+=ms}};
}
it('robots 先于页面、同域限速、短缓存保留原时间，过期重新读取',async()=>{
  const f=service({'/robots.txt':{body:'User-agent: *\nDisallow: /private'},'/article':{body:'<main><p>'+('正文'.repeat(400))+'</p><p>结尾</p></main>'}});
  await expect(f.web.fetch({url:'https://example.com/private'},signal())).rejects.toThrow('WEB_ROBOTS');expect(f.read).toHaveBeenCalledTimes(1);
  const a=await f.web.fetch({url:'https://example.com/article',maxChars:500},signal());expect(a.truncated).toBe(true);expect(a.cached).toBe(false);expect(f.wait).toHaveBeenCalled();
  const b=await f.web.fetch({url:'https://example.com/article#anchor',maxChars:1000},signal());expect(b.cached).toBe(true);expect(b.truncated).toBe(false);expect(b.capturedAt).toBe(a.capturedAt);expect(f.read).toHaveBeenCalledTimes(2);
  f.advance(300001);expect((await f.web.fetch({url:'https://example.com/article'},signal())).cached).toBe(false);expect(f.read).toHaveBeenCalledTimes(4);
});
it('跳转到私网前拒绝；新域名重新校验 robots；robots 不可用不抓正文',async()=>{
  const f=service({'/robots.txt':{status:404},'/start':{status:302,headers:{location:'http://169.254.169.254/'}}});
  await expect(f.web.fetch({url:'https://example.com/start'},signal())).rejects.toMatchObject({code:'WEB_SSRF'});expect(f.read).toHaveBeenCalledTimes(2);
  const g=service({'/robots.txt':{body:'User-agent: *\nDisallow: /blocked'},'/start':{status:302,headers:{location:'https://other.example/blocked'}}});
  await expect(g.web.fetch({url:'https://example.com/start'},signal())).rejects.toThrow('WEB_ROBOTS');expect(g.read.mock.calls.map(args=>args[0])).toEqual(['https://example.com/robots.txt','https://example.com/start','https://other.example/robots.txt']);
  const h=service({'/robots.txt':{status:503}});await expect(h.web.fetch({url:'https://example.com/'},signal())).rejects.toThrow('WEB_ROBOTS');expect(h.read).toHaveBeenCalledTimes(1);
});
it.each([[401,'','WEB_LOGIN'],[403,'','WEB_ACCESS'],[404,'','WEB_HTTP_4XX'],[503,'','WEB_HTTP_5XX'],[429,'','WEB_RATE_LIMIT'],[200,'<input type="password">','WEB_LOGIN'],[200,'<title>Just a moment...</title>','WEB_ANTIBOT'],[200,'<script>load()</script>','WEB_CONTENT_EMPTY']] as const)('准确分类来源失败 %s %s',async(code,body,error)=>{
  const f=service({'/robots.txt':{status:404},'/':{status:code,body}});await expect(f.web.fetch({url:'https://example.com/'},signal())).rejects.toThrow(error);
});
it('搜索固定 API 与凭据头，结果有界、过滤非公开 URL，错误不泄露密钥',async()=>{
  const read=vi.fn(async()=>({status:200,headers:{},body:JSON.stringify({web:{results:[{title:'标题',url:'https://example.com',description:'<b>摘要</b>'},{title:'内网',url:'http://127.0.0.1'}]}})}));
  const service=new WebService({resolve:()=> 'private-key'},{read});
  const result=await service.search({query:'建筑',count:2},signal());expect(result.results).toEqual([{title:'标题',url:'https://example.com/',snippet:'摘要'}]);
  const args=read.mock.calls[0] as unknown as [string,AbortSignal,{headers:Record<string,string>}];expect(new URL(args[0]).hostname).toBe('api.search.brave.com');expect(args[2].headers['X-Subscription-Token']).toBe('private-key');expect(JSON.stringify(result)).not.toContain('private-key');
  read.mockResolvedValue({status:401,headers:{},body:'private-key'});await expect(service.search({query:'x'},signal())).rejects.toThrow('WEB_SEARCH_AUTH');
});
it('首个正文也遵守 crawl-delay，过长规则拒绝；API 跳转不携带密钥继续请求',async()=>{
  const f=service({'/robots.txt':{body:'User-agent: *\nCrawl-delay: 3'},'/':{body:'<p>正文</p>'}});await f.web.fetch({url:'https://example.com/'},signal());expect(f.wait).toHaveBeenCalledWith(3000,expect.anything());
  const g=service({'/robots.txt':{body:'User-agent: *\nCrawl-delay: 10'}});await expect(g.web.fetch({url:'https://example.com/'},signal())).rejects.toThrow('WEB_RATE_LIMIT');expect(g.read).toHaveBeenCalledTimes(1);
  const read=vi.fn(async()=>({status:302,headers:{location:'https://other.example'},body:''}));await expect(new WebService({resolve:()=> 'private-key'},{read}).search({query:'x'},signal())).rejects.toThrow('WEB_REDIRECT');expect(read).toHaveBeenCalledTimes(1);
});
it('工具严格输入、有界输出、只读分类且只调用一次，取消不返回结果',async()=>{
  const fetch=vi.fn(async()=>({url:'https://example.com/',title:'标题',markdown:'正文',truncated:false,cached:false,capturedAt:new Date().toISOString(),untrusted:true as const}));
  const tools=new WebTools({fetch,search:vi.fn()},'workspace');expect(tools.describe('cbim_web_fetch',{url:'https://example.com'})).toMatchObject({effects:['read'],native:false});
  expect(()=>tools.describe('cbim_web_fetch',{url:'https://example.com',headers:{Cookie:'secret'}})).toThrow();
  await tools.call('cbim_web_fetch',{url:'https://example.com'},signal());expect(fetch).toHaveBeenCalledTimes(1);
  const controller=new AbortController();controller.abort();await expect(tools.call('cbim_web_fetch',{url:'https://example.com'},controller.signal)).rejects.toThrow();expect(fetch).toHaveBeenCalledTimes(1);
});
