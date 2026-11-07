/**
 * 作用定位：桌面明确导入目录、URL 指针和网页时，生成有界文本及真实来源事实。
 * 设计原因：网络字节上限、目录枚举及 UTF-8 截取在 Main 集中处理；取消后不继续读取，既不执行网页脚本，也不把首层清单称为完整目录。
 */
import fs from 'node:fs/promises';
import {fail} from '../../../core/foundation/errors';
import {hash} from '../../../core/foundation/serialization';
import {continuationSourceLimits,continuationSourceUrlSchema,type ContinuationSourceProof} from '../../../core/tasks/continuation-source-snapshot';

/** 按完整 Unicode 字符截取 UTF-8 前缀；不会将被截断的多字节字符变为替换符。 */
export function sourceExcerpt(text:string){
  let size=0,end=0;for(const character of text){const bytes=Buffer.byteLength(character);if(size+bytes>continuationSourceLimits.savedTextBytes)break;size+=bytes;end+=character.length}
  return {text:text.slice(0,end),savedTextBytes:size,truncated:end<text.length};
}
/** 枚举最多 200 条可见首层项及一条溢出哨兵，不读取子目录内容或链接目标。 */
export async function readDirectorySource(file:string,signal:AbortSignal){
  signal.throwIfAborted();const directory=await fs.opendir(file),lines:string[]=[];let savedTextBytes=0,truncated=false;
  try{for await(const entry of directory){
    signal.throwIfAborted();if(entry.name.toLowerCase()==='.cbim')continue;
    const line=(entry.isDirectory()?'目录 ':entry.isSymbolicLink()?'链接 ':'文件 ')+entry.name,size=Buffer.byteLength(line)+(lines.length?1:0);
    if(lines.length===continuationSourceLimits.directoryEntries||savedTextBytes+size>continuationSourceLimits.savedTextBytes){truncated=true;break}
    lines.push(line);savedTextBytes+=size;
  }}finally{await directory.close().catch(error=>{if(error.code!=='ERR_DIR_CLOSED')throw error})}
  signal.throwIfAborted();
  return {text:lines.join('\n'),proof:{kind:'folder',mode:'first_level',capturedAt:new Date().toISOString(),savedTextBytes,entryLimit:200,entryCount:lines.length,truncated} satisfies ContinuationSourceProof};
}
/** URL 指针不联网；网页单次读取完整有界响应后才提取文本，原响应超限直接拒绝，不伪造完整原文 hash。 */
export async function readUrlSource(kind:'link'|'web',value:string,signal:AbortSignal){
  const parsed=continuationSourceUrlSchema.safeParse(value);if(!parsed.success)fail('ATTACHMENT_URL','请输入不含凭据的 HTTP 或 HTTPS 链接');
  const url=new URL(parsed.data);signal.throwIfAborted();
  if(kind==='link'){
    const text='链接引用：'+url.href;
    return {name:url.hostname,source:url.href,text,note:'仅引用链接，未抓取正文',proof:{kind:'link',mode:'url_only',url:url.href,capturedAt:new Date().toISOString(),savedTextBytes:Buffer.byteLength(text)} satisfies ContinuationSourceProof};
  }
  const timeout=AbortSignal.timeout(15000),combined=AbortSignal.any([signal,timeout]);let response:Response|undefined;
  try{
    response=await fetch(url,{redirect:'error',credentials:'omit',signal:combined});combined.throwIfAborted();
    if(!response.ok)fail('ATTACHMENT_WEB_HTTP','网页返回 HTTP '+response.status);
    const mediaType=(response.headers.get('content-type')??'').split(';')[0].trim().toLowerCase();
    if(!/^(text\/[a-z0-9.+-]+|application\/json)$/.test(mediaType)||mediaType.length>256)fail('ATTACHMENT_WEB_TYPE','此地址不是可读取的文本网页，请添加为链接');
    const declared=response.headers.get('content-length');if(declared&&Number(declared)>continuationSourceLimits.webResponseBytes)fail('ATTACHMENT_WEB_LIMIT','网页响应超过 1 MiB，请改为添加链接');
    const chunks:Uint8Array[]=[];let total=0;const reader=response.body?.getReader();
    if(reader)try{while(true){combined.throwIfAborted();const part=await reader.read();combined.throwIfAborted();if(part.done)break;total+=part.value.byteLength;if(total>continuationSourceLimits.webResponseBytes)fail('ATTACHMENT_WEB_LIMIT','网页响应超过 1 MiB，请改为添加链接');chunks.push(part.value)}}finally{await reader.cancel().catch(()=>{});reader.releaseLock()}
    const raw=Buffer.concat(chunks,total);let decoded:string;try{decoded=new TextDecoder('utf-8',{fatal:true}).decode(raw)}catch{fail('ATTACHMENT_WEB_ENCODING','网页不是有效 UTF-8 文本，请改为添加链接')}
    const html=mediaType==='text/html';if(html)decoded=decoded.replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi,'').replace(/<[^>]+>/g,' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/\s+/g,' ').trim();
    const excerpt=sourceExcerpt(decoded);combined.throwIfAborted();
    return {name:url.hostname,source:url.href,text:excerpt.text,note:'网页文本摘录，不执行脚本；最多 64 KiB UTF-8'+(excerpt.truncated?'，已截取':''),proof:{kind:'web',url:url.href,capturedAt:new Date().toISOString(),mediaType,rawBytes:total,rawHash:hash(raw),extraction:html?'html_text':'text',savedTextBytes:excerpt.savedTextBytes,truncated:excerpt.truncated} satisfies ContinuationSourceProof};
  }catch(error){signal.throwIfAborted();if(timeout.aborted)fail('ATTACHMENT_WEB_TIMEOUT','网页读取超时，未保存资料');if(error&&typeof error==='object'&&'code' in error)throw error;fail('ATTACHMENT_WEB_FETCH','网页读取失败或发生跳转，请改用最终地址或添加链接')}
  finally{if(response?.body&&!response.body.locked)await response.body.cancel().catch(()=>{})}
}
