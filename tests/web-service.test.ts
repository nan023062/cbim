import {expect,it,vi} from 'vitest';
import {WebService} from '../src/logic/web/service';
const signal=()=>new AbortController().signal;
it('每次读取捕获 robots 策略，转发取消信号并标注外部资料',async()=>{
  let policy:'allow'|'respect'='allow';
  const fetch=vi.fn(async()=>({url:'https://example.com/',title:'正文',markdown:'外部正文',truncated:false,cached:false,capturedAt:'2026-11-13T00:00:00.000Z'}));
  const settings={resolve:vi.fn(()=>{throw Error('不应读取搜索密钥')}),read:()=>({revision:1,provider:'brave' as const,enabled:false,hasKey:false,secureStorage:false,browserRobotsPolicy:policy})};
  const service=new WebService(settings,undefined,undefined,undefined,{fetch}),active=signal();
  expect(await service.fetch({url:'https://example.com/'},active)).toMatchObject({markdown:'外部正文',untrusted:true});
  expect(fetch).toHaveBeenLastCalledWith({url:'https://example.com/'},active,{browserRobotsPolicy:'allow'});
  policy='respect';await service.fetch({url:'https://example.com/'},active);
  expect(fetch).toHaveBeenLastCalledWith({url:'https://example.com/'},active,{browserRobotsPolicy:'respect'});
  expect(settings.resolve).not.toHaveBeenCalled();
});
it('缺省策略保持 allow，校验失败不调用读取器，原读取错误不改写为登录失败',async()=>{
  const error=Error('WEB_BROWSER_TIMEOUT: 渲染未完成'),fetch=vi.fn(async()=>{throw error});
  const service=new WebService({resolve:()=>''},undefined,undefined,undefined,{fetch}),active=signal();
  await expect(service.fetch({url:'invalid'},active)).rejects.toThrow();expect(fetch).not.toHaveBeenCalled();
  await expect(service.fetch({url:'https://example.com/'},active)).rejects.toBe(error);
  expect(fetch).toHaveBeenCalledWith({url:'https://example.com/'},active,{browserRobotsPolicy:'allow'});
});
it('搜索固定 API 与凭据头，结果有界、过滤非公开 URL，错误不泄露密钥',async()=>{
  const read=vi.fn(async()=>({status:200,headers:{},body:JSON.stringify({web:{results:[{title:'标题',url:'https://example.com',description:'<b>摘要</b>'},{title:'内网',url:'http://127.0.0.1'}]}})}));
  const service=new WebService({resolve:()=> 'private-key'},{read});
  const result=await service.search({query:'建筑',count:2},signal());expect(result.results).toEqual([{title:'标题',url:'https://example.com/',snippet:'摘要'}]);
  const args=read.mock.calls[0] as unknown as [string,AbortSignal,{headers:Record<string,string>}];expect(new URL(args[0]).hostname).toBe('api.search.brave.com');expect(args[2].headers['X-Subscription-Token']).toBe('private-key');expect(JSON.stringify(result)).not.toContain('private-key');
  read.mockResolvedValue({status:401,headers:{},body:'private-key'});await expect(service.search({query:'x'},signal())).rejects.toThrow('WEB_SEARCH_AUTH');
});
it('API 跳转不携带密钥继续请求',async()=>{
  const read=vi.fn(async()=>({status:302,headers:{location:'https://other.example'},body:''}));await expect(new WebService({resolve:()=> 'private-key'},{read}).search({query:'x'},signal())).rejects.toThrow('WEB_REDIRECT');expect(read).toHaveBeenCalledTimes(1);
});
