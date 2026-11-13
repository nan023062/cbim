/**
 * 作用定位：更新子系统读取公开 Release 列表的独立 HTTP 边界。
 * 设计原因：不复用运行时反馈服务或凭据；地址、GET、期限及字节上限由更新模块决定，仅组合 utility 的流消费机制。
 */
import {readBoundedBytes,ByteLimitError} from '../../foundations/utility';
export type ReleaseRequest=(endpoint:string,options:{method:'GET';signal:AbortSignal})=>Promise<{status:number;data:unknown}>;
/** 只接受本产品的公开 Release 列表；不会发送 OAuth Token、请求正文或跟随重定向。 */
export const releaseRequest:ReleaseRequest=async(endpoint,options)=>{
  const url=new URL(endpoint);
  if(url.origin!=='https://api.github.com'||url.username||url.password||url.hash||url.pathname!=='/repos/nan023062/cbim/releases'||options.method!=='GET')throw Error('更新源地址无效');
  const signal=AbortSignal.any([options.signal,AbortSignal.timeout(20000)]);
  const response=await fetch(url,{method:'GET',redirect:'error',signal,headers:{Accept:'application/vnd.github+json','User-Agent':'CBIM-desktop-updater','X-GitHub-Api-Version':'2026-03-10'}});
  let bytes:Uint8Array;
  try{bytes=await readBoundedBytes(response.body,{maxBytes:2*1024*1024,signal})}
  catch(error){if(error instanceof ByteLimitError)throw Error('更新列表过大');throw error}
  return {status:response.status,data:JSON.parse(Buffer.from(bytes).toString('utf8'))};
};
