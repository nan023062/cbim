import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyBrandAssets} from './build-brand-assets.mjs';

const root=path.resolve(fileURLToPath(new URL('..',import.meta.url)));
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/** 只接受真实桌面发布快照；不读取仓库的 latest（它可能仍是旧 Python 发布）。 */
export function releaseLinks(release){
  if(!/^\d+\.\d+\.\d+$/.test(release.version)||release.tag!==`desktop-v${release.version}`||release.repository!=='nan023062/cbim'||release.filename!==`CBIM-Setup-${release.version}-x64.exe`||!/^[a-f0-9]{64}$/.test(release.sha256)||!Number.isSafeInteger(release.bytes)||release.bytes<=0||!Number.isFinite(Date.parse(release.publishedAt)))throw Error('网站发布快照不合法，请从实际 desktop-v 发布重新核对。');
  // 当前文案明确说明未签名；签名状态变化必须同时审阅下载提示，不能只换链接。
  if(release.signed!==false)throw Error('签名状态变化，请同步更新网站安装说明后再构建。');
  const repository=`https://github.com/${release.repository}`,base=`${repository}/releases/download/${release.tag}`;
  return {downloadUrl:`${base}/${release.filename}`,releaseUrl:`${repository}/releases/tag/${release.tag}`,checksumsUrl:`${base}/SHA256SUMS.txt`};
}

/** 每页内联样式和图标，可离线单独预览；仅在拿到真实公开网址后生成 canonical 与 sitemap。 */
export async function buildWebsite(){
  await verifyBrandAssets();
  const output=path.join(root,'build/website');await fs.mkdir(output,{recursive:true});
  const release=JSON.parse(await fs.readFile(path.join(root,'website/release.json'),'utf8')),links=releaseLinks(release);
  const svg=await fs.readFile(path.join(root,'branding/cbim-mark.svg'),'utf8');
  const brand=svg.replace('<svg ','<svg aria-hidden="true" focusable="false" ');
  let base;
  if(process.env.CBIM_WEBSITE_URL){base=new URL(process.env.CBIM_WEBSITE_URL);if(base.protocol!=='https:'||base.username||base.password||base.search||base.hash)throw Error('CBIM_WEBSITE_URL 必须为真实公开 HTTPS 站点根地址。');if(!base.pathname.endsWith('/'))base.pathname+='/' }
  const values={...release,...links,brand,favicon:'data:image/svg+xml;base64,'+Buffer.from(svg).toString('base64'),styles:await fs.readFile(path.join(root,'website/site.css'),'utf8'),releaseDate:new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(release.publishedAt)),size:(release.bytes/1024/1024).toFixed(1)+' MiB'};
  const pages=['index.html','download.html'];
  for(const page of pages){
    const url=base?new URL(page==='index.html'?'./':page,base).href:undefined;
    const seo=url?`<link rel="canonical" href="${escape(url)}"><meta property="og:url" content="${escape(url)}"><meta property="og:image" content="${escape(new URL('cbim.png',base).href)}"><meta property="og:site_name" content="CBIM Assistant"><script type="application/ld+json">${JSON.stringify({'@context':'https://schema.org','@type':'SoftwareApplication',name:'CBIM Assistant',operatingSystem:'Windows x64',applicationCategory:'BusinessApplication',softwareVersion:release.version,downloadUrl:links.downloadUrl,url:base.href}).replaceAll('<','\\u003c')}</script>`:'';
    const template=await fs.readFile(path.join(root,'website',page),'utf8');
    const html=template.replace(/\{\{(\w+)\}\}/g,(_,key)=>{if(key==='seo')return seo;if(!(key in values))throw Error('未知网站变量：'+key);return ['styles','brand'].includes(key)?values[key]:escape(values[key])});
    await fs.writeFile(path.join(output,page),html);
  }
  await fs.copyFile(path.join(root,'branding/cbim.png'),path.join(output,'cbim.png'));
  await fs.writeFile(path.join(output,'404.html'),`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>页面未找到 · CBIM Assistant</title><body style="font:16px/1.8 system-ui;max-width:560px;margin:15vh auto;padding:24px"><h1>没有找到这个页面</h1><p>你可以返回产品首页，或前往下载页查看当前桌面版本。</p><a href="${escape(base?base.href:'./index.html')}">CBIM Assistant 首页</a> · <a href="${escape(base?new URL('download.html',base).href:'./download.html')}">下载与更新日志</a></body></html>`);
  await fs.writeFile(path.join(output,'robots.txt'),'User-agent: *\nAllow: /\n'+(base?`Sitemap: ${new URL('sitemap.xml',base).href}\n`:''));
  if(base)await fs.writeFile(path.join(output,'sitemap.xml'),'<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'+pages.map(page=>`<url><loc>${escape(new URL(page==='index.html'?'./':page,base).href)}</loc></url>`).join('')+'</urlset>');
  else await fs.rm(path.join(output,'sitemap.xml'),{force:true});
  console.log(JSON.stringify({output,version:release.version,download:links.downloadUrl,canonical:base?.href||null,selfContainedPages:pages}));
  return output;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await buildWebsite();
