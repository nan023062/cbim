/**
 * 作用定位：将基础网页读取方案适配到 CBIM 工具协议，并连接用户配置的 Brave 搜索。
 * 设计原因：网页抓取与渲染在 foundations 内闭合；本层只处理业务配置和不可信资料标记。
 */
import {setTimeout as delay} from 'node:timers/promises';
import {z} from 'zod';
import {webFetchInput,webSearchInput,type WebToolsPort} from '../../core/connectors/web-tools';
import {WebPageReader,PublicHttp,publicUrl,type BrowserReader} from '../../../foundations/web';
import type {WebSettings} from '../settings/web-settings';
const resultsSchema=z.object({web:z.object({results:z.array(z.object({title:z.string(),url:z.string(),description:z.string().optional()}))}).optional()});
/** 应用级配置适配；页面缓存属于 WebPageReader，搜索节流只针对固定 Brave API。 */
export class WebService implements WebToolsPort {
  private readonly pages:WebPageReader;
  private nextSearchAt=0;
  constructor(
    private readonly settings:Pick<WebSettings,'resolve'> & Partial<Pick<WebSettings,'read'>>,
    private readonly client:Pick<PublicHttp,'read'>=new PublicHttp(undefined,'CBIMBot/0.1'),
    private readonly timing:{now():number;wait(ms:number,signal:AbortSignal):Promise<void>;interval:number}={now:()=>Date.now(),wait:(ms,signal)=>delay(ms,undefined,{signal}),interval:1000},
    browser?:BrowserReader,
  ){
    this.pages=new WebPageReader(client,timing,browser,'CBIMBot/0.1');
  }
  /** 每次读取捕获已保存策略；基础类库按策略分隔缓存，搜索开关不影响正文读取。 */
  async fetch(raw:Parameters<WebToolsPort['fetch']>[0],signal:AbortSignal){
    const browserRobotsPolicy=this.settings.read?.().browserRobotsPolicy??'allow';
    const page=await this.pages.fetch(webFetchInput.parse(raw),signal,{browserRobotsPolicy});
    return {...page,untrusted:true as const};
  }
  private async pace(_url:URL,signal:AbortSignal){
    signal.throwIfAborted();const now=this.timing.now(),next=Math.max(now,this.nextSearchAt);
    if(next-now>5000)throw Error('WEB_RATE_LIMIT: 搜索排队超过 5 秒，请稍后重试');
    this.nextSearchAt=next+this.timing.interval;
    if(next>now)await this.timing.wait(next-now,signal);
    signal.throwIfAborted();
  }
  /** Brave 是固定查询 API，不执行 robots 抓取；凭据不会进入错误或结果，不跟随 API 跳转。 */
  async search(raw:Parameters<WebToolsPort['search']>[0],signal:AbortSignal){
    const input=webSearchInput.parse(raw),key=this.settings.resolve(),url=new URL('https://api.search.brave.com/res/v1/web/search');
    url.searchParams.set('q',input.query);url.searchParams.set('count',String(input.count??5));
    await this.pace(url,signal);
    const response=await this.client.read(url.href,signal,{headers:{'X-Subscription-Token':key,'Accept':'application/json'}});signal.throwIfAborted();
    if([401,403].includes(response.status))throw Error('WEB_SEARCH_AUTH: Brave 搜索认证失败，请在设置中核实密钥与订阅权限');
    if(response.status===429)throw Error('WEB_RATE_LIMIT: 搜索服务限流，请稍后重试');
    if(response.status>=400)throw Error(`WEB_HTTP_${response.status<500?'4XX':'5XX'}: 搜索返回 HTTP ${response.status}`);
    if(response.status<200||response.status>=300)throw Error('WEB_REDIRECT: 搜索服务跳转未获允许');
    let data:z.infer<typeof resultsSchema>;try{data=resultsSchema.parse(JSON.parse(response.body))}catch{throw Error('WEB_SEARCH_RESPONSE: 搜索服务返回格式无效')}
    const results=(data.web?.results??[]).flatMap(item=>{try{const url=publicUrl(item.url);return [{title:item.title.slice(0,500),url:url.href,snippet:(item.description??'').replace(/<[^>]+>/g,'').slice(0,2000)}]}catch{return []}}).slice(0,input.count??5);
    return {provider:'brave' as const,query:input.query,results,untrusted:true as const};
  }
}
