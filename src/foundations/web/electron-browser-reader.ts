/**
 * 作用定位：基础网页能力的 Electron/Chromium 适配，采集脚本执行后的正文及跨域 iframe。
 * 设计原因：独立内存会话隔离不可信页面；Chromium 经固定公网 IP 的本机代理发起原生 TLS 请求，
 * 保留正常的匿名会话行为，逐资源检查策略且不共享用户登录态。代理负责连接，读取器负责页面权限。
 * 生命周期：最多两个并行读取，每次至多 30 秒；结束销毁窗口、取消请求并清空会话，不自动登录或操作网页。
 */
import {BrowserWindow,session} from 'electron';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {z} from 'zod';
import {publicUrl} from './public-http';
import {openBrowserProxy,type BrowserProxyTransport} from './browser-proxy';
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
const policy="default-src http: https: data: blob: 'unsafe-inline' 'unsafe-eval'; connect-src http: https:; object-src 'none'; worker-src 'none'; form-action 'none'";

/** 由 Electron ready 后的桌面入口创建；不会被 CLI、模型工具参数或前端直接构造。 */
export class ElectronBrowserReader implements BrowserReader {
  private readonly prefix=`public-web-${randomUUID()}`;
  private readonly busy=new Set<number>();
  constructor(private readonly transport?:BrowserProxyTransport){}

  /** 独占匿名会话。所有 HTTP 资源逐次 authorize，文档额外节流；只允许 GET，不承诺 canvas 像素识别。 */
  async read(raw:string,signal:AbortSignal,authorize:(url:string,signal:AbortSignal,document?:boolean)=>Promise<void>):Promise<BrowserPage>{
    const url=publicUrl(raw);signal.throwIfAborted();
    const slot=[0,1].find(value=>!this.busy.has(value));
    if(slot===undefined)throw Error('WEB_BROWSER_BUSY: 浏览器读取已达并发上限，请稍后再试');
    this.busy.add(slot);
    const stop=new AbortController(),active=AbortSignal.any([signal,stop.signal,AbortSignal.timeout(30000)]);
    const ses=session.fromPartition(`${this.prefix}-${slot}`,{cache:false});
    let window:BrowserWindow|undefined,requests=0,navigations=0;
    let documentFailure:Error|undefined;
    let proxy:Awaited<ReturnType<typeof openBrowserProxy>>|undefined;
    const pending=new Set<number>();
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
      proxy=await openBrowserProxy(active,error=>{documentFailure??=error},this.transport);
      await ses.setProxy({mode:'fixed_servers',proxyRules:`127.0.0.1:${proxy.port}`,proxyBypassRules:'<-loopback>'});
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
          if(++requests>160||document&&++navigations>32)throw Error('WEB_BROWSER_LIMIT: 页面请求超过读取上限');
          const permitted=authorization.then(()=>authorize(details.url,active,document));
          authorization=permitted.catch(()=>{});
          await permitted;active.throwIfAborted();pending.add(details.id);
        };
        void track(check()).then(()=>callback({cancel:false}),error=>{
          if(document||error instanceof Error&&/WEB_(SSRF|ROBOTS|RATE_LIMIT|BROWSER_LIMIT)/.test(error.message))documentFailure??=error instanceof Error?error:Error('WEB_BROWSER_ACCESS: 嵌入页面不可读');
          callback({cancel:true});
        });
      });
      ses.webRequest.onBeforeSendHeaders((details,callback)=>{
        const headers={...details.requestHeaders};
        for(const key of Object.keys(headers))if(/^(authorization|proxy-authorization)$/i.test(key))delete headers[key];
        callback({requestHeaders:headers});
      });
      ses.webRequest.onHeadersReceived((details,callback)=>{
        const headers={...details.responseHeaders};
        const key=Object.keys(headers).find(name=>name.toLowerCase()==='content-security-policy')??'Content-Security-Policy';
        headers[key]=[...(headers[key]??[]),policy];
        callback({responseHeaders:headers});
      });
      ses.webRequest.onCompleted(details=>pending.delete(details.id));
      ses.webRequest.onErrorOccurred(details=>pending.delete(details.id));
      window=new BrowserWindow({show:false,width:1280,height:900,webPreferences:{session:ses,contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true,backgroundThrottling:false,disableDialogs:true}});
      window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
      window.webContents.setAudioMuted(true);
      window.webContents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');
      window.webContents.on('will-attach-webview',event=>event.preventDefault());
      window.webContents.on('did-frame-navigate',(_event,_url,code,_status,isMain)=>{
        if(code>=400)documentFailure??=Error(code===401?'WEB_LOGIN: 浏览器页面要求认证':`WEB_HTTP_${code<500?'4XX':'5XX'}: 浏览器${isMain?'页面':'框架'}返回 HTTP ${code}`);
      });
      const collect=async()=>{
        try{await window!.loadURL(url.href)}catch(error){
          // 页面自己的导航会中止最初的 loadURL；继续观察新的文档，调用者取消仍由 active 判断。
          if((error as {code?:string}).code!=='ERR_ABORTED')throw error;
          active.throwIfAborted();
        }
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
          if(now-started>=3000&&now-stableSince>=1000&&pending.size===0&&available.length===frames.length&&available.every(item=>item.value.ready)){
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
        throw Error('WEB_BROWSER_LOAD: 浏览器页面未能完成加载',{cause:error});
      }
    }finally{
      stop.abort();destroy();
      await Promise.allSettled([...inflight]);
      ses.removeListener('will-download',preventDownload);
      ses.webRequest.onBeforeRequest(null);
      ses.webRequest.onBeforeSendHeaders(null);ses.webRequest.onHeadersReceived(null);
      ses.webRequest.onCompleted(null);ses.webRequest.onErrorOccurred(null);
      proxy?.close();
      try{await ses.clearStorageData();await ses.closeAllConnections()}
      finally{this.busy.delete(slot)}
    }
  }
}
