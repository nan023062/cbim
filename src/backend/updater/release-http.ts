/**
 * 作用定位：更新子系统读取公开 Release 列表的独立 HTTP 边界。
 * 设计原因：不复用运行时反馈服务或凭据；地址、GET 方法、超时和响应大小均由更新模块限制。
 */
export type ReleaseRequest=(endpoint:string,options:{method:'GET';signal:AbortSignal})=>Promise<{status:number;data:unknown}>;
/** 只接受本产品的公开 Release 列表；不会发送 OAuth Token、请求正文或跟随重定向。 */
export const releaseRequest:ReleaseRequest=async(endpoint,options)=>{
  const url=new URL(endpoint);
  if(url.origin!=='https://api.github.com'||url.username||url.password||url.hash||url.pathname!=='/repos/nan023062/cbim/releases'||options.method!=='GET')throw Error('更新源地址无效');
  const signal=AbortSignal.any([options.signal,AbortSignal.timeout(20000)]);
  const response=await fetch(url,{method:'GET',redirect:'error',signal,headers:{Accept:'application/vnd.github+json','User-Agent':'CBIM-desktop-updater','X-GitHub-Api-Version':'2026-03-10'}});
  const reader=response.body?.getReader();let size=0;const parts:Uint8Array[]=[];
  if(reader)try{for(;;){const item=await reader.read();if(item.done)break;size+=item.value.byteLength;if(size>2*1024*1024){await reader.cancel();throw Error('更新列表过大')}parts.push(item.value)}}finally{reader.releaseLock()}
  return {status:response.status,data:JSON.parse(Buffer.concat(parts).toString('utf8'))};
};
