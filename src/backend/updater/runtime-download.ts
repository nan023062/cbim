/**
 * 作用定位：公开资源 / 引擎附件的有界下载；下载只写独立候选，不改变活动版本。
 * 设计原因：GitHub 附件需要对象存储跳转，但凭据、任意主机和超出清单的内容不应进入更新链路。
 * 机制边界：小清单组合 utility 的有界字节读取；大安装包继续流式写盘，不整包缓存在内存中。
 */
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {readBoundedBytes,ByteLimitError} from '../../foundations/utility';
import {runtimePackageUrl,type RuntimePackage} from './runtime-manifest';

/** 仅跟随 GitHub 公开附件存储的 HTTPS 跳转，不传账号或授权头。 */
export async function runtimeAssetResponse(url:string,signal:AbortSignal){
  for(let hops=0;hops<5;hops++){
    const parsed=new URL(url);
    if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.port||parsed.hash||!['github.com','release-assets.githubusercontent.com','objects.githubusercontent.com'].includes(parsed.hostname))throw Error('更新附件地址无效');
    if(parsed.hostname==='github.com'&&!parsed.pathname.startsWith('/nan023062/cbim/releases/download/'))throw Error('更新附件仓库无效');
    const response=await fetch(url,{signal,redirect:'manual',credentials:'omit',headers:{'User-Agent':'CBIM-runtime-updater'}});
    if([301,302,303,307,308].includes(response.status)){const next=response.headers.get('location');await response.body?.cancel();if(!next)throw Error('更新附件跳转无效');url=new URL(next,url).href;continue;}
    if(response.status!==200){await response.body?.cancel();throw Object.assign(Error('无法读取更新附件'),{status:response.status});}return response;
  }
  throw Error('更新附件跳转过多');
}

/** 完整传输、长度与 SHA-256 全部通过才返回；失败文件不会作为缓存重用。 */
export async function downloadRuntimePackage(pkg:RuntimePackage,file:string,signal:AbortSignal,onProgress:(percent:number)=>void){
  const response=await runtimeAssetResponse(runtimePackageUrl(pkg),AbortSignal.any([signal,AbortSignal.timeout(30*60_000)]));
  if(!response.body)throw Error('更新附件为空');
  const declared=response.headers.get('content-length');if(declared&&Number(declared)!==pkg.bytes){await response.body.cancel();throw Error('更新附件长度不符');}
  const output=await fs.open(file,'wx',0o600),reader=response.body.getReader(),hash=createHash('sha256');let bytes=0;
  try{
    for(;;){signal.throwIfAborted();const chunk=await reader.read();if(chunk.done)break;bytes+=chunk.value.byteLength;if(bytes>pkg.bytes)throw Error('更新附件超过声明长度');hash.update(chunk.value);await output.writeFile(chunk.value);onProgress(bytes/pkg.bytes*100);}
    if(bytes!==pkg.bytes||hash.digest('hex')!==pkg.sha256)throw Error('更新附件摘要不符');await output.sync();
  }finally{await reader.cancel().catch(()=>{});reader.releaseLock();await output.close();}
}

/** 清单有独立大小限制，内容必须继续经过冷壳公钥验证。 */
export async function downloadRuntimeManifest(tag:string,name:string,signal:AbortSignal){
  const combined=AbortSignal.any([signal,AbortSignal.timeout(30000)]);
  const response=await runtimeAssetResponse(runtimePackageUrl({tag,name}),combined);
  if(!response.body)throw Error('更新清单为空');
  let bytes:Uint8Array;
  try{bytes=await readBoundedBytes(response.body,{maxBytes:16*1024*1024,signal:combined})}
  catch(error){if(error instanceof ByteLimitError)throw Error('更新清单超过上限');throw error}
  return JSON.parse(Buffer.from(bytes).toString('utf8'));
}
