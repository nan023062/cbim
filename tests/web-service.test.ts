import {expect,it,vi} from 'vitest';
import http from 'node:http';
import {WebService} from '../src/backend/main/web/web-service';

const signal=()=>new AbortController().signal;
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
