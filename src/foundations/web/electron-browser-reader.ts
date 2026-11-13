/**
 * 作用定位：基础网页能力的 Electron/Chromium 适配，采集脚本执行后的正文及跨域 iframe。
 * 设计原因：独立内存会话与无 Node/preload 的隐藏窗口隔离第三方页面；所有 HTTP 资源经 PublicHttp
 * 固定公网 DNS 地址，浏览器自身网络使用不可达代理，防止兜底绕开 SSRF、读取本机登录态或写请求限制。
 * 生命周期：最多两个并行读取，每次至多 30 秒；结束销毁窗口、取消请求并清空会话，不自动登录或操作网页。
 */
import {BrowserWindow,session} from 'electron';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {z} from 'zod';
import {PublicHttp,publicUrl} from './public-http';
import type {BrowserReader,BrowserPage} from './browser-reader';

// 固定脚本读取可见 DOM；返回值始终不可信，不插入模型生成的代码，不点击、不提交表单。
const snapshotScript=`(() => {
  const root=document.querySelector('article') || document.querySelector('main') || document.body;
  const visible=node=>!!node.getClientRects().length && getComputedStyle(node).visibility!=='hidden';
  const password=Array.from(document.querySelectorAll('input[type="password"]')).some(visible);
  let text='',count=0,cut=false;
  if(root){
    const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
    while(walker.nextNode()){
      if(++count>50000){cut=true;break}
      const node=walker.currentNode,parent=node.parentElement;
      if(!parent || parent.closest('script,style,nav,header,footer,form,input,select,noscript,[hidden],[aria-hidden="true"]') || !visible(parent))continue;
      const value=node.textContent.trim();
      if(value)text+=value+'\\n';
      if(text.length>40000){text=text.slice(0,40000);cut=true;break}
    }
  }
  return {title:document.title.slice(0,500),text,cut,password,ready:document.readyState==='complete',
    challenge:!!document.querySelector('#cf-challenge-running,#challenge-form,.g-recaptcha') || /^(just a moment|access denied|attention required)/i.test(document.title)};
})()`;
const frameSnapshot=z.object({title:z.string().max(500),text:z.string().max(40000),cut:z.boolean(),password:z.boolean(),ready:z.boolean(),challenge:z.boolean()});
const blockedHeaders=new Set(['set-cookie','content-length','content-encoding','transfer-encoding','connection','keep-alive','alt-svc','clear-site-data']);
const policy="default-src http: https: data: blob: 'unsafe-inline' 'unsafe-eval'; connect-src http: https:; object-src 'none'; worker-src 'none'; form-action 'none'";

/** 由 Electron ready 后的桌面入口创建；不会被 CLI、模型工具参数或前端直接构造。 */
export class ElectronBrowserReader implements BrowserReader {
  private readonly prefix=`public-web-${randomUUID()}`;
  private readonly busy=new Set<number>();
  constructor(private readonly client:Pick<PublicHttp,'readBytes'>=new PublicHttp()){}

