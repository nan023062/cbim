import {expect,it,vi} from 'vitest';
import {WebPageReader,type BrowserReader,type BrowserPage,type PublicHttpResponse} from '../src/foundations/web';
import {WebService} from '../src/backend/main/web/web-service';

const signal=()=>new AbortController().signal;
const page:BrowserPage={url:'https://example.com/',title:'Rendered',markdown:'动态正文',truncated:false};
function fixture(body='<script>load()</script>',status=200){
  const read=vi.fn(async(url:string):Promise<PublicHttpResponse>=>({status:url.endsWith('/robots.txt')?404:status,headers:{'content-type':'text/html'},body:url.endsWith('/robots.txt')?'':body}));
  const render=vi.fn<BrowserReader['read']>(async(url,active,authorize)=>{await authorize(url,active);return {...page}});
  const timing={now:()=>Date.now(),wait:async()=>{},interval:0};
  const reader=new WebPageReader({read},timing,{read:render});
  return {read,render,reader,timing};
}
it.each(['<script>load()</script>','<p>Sign in</p><iframe src="/game"></iframe>','<p>Loading...</p><script>load()</script>'])('空正文或动态外壳仅兜底一次并缓存真实正文 %s',async html=>{
  const f=fixture(html),first=await f.reader.fetch({url:page.url},signal());
  expect(first).toMatchObject({markdown:page.markdown,cached:false});expect(f.render).toHaveBeenCalledTimes(1);
  const second=await f.reader.fetch({url:page.url},signal());expect(second).toMatchObject({cached:true,capturedAt:first.capturedAt});expect(f.render).toHaveBeenCalledTimes(1);
});
it.each([401,403,404,500])('静态 HTTP %s 可由一次匿名浏览器核实，不直接判私有',async code=>{
  const f=fixture('',code);expect((await f.reader.fetch({url:page.url},signal())).markdown).toBe(page.markdown);expect(f.render).toHaveBeenCalledTimes(1);
});
it('网络失败触发兜底；普通静态正文不启动浏览器',async()=>{
  const f=fixture('<main>静态正文</main>');await f.reader.fetch({url:page.url},signal());expect(f.render).not.toHaveBeenCalled();
  const g=fixture();g.read.mockImplementation(async url=>{if(!url.endsWith('/robots.txt'))throw Error('WEB_NETWORK: 连接失败');return {status:404,headers:{},body:''}});
  expect((await g.reader.fetch({url:page.url},signal())).markdown).toBe(page.markdown);
});
it.each(['WEB_SSRF','WEB_ROBOTS','WEB_RATE_LIMIT','WEB_ANTIBOT','WEB_SIZE','WEB_REDIRECT'])('%s 拒绝不启动浏览器',async code=>{
  const f=fixture();f.read.mockImplementation(async url=>{if(url.endsWith('/robots.txt'))return {status:404,headers:{},body:''};throw Error(code+': 拒绝')});
  await expect(f.reader.fetch({url:page.url},signal(),{browserRobotsPolicy:'respect'})).rejects.toThrow(code);expect(f.render).not.toHaveBeenCalled();
});
it('robots 失败和非法 URL 不因浏览器可用而放行',async()=>{
  const f=fixture();f.read.mockResolvedValue({status:503,headers:{},body:''});
  await expect(f.reader.fetch({url:page.url},signal(),{browserRobotsPolicy:'respect'})).rejects.toThrow('WEB_ROBOTS');
  await expect(f.reader.fetch({url:'http://127.0.0.1/'},signal())).rejects.toMatchObject({code:'WEB_SSRF'});expect(f.render).not.toHaveBeenCalled();
});
it('浏览器框架授权复用 robots，取消后丢弃迟到结果且不缓存',async()=>{
  const f=fixture();f.read.mockImplementation(async url=>({status:url.endsWith('/robots.txt')?200:200,headers:{'content-type':'text/html'},body:url.endsWith('/robots.txt')?'User-agent: *\nDisallow: /private':'<script>x()</script>'}));
  f.render.mockImplementation(async(_url,active,authorize)=>{await authorize('https://other.example/private',active);return page});
  await expect(f.reader.fetch({url:page.url},signal(),{browserRobotsPolicy:'respect'})).rejects.toThrow('WEB_ROBOTS');expect(f.render).toHaveBeenCalledTimes(1);
  const g=fixture(),controller=new AbortController();g.render.mockImplementation(async()=>{controller.abort();return page});
  await expect(g.reader.fetch({url:page.url},controller.signal)).rejects.toThrow();
  g.render.mockResolvedValue(page);expect((await g.reader.fetch({url:page.url},signal())).cached).toBe(false);
});
it('取消静态阶段不启动兜底；浏览器失败保留两阶段原因而不循环',async()=>{
  const f=fixture(),controller=new AbortController();controller.abort();
  await expect(f.reader.fetch({url:page.url},controller.signal)).rejects.toThrow();expect(f.render).not.toHaveBeenCalled();
  f.render.mockRejectedValue(Error('WEB_BROWSER_TIMEOUT: 加载未完成'));
  await expect(f.reader.fetch({url:page.url},signal())).rejects.toThrow(/WEB_BROWSER_TIMEOUT.*WEB_CONTENT_EMPTY/);expect(f.render).toHaveBeenCalledTimes(1);
});
it('浏览器的空正文仍报告空正文；缓存保留浏览器截断标记',async()=>{
  const f=fixture();f.render.mockResolvedValue({...page,markdown:''});
  await expect(f.reader.fetch({url:page.url},signal())).rejects.toThrow('WEB_CONTENT_EMPTY');
  f.render.mockResolvedValue({...page,markdown:'😀'.repeat(1000),truncated:true});
  const first=await f.reader.fetch({url:page.url,maxChars:500},signal());expect(Array.from(first.markdown)).toHaveLength(500);expect(first.truncated).toBe(true);
  expect((await f.reader.fetch({url:page.url,maxChars:20000},signal())).truncated).toBe(true);
});
it('CBIM 适配层添加不可信标记，基础读取器不认识业务工具协议',async()=>{
  const f=fixture();const service=new WebService({resolve:()=>''},{read:f.read},f.timing,{read:f.render});
  expect(await service.fetch({url:page.url},signal())).toMatchObject({markdown:page.markdown,untrusted:true});
  expect(await f.reader.fetch({url:page.url},signal())).not.toHaveProperty('untrusted');
});
it('默认允许浏览器读取 robots 禁止的正文；切回 respect 不复用宽松缓存',async()=>{
  const f=fixture();f.read.mockResolvedValue({status:200,headers:{'content-type':'text/plain'},body:'User-agent: *\nDisallow: /'});
  expect((await f.reader.fetch({url:page.url},signal())).markdown).toBe(page.markdown);
  expect(f.render).toHaveBeenCalledTimes(1);
  await expect(f.reader.fetch({url:page.url},signal(),{browserRobotsPolicy:'respect'})).rejects.toThrow('WEB_ROBOTS');
  expect(f.render).toHaveBeenCalledTimes(1);
  expect((await f.reader.fetch({url:page.url},signal())).cached).toBe(true);
});
it('允许模式仍在浏览器每个请求前拒绝私网；非法策略拒绝',async()=>{
  const f=fixture();f.render.mockImplementation(async(_url,active,authorize)=>{await authorize('http://127.0.0.1/',active,false);return page});
  await expect(f.reader.fetch({url:page.url},signal())).rejects.toThrow('WEB_SSRF');
  await expect(f.reader.fetch({url:page.url},signal(),{browserRobotsPolicy:'invalid' as any})).rejects.toThrow();
});
it('业务配置变更只影响后续读取；读取期间使用已捕获策略',async()=>{
  const f=fixture();let policy:'allow'|'respect'='allow';
  const service=new WebService({resolve:()=>'',read:()=>({revision:1,provider:'brave',enabled:false,hasKey:false,secureStorage:false,browserRobotsPolicy:policy})},{read:f.read},f.timing,{read:f.render});
  f.read.mockResolvedValue({status:200,headers:{},body:'User-agent: *\nDisallow: /'});
  f.render.mockImplementation(async(url,active,authorize)=>{policy='respect';await authorize(url,active);return page});
  expect((await service.fetch({url:page.url},signal())).markdown).toBe(page.markdown);
  await expect(service.fetch({url:page.url},signal())).rejects.toThrow('WEB_ROBOTS');
});
