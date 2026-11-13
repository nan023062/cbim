import {app,BrowserWindow} from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {ElectronBrowserReader} from '../src/foundations/web/electron-browser-reader';
import {PublicHttp,WebPageReader} from '../src/foundations/web';
import {WebService} from '../src/backend/main/web/web-service';

// 真实 Electron 加载可控公开域名夹具；只在测试传输替换资源，不向生产工具暴露内网绕过参数。
async function main(){
const root=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-web-browser-'));
app.setPath('userData',root);app.setPath('sessionData',root);
app.on('window-all-closed',()=>{});
await app.whenReady();
console.log('Chromium fixture ready');
const checks:string[]=[];
try{
  if(!process.argv.includes('--live-only')){
  const urls:string[]=[],documents:string[]=[],requestHeaders:Array<Record<string,string>|undefined>=[];
  const client={readBytes:async(url:string,_signal:AbortSignal,options?:{headers?:Record<string,string>})=>{
    requestHeaders.push(options?.headers);
    urls.push(url);const target=new URL(url);
    let body='<html><head><title>Fixture</title></head><body>';
    if(target.pathname==='/')body+='<main>Outer shell</main><script>setTimeout(()=>{const f=document.createElement("iframe");f.src="https://frames.example.com/frame";document.body.append(f)},100)</script>';
    if(target.pathname==='/frame')body+='<main id="content"></main><script>setTimeout(()=>document.getElementById("content").textContent="Dynamic iframe body",500)</script>';
    if(target.pathname==='/login')body+='<form><input type="password"></form>';
    if(target.pathname==='/private')body+='<script>fetch("http://127.0.0.1/secret")</script><main>Must block private network</main>';
    if(target.pathname==='/cancel')body+='<main>Before cancellation</main>';
    if(target.pathname==='/readonly')body+='<main>Public article</main><input style="display:none" type="password"><script>document.cookie="private=secret";fetch("/echo",{headers:{Authorization:"Bearer private"}});fetch("/write",{method:"POST",body:"no"});window.open("https://example.com/popup")</script>';
    return {status:target.pathname==='/missing'?404:200,headers:{'content-type':'text/html'},body:Buffer.from(body+'</body></html>')};
  }};
  const browser=new ElectronBrowserReader(client);
  const authorize=async(url:string)=>{documents.push(url)};
  const result=await browser.read('https://example.com/',new AbortController().signal,authorize);
  assert.match(result.markdown,/Dynamic iframe body/);assert.match(result.markdown,/Outer shell/);
  assert.ok(documents.includes('https://frames.example.com/frame'));
  assert.equal(BrowserWindow.getAllWindows().length,0);checks.push('真实 Chromium 执行脚本并读取跨域 iframe，所有窗口关闭');
  await assert.rejects(browser.read('https://example.com/login',new AbortController().signal,authorize),/WEB_LOGIN/);
  checks.push('真实登录表单与空正文区分');
  await assert.rejects(browser.read('https://example.com/missing',new AbortController().signal,authorize),/WEB_HTTP_4XX/);checks.push('真实 HTTP 404 不解释成登录');
  const beforeDenied=urls.length;
  await assert.rejects(browser.read('https://example.com/',new AbortController().signal,async url=>{if(url.includes('frames.example.com'))throw Error('WEB_ROBOTS: denied')}),/WEB_ROBOTS/);
  assert.ok(!urls.slice(beforeDenied).some(url=>url.includes('frames.example.com')));checks.push('iframe robots 拒绝发生在真实资源传输前');
  assert.match((await browser.read('https://example.com/readonly',new AbortController().signal,authorize)).markdown,/Public article/);
  assert.ok(!urls.some(url=>url.endsWith('/write')||url.endsWith('/popup')));
  assert.ok(!JSON.stringify(requestHeaders).includes('private'));checks.push('不发送写请求、Cookie/认证头或打开弹窗；隐藏密码框不误报登录');
  const controller=new AbortController();setTimeout(()=>controller.abort(),500);
  await assert.rejects(browser.read('https://example.com/cancel',controller.signal,authorize));
  assert.equal(BrowserWindow.getAllWindows().length,0);checks.push('取消释放真实窗口');
  await assert.rejects(browser.read('https://example.com/private',new AbortController().signal,authorize),/WEB_SSRF/);
  assert.ok(urls.every(url=>!url.includes('127.0.0.1')));checks.push('页面私网资源请求没有进入传输');
  // 同一个适配器可在失败/取消后复用已经清理的槽位。
  assert.match((await browser.read('https://example.com/',new AbortController().signal,authorize)).markdown,/Dynamic iframe body/);
  checks.push('失败及取消后可复用清理过的会话');
  const reader=new WebPageReader({read:async url=>({status:url.endsWith('/robots.txt')?404:200,headers:{'content-type':'text/html'},body:url.endsWith('/robots.txt')?'':'<script>load()</script>'})},{now:Date.now,wait:async()=>{},interval:0},browser);
  assert.match((await reader.fetch({url:'https://example.com/'},new AbortController().signal)).markdown,/Dynamic iframe body/);
  checks.push('静态空正文到真实浏览器的完整兜底调用链');
  }
  if(process.argv.includes('--live')||process.argv.includes('--live-only')){
    const visited:string[]=[],denied:Array<{url:string;error:string}>=[],realBrowser=new ElectronBrowserReader();
    const live=new WebService({resolve:()=>''},undefined,undefined,{read:(url,signal,authorize)=>realBrowser.read(url,signal,async(target,active,document)=>{
      visited.push(`${document?'document':'resource'} ${target}`);
      try{await authorize(target,active,document)}catch(error){denied.push({url:target,error:String(error)});throw error}
    })});
    try{
      const page=await live.fetch({url:'https://claude.ai/artifact/BGY1SztrAYcJQHSsnHHGmp'},new AbortController().signal);
      const saltline=/SALTLINE/i.test(page.markdown)&&/DEPLOY/i.test(page.markdown);
      checks.push(`真实 Saltline 公开网页：${saltline?'已取得游戏正文':'仅取得部分文字'}`);
      await fs.writeFile('test-results/web-browser-smoke/live.json',JSON.stringify({saltline,...page},null,2));
    }catch(error){
      checks.push(`真实 Saltline 公开网页未通过：${String(error)}`);
      await fs.writeFile('test-results/web-browser-smoke/live.json',JSON.stringify({ok:false,error:String(error),denied,visited},null,2));
    }
  }
  if(!process.argv.includes('--live-only'))await fs.writeFile('test-results/web-browser-smoke/report.json',JSON.stringify({ok:true,checks},null,2));
  console.log(JSON.stringify({ok:true,checks}));
}catch(error){
  console.error(error);await fs.writeFile('test-results/web-browser-smoke/report.json',JSON.stringify({ok:false,checks,error:String(error)},null,2));process.exitCode=1;
}finally{
  for(const window of BrowserWindow.getAllWindows())window.destroy();
  app.exit(Number(process.exitCode??0));
}
}
void main().catch(error=>{console.error(error);app.exit(1)});