  /** 独占匿名会话。所有 HTTP 资源逐次 authorize，文档额外节流；只允许 GET，不承诺 canvas 像素识别。 */
  async read(raw:string,signal:AbortSignal,authorize:(url:string,signal:AbortSignal,document?:boolean)=>Promise<void>):Promise<BrowserPage>{
    const url=publicUrl(raw);signal.throwIfAborted();
    const slot=[0,1].find(value=>!this.busy.has(value));
    if(slot===undefined)throw Error('WEB_BROWSER_BUSY: 浏览器读取已达并发上限，请稍后再试');
    this.busy.add(slot);
    const stop=new AbortController(),active=AbortSignal.any([signal,stop.signal,AbortSignal.timeout(30000)]);
    const ses=session.fromPartition(`${this.prefix}-${slot}`,{cache:false});
    let window:BrowserWindow|undefined,requests=0,bytes=0,pending=0,navigations=0;
    let documentFailure:Error|undefined;
    let authorization=Promise.resolve();
    const inflight=new Set<Promise<unknown>>();
    const preventDownload=(event:Electron.Event)=>event.preventDefault();
    const destroy=()=>{if(window&&!window.isDestroyed())window.destroy()};
    const track=<T>(operation:Promise<T>)=>{inflight.add(operation);void operation.then(()=>inflight.delete(operation),()=>inflight.delete(operation));return operation};
    const aborted=new Promise<never>((_,reject)=>{
      const abort=()=>{destroy();reject(active.reason)};
      if(active.aborted)abort();else active.addEventListener('abort',abort,{once:true});
    });
    // 立即安装处理器，setup 阶段发生取消也不会产生未处理 rejection。
    void aborted.catch(()=>{});
    try{
      await ses.setProxy({mode:'fixed_servers',proxyRules:'127.0.0.1:9',proxyBypassRules:'<-loopback>'});
      active.throwIfAborted();
      ses.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
      ses.setPermissionCheckHandler(()=>false);
      ses.on('will-download',preventDownload);
      ses.webRequest.onBeforeRequest((details,callback)=>{
        const document=details.resourceType==='mainFrame'||details.resourceType==='subFrame';
        const check=async()=>{
          active.throwIfAborted();
          if(details.url==='about:blank'||details.url==='about:srcdoc')return;
          publicUrl(details.url);
          if(details.method!=='GET')throw Error('WEB_BROWSER_METHOD: 公开网页读取不发送写请求');
        };
        void track(check()).then(()=>callback({cancel:false}),error=>{
          if(document)documentFailure??=error instanceof Error?error:Error('WEB_BROWSER_ACCESS: 嵌入页面不可读');
          callback({cancel:true});
        });
      });
      const handle=async(request:Request):Promise<Response>=>{
        const document=(request.headers.get('accept')??'').includes('text/html');
        try{
          active.throwIfAborted();publicUrl(request.url);
          if(request.method!=='GET')return new Response(null,{status:405});
          if(++requests>160)throw Error('WEB_BROWSER_LIMIT: 页面资源数量超过读取上限');
          // Electron 的 protocol.handle 不保证经过 webRequest；每次实际传输前在此授权，不能依赖前置事件。
          // Chromium 文档请求带 HTML Accept。即便无法识别资源种类，所有 URL 仍须核 robots 和固定公网 DNS。
          if(document&&++navigations>32)throw Error('WEB_BROWSER_LIMIT: 页面跳转或框架数量超过读取上限');
          const permitted=authorization.then(()=>authorize(request.url,active,document));
          authorization=permitted.catch(()=>{});
          await permitted;active.throwIfAborted();
          while(pending>=8)await delay(25,undefined,{signal:active});
          pending++;
          try{
            const result=await this.client.readBytes(request.url,active,{maxBytes:8*1024*1024,headers:{'User-Agent':ses.getUserAgent(),'Accept':'*/*'}});
            if(document&&result.status>=400)documentFailure??=Error(result.status===401?'WEB_LOGIN: 浏览器页面要求认证':`WEB_HTTP_${result.status<500?'4XX':'5XX'}: 浏览器页面返回 HTTP ${result.status}`);
            bytes+=result.body.length;
            if(bytes>32*1024*1024)throw Error('WEB_BROWSER_LIMIT: 页面资源总量超过 32 MiB');
            const headers=new Headers();
            for(const [key,value] of Object.entries(result.headers)){
              if(!blockedHeaders.has(key)&&value!==undefined)headers.set(key,Array.isArray(value)?value.join(', '):value);
            }
            headers.append('Content-Security-Policy',policy);
            return new Response([204,205,304].includes(result.status)?null:new Uint8Array(result.body),{status:result.status,headers});
          }finally{pending--}
        }catch(error){
          if(error instanceof Error&&(document||/WEB_(SSRF|ROBOTS|RATE_LIMIT|BROWSER_LIMIT)/.test(error.message)))documentFailure??=error;
          return new Response(null,{status:502});
        }
      };
      ses.protocol.handle('http',request=>track(handle(request)));
      ses.protocol.handle('https',request=>track(handle(request)));
      window=new BrowserWindow({show:false,width:1280,height:900,webPreferences:{session:ses,contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true,backgroundThrottling:false,disableDialogs:true}});
      window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
      window.webContents.setAudioMuted(true);
      window.webContents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');
      window.webContents.on('will-attach-webview',event=>event.preventDefault());
      window.webContents.on('did-frame-navigate',(_event,_url,code,_status,isMain)=>{
        if(code>=400)documentFailure??=Error(code===401?'WEB_LOGIN: 浏览器页面要求认证':`WEB_HTTP_${code<500?'4XX':'5XX'}: 浏览器${isMain?'页面':'框架'}返回 HTTP ${code}`);
      });
      const collect=async()=>{
        await window!.loadURL(url.href);
        const started=Date.now();let previous='',stableSince=started;
        while(true){
          active.throwIfAborted();
          if(documentFailure)throw documentFailure;
          const frames=window!.webContents.mainFrame.framesInSubtree;
          if(frames.length>32)throw Error('WEB_BROWSER_LIMIT: 页面框架数量超过读取上限');
          const snapshots=await Promise.all(frames.map(async frame=>{
            try{return {url:frame.url,value:frameSnapshot.parse(await frame.executeJavaScript(snapshotScript))}}
            catch{return undefined} // 框架正在换页时下一次采样；不将执行错误解释成登录要求。
          }));
          const available=snapshots.filter((item):item is NonNullable<typeof item>=>!!item);
          const text=available.map((item,index)=>`${index?'\n\n嵌入页面：'+item.url+'\n\n':''}${item.value.text}`).join('\n\n');
          const now=Date.now();if(text!==previous){previous=text;stableSince=now}
          if(now-started>=3000&&now-stableSince>=1000&&pending===0&&available.length===frames.length&&available.every(item=>item.value.ready)){
            if(available.some(item=>item.value.challenge))throw Error('WEB_ANTIBOT: 浏览器页面要求验证码或挑战，未尝试绕过');
            if(!available.some(item=>item.value.text.trim())){
              if(available.some(item=>item.value.password))throw Error('WEB_LOGIN: 浏览器仅显示登录表单，未取得正文');
              throw Error('WEB_CONTENT_EMPTY: 浏览器执行脚本后仍未取得可读正文');
            }
            const points=Array.from(text),truncated=points.length>20000||available.some(item=>item.value.cut);
            return {url:publicUrl(window!.webContents.getURL()).href,title:available[0]?.value.title??'',markdown:points.slice(0,20000).join(''),truncated};
          }
          if(now-started>10000)throw Error('WEB_BROWSER_TIMEOUT: 页面内容仍在变化或加载，未取得稳定正文');
          await delay(250,undefined,{signal:active});
        }
      };
      try{return await Promise.race([collect(),aborted])}
      catch(error){
        signal.throwIfAborted();
        if(active.aborted)throw Error('WEB_BROWSER_TIMEOUT: 浏览器读取超过 30 秒');
        if(documentFailure)throw documentFailure;
        if(error instanceof Error&&error.message.startsWith('WEB_'))throw error;
        throw Error('WEB_BROWSER_LOAD: 浏览器页面未能完成加载');
      }
    }finally{
      stop.abort();destroy();
      await Promise.allSettled([...inflight]);
      ses.removeListener('will-download',preventDownload);
      ses.webRequest.onBeforeRequest(null);
      ses.protocol.unhandle('http');ses.protocol.unhandle('https');
      try{await ses.clearStorageData();await ses.closeAllConnections()}
      finally{this.busy.delete(slot)}
    }
  }
}
