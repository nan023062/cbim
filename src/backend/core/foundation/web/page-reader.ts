/**
 * 目录归属：foundations/web；独立网页读取方案。
 * 作用定位：静态正文、一次浏览器兜底、robots、域名节流与短缓存。
 * 设计原因：传输由 PublicHttp 固定地址，渲染经 BrowserReader 注入；不认识 Agent、业务配置或应用生命周期。
 */
import robotsParser from 'robots-parser';
import {setTimeout as delay} from 'node:timers/promises';
import {pageReadInput,browserRobotsPolicy,type PageReadInput,type BrowserRobotsPolicy} from './contracts';
import {PublicHttp,publicUrl,type PublicHttpResponse} from './public-http';
import {htmlMarkdown,truncateParagraphs} from './web-content';
import type {BrowserReader} from './browser-reader';
const ttl=5*60*1000;
function status(response:PublicHttpResponse){
  if(response.status===401||response.status===407)throw Error('WEB_LOGIN: 该来源需要登录或认证');
  if(response.status===403)throw Error('WEB_ACCESS: 访问被拒绝，可能存在反爬限制或权限要求');
  if(response.status===429)throw Error('WEB_RATE_LIMIT: 来源限流，请稍后重试');
  if(response.status>=400)throw Error(`WEB_HTTP_${response.status<500?'4XX':'5XX'}: 来源返回 HTTP ${response.status}`);
  if(response.status<200||response.status>=300)throw Error('WEB_REDIRECT: 来源跳转未获允许');
}
/** 每个读取器独占有界缓存和域名时间表；时间均为毫秒，缓存过期后重新核实 robots。 */
export class WebPageReader {
  private readonly pages=new Map<string,{expires:number;url:string;title:string;markdown:string;capturedAt:string;truncated:boolean}>();
  private readonly robots=new Map<string,{expires:number;rules:ReturnType<typeof robotsParser>}>();
  private readonly domains=new Map<string,{last:number;next:number}>();
  constructor(private readonly client:Pick<PublicHttp,'read'>=new PublicHttp(),private readonly timing:{now():number;wait(ms:number,signal:AbortSignal):Promise<void>;interval:number}={now:()=>Date.now(),wait:(ms,signal)=>delay(ms,undefined,{signal}),interval:1000},private readonly browser?:BrowserReader,private readonly userAgent='PublicWebReader/1.0'){}
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
    if(entry.rules.isAllowed(url.href,this.userAgent)===false)throw Error('WEB_ROBOTS: 来源 robots 禁止读取该页面');
    return (entry.rules.getCrawlDelay(this.userAgent)??0)*1000;
  }
  /** 每次捕获宿主 robots 策略，默认允许浏览器读取。策略分隔缓存；取消、公网和限流边界不变。 */
  async fetch(raw:PageReadInput,signal:AbortSignal,options:{browserRobotsPolicy?:BrowserRobotsPolicy}={}){
    const policy=browserRobotsPolicy.parse(options.browserRobotsPolicy??'allow');
    try{return await this.fetchStatic(raw,signal,policy)}catch(error){
      signal.throwIfAborted();
      const reason=error instanceof Error?error.message:String(error);
      const recoverable=/^WEB_(NETWORK|DNS|ABORTED|HTTP_4XX|HTTP_5XX|ACCESS|LOGIN|CONTENT_EMPTY|CONTENT|ENCODING|CONTENT_TYPE|BROWSER_REQUIRED):/.test(reason);
      if(!this.browser||!(recoverable||policy==='allow'&&reason.startsWith('WEB_ROBOTS:')))throw error;
      const input=pageReadInput.parse(raw),initial=publicUrl(input.url);
      try{
        const page=await this.browser.read(initial.href,signal,async(raw,active,document=true)=>{
          active.throwIfAborted();
          const url=publicUrl(raw),crawlDelay=policy==='respect'?await this.allowed(url,active):0;
          if(document)await this.pace(url,active,crawlDelay);
        });
        signal.throwIfAborted();publicUrl(page.url);
        if(!page.markdown.trim())throw Error('WEB_CONTENT_EMPTY: 浏览器未取得可读正文，不能据此认定需要登录');
        const capturedAt=new Date(this.timing.now()).toISOString();
        if(this.pages.size>=30)this.pages.delete(this.pages.keys().next().value!);
        this.pages.set(`${policy}:${initial.href}`,{...page,capturedAt,expires:this.timing.now()+ttl});
        const content=truncateParagraphs(page.markdown,input.maxChars??12000);
        return {url:page.url,title:page.title,...content,truncated:page.truncated||content.truncated,capturedAt,cached:false};
      }catch(failure){
        signal.throwIfAborted();
        throw Error(`${failure instanceof Error?failure.message:String(failure)}；静态读取失败：${reason}`,{cause:failure});
      }
    }
  }
  /** 静态读取本身不启动浏览器；只有 fetch 的单一出口决定是否兜底，避免循环重试。 */
  private async fetchStatic(raw:PageReadInput,signal:AbortSignal,policy:BrowserRobotsPolicy){
    const input=pageReadInput.parse(raw),initial=publicUrl(input.url),deadline=AbortSignal.any([signal,AbortSignal.timeout(30000)]),key=`${policy}:${initial.href}`;
    deadline.throwIfAborted();const cached=this.pages.get(key);
    if(cached&&cached.expires>this.timing.now()){const {url,title,markdown,capturedAt}=cached,content=truncateParagraphs(markdown,input.maxChars??12000);return {url,title,...content,truncated:cached.truncated||content.truncated,capturedAt,cached:true}}
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
      // 非空外壳也可能缺少主要内容；短正文加脚本仅触发一次渲染，不据此认定页面私有或需要登录。
      if(this.browser&&type.includes('html')&&(/<iframe\b/i.test(response.body)||/<script\b/i.test(response.body)&&Array.from(content.markdown).length<200))throw Error('WEB_BROWSER_REQUIRED: 页面含嵌入内容或动态外壳，需要浏览器读取');
      const page={expires:this.timing.now()+ttl,url:url.href,title:content.title,markdown:content.markdown,capturedAt:new Date(this.timing.now()).toISOString(),truncated:false};
      // 每项正文最多 1 MiB；最多缓存 30 项，避免持有大量第三方页面。
      if(this.pages.size>=30)this.pages.delete(this.pages.keys().next().value!);this.pages.set(key,page);
      return {url:page.url,title:page.title,...truncateParagraphs(page.markdown,input.maxChars??12000),capturedAt:page.capturedAt,cached:false};
    }
    throw Error('WEB_REDIRECT: 网页跳转过多');
  }
}
