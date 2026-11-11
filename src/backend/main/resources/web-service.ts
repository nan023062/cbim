/**
 * 作用定位：网页工具的 robots、域名节流、短缓存与 Brave API 适配。
 * 设计原因：网络机制由 PublicHttp 固定地址；这里逐跳执行抓取规则，缓存只存公开正文，搜索密钥只发往固定 API 且不跟随跳转。
 */
import robotsParser from 'robots-parser';
import {setTimeout as delay} from 'node:timers/promises';
import {z} from 'zod';
import {webFetchInput,webSearchInput,type WebToolsPort} from '../../core/connectors/web-tools';
import {PublicHttp,publicUrl,type PublicHttpResponse} from '../platform/public-http';
import {htmlMarkdown,truncateParagraphs} from './web-content';
import type {WebSettings} from '../persistence/settings/web-settings';
const ttl=5*60*1000,ua='CBIMBot/0.1';
const resultsSchema=z.object({web:z.object({results:z.array(z.object({title:z.string(),url:z.string(),description:z.string().optional()}))}).optional()});
function status(response:PublicHttpResponse){
  if(response.status===401||response.status===407)throw Error('WEB_LOGIN: 该来源需要登录或认证');
  if(response.status===403)throw Error('WEB_ACCESS: 访问被拒绝，可能存在反爬限制或权限要求');
  if(response.status===429)throw Error('WEB_RATE_LIMIT: 来源限流，请稍后重试');
  if(response.status>=400)throw Error(`WEB_HTTP_${response.status<500?'4XX':'5XX'}: 来源返回 HTTP ${response.status}`);
  if(response.status<200||response.status>=300)throw Error('WEB_REDIRECT: 来源跳转未获允许');
}
/** 全应用共用有界缓存和域名时间表；时间均为毫秒，缓存过期后重新核实 robots。 */
export class WebService implements WebToolsPort {
  private readonly pages=new Map<string,{expires:number;url:string;title:string;markdown:string;capturedAt:string}>();
  private readonly robots=new Map<string,{expires:number;rules:ReturnType<typeof robotsParser>}>();
  private readonly domains=new Map<string,{last:number;next:number}>();
  constructor(private readonly settings:Pick<WebSettings,'resolve'>,private readonly client:Pick<PublicHttp,'read'>=new PublicHttp(),private readonly timing:{now():number;wait(ms:number,signal:AbortSignal):Promise<void>;interval:number}={now:()=>Date.now(),wait:(ms,signal)=>delay(ms,undefined,{signal}),interval:1000}){}
  private remember<T>(map:Map<string,T>,key:string,value:T){if(map.size>=1000&&!map.has(key))map.delete(map.keys().next().value!);map.set(key,value)}
  private async pace(url:URL,signal:AbortSignal,crawlDelay=0){
    signal.throwIfAborted();const now=this.timing.now(),previous=this.domains.get(url.hostname),next=Math.max(now,previous?.next??0,previous?previous.last+crawlDelay:0),wait=next-now;
    if(wait>5000||crawlDelay>5000)throw Error('WEB_RATE_LIMIT: 域名抓取间隔或排队超过 5 秒，请稍后重试');
    this.remember(this.domains,url.hostname,{last:next,next:next+Math.max(this.timing.interval,crawlDelay)});
    if(wait>0)await this.timing.wait(wait,signal);signal.throwIfAborted();
  }
  private async allowed(url:URL,signal:AbortSignal){
    let entry=this.robots.get(url.origin);
    if(!entry||entry.expires<=this.timing.now()){
      const robotsUrl=new URL('/robots.txt',url);await this.pace(robotsUrl,signal);
      const response=await this.client.read(robotsUrl.href,signal);
      // robots 重定向及不可用均不猜测允许；404/410 明确无规则。
      if(response.status!==404&&response.status!==410&&(response.status<200||response.status>=300))throw Error('WEB_ROBOTS: 无法确认来源 robots 规则，未读取正文');
      entry={expires:this.timing.now()+ttl,rules:robotsParser(robotsUrl.href,[404,410].includes(response.status)?'':response.body)};
      this.remember(this.robots,url.origin,entry);
    }
    if(entry.rules.isAllowed(url.href,ua)===false)throw Error('WEB_ROBOTS: 来源 robots 禁止读取该页面');
    return (entry.rules.getCrawlDelay(ua)??0)*1000;
  }
  /** 每跳先校验 URL、robots 和限速；最多 5 次跳转，整体 30 秒。命中缓存也标明原采集时间。 */
  async fetch(raw:Parameters<WebToolsPort['fetch']>[0],signal:AbortSignal){
    const input=webFetchInput.parse(raw),initial=publicUrl(input.url),deadline=AbortSignal.any([signal,AbortSignal.timeout(30000)]),key=initial.href;
    deadline.throwIfAborted();const cached=this.pages.get(key);
    if(cached&&cached.expires>this.timing.now()){const {url,title,markdown,capturedAt}=cached;return {url,title,...truncateParagraphs(markdown,input.maxChars??12000),capturedAt,cached:true,untrusted:true as const}}
    let url=initial;
    for(let hop=0;hop<=5;hop++){
      const crawlDelay=await this.allowed(url,deadline);await this.pace(url,deadline,crawlDelay);
      const response=await this.client.read(url.href,deadline);deadline.throwIfAborted();
      if([301,302,303,307,308].includes(response.status)){
        if(hop===5||!response.headers.location)throw Error('WEB_REDIRECT: 网页跳转过多或缺少地址');
        url=publicUrl(new URL(response.headers.location,url).href);continue;
      }
      status(response);
      const type=(response.headers['content-type']??'').toLowerCase();
      if(!/^(text\/html|application\/xhtml\+xml|text\/plain|text\/markdown)(;|$)/.test(type))throw Error('WEB_CONTENT_TYPE: 仅支持 HTML、纯文本和 Markdown 网页');
      if(/charset\s*=/.test(type)&&!/charset\s*=\s*["']?(utf-8|utf8|us-ascii)/.test(type))throw Error('WEB_ENCODING: 当前仅支持 UTF-8 网页');
      const content=type.includes('html')?htmlMarkdown(response.body,url.href):{title:'',markdown:response.body,login:false,challenge:false};
      if(content.challenge)throw Error('WEB_ANTIBOT: 来源要求验证码或浏览器挑战，未尝试绕过');
      if(content.login)throw Error('WEB_LOGIN: 来源呈现登录表单，未取得公开正文');
      if(!content.markdown.trim())throw Error('WEB_CONTENT_EMPTY: 未取得可读正文，页面可能依赖脚本');
      const page={expires:this.timing.now()+ttl,url:url.href,title:content.title,markdown:content.markdown,capturedAt:new Date(this.timing.now()).toISOString()};
      // 每项正文最多 1 MiB；最多缓存 30 项，避免持有大量第三方页面。
      if(this.pages.size>=30)this.pages.delete(this.pages.keys().next().value!);this.pages.set(key,page);
      return {url:page.url,title:page.title,...truncateParagraphs(page.markdown,input.maxChars??12000),capturedAt:page.capturedAt,cached:false,untrusted:true as const};
    }
    throw Error('WEB_REDIRECT: 网页跳转过多');
  }
  /** Brave 是固定查询 API，不执行 robots 抓取；凭据不会进入错误或结果，不跟随 API 跳转。 */
  async search(raw:Parameters<WebToolsPort['search']>[0],signal:AbortSignal){
    const input=webSearchInput.parse(raw),key=this.settings.resolve(),url=new URL('https://api.search.brave.com/res/v1/web/search');
    url.searchParams.set('q',input.query);url.searchParams.set('count',String(input.count??5));
    await this.pace(url,signal);
    const response=await this.client.read(url.href,signal,{headers:{'X-Subscription-Token':key,'Accept':'application/json'}});signal.throwIfAborted();
    if([401,403].includes(response.status))throw Error('WEB_SEARCH_AUTH: Brave 搜索认证失败，请在设置中核实密钥与订阅权限');
    status(response);
    let data:z.infer<typeof resultsSchema>;try{data=resultsSchema.parse(JSON.parse(response.body))}catch{throw Error('WEB_SEARCH_RESPONSE: 搜索服务返回格式无效')}
    const results=(data.web?.results??[]).flatMap(item=>{try{const url=publicUrl(item.url);return [{title:item.title.slice(0,500),url:url.href,snippet:(item.description??'').replace(/<[^>]+>/g,'').slice(0,2000)}]}catch{return []}}).slice(0,input.count??5);
    return {provider:'brave' as const,query:input.query,results,untrusted:true as const};
  }
}
