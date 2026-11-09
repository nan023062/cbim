/**
 * 作用定位：主进程直连 GitHub 的有界 JSON 传输，供设备授权和反馈提交共用。
 * 设计原因：地址由代码固定，不跟随重定向；限制时长和回包大小，错误不回显凭据、远端正文或请求上下文。
 */
import {fail} from '../../core/foundation/errors';

export interface GitHubReply {status:number;data:unknown}
/** 测试可注入本地替身；生产实现只允许 GitHub 官方两个固定主机。 */
export type GitHubRequest=(endpoint:string,options:{method:'GET'|'POST';token?:string;body?:Record<string,unknown>;signal:AbortSignal})=>Promise<GitHubReply>;
export const githubRequest:GitHubRequest=async(endpoint,options)=>{
  const url=new URL(endpoint);
  if(url.protocol!=='https:'||url.username||url.password||url.port||url.hash||!['github.com','api.github.com'].includes(url.hostname))fail('GITHUB_ADDRESS','GitHub 接口地址无效');
  if(url.hostname==='github.com'&&(!['/login/device/code','/login/oauth/access_token'].includes(url.pathname)||options.token))fail('GITHUB_ADDRESS','GitHub 授权接口无效');
  const signal=AbortSignal.any([options.signal,AbortSignal.timeout(20000)]);
  try{
    const response=await fetch(url,{method:options.method,redirect:'error',signal,headers:{Accept:'application/json','User-Agent':'CBIM-feedback',...(url.hostname==='api.github.com'?{'X-GitHub-Api-Version':'2026-03-10'}:{}),...(options.token?{Authorization:`Bearer ${options.token}`}:{}) ,...(options.body?{'Content-Type':'application/json'}:{})},...(options.body?{body:JSON.stringify(options.body)}:{})});
    const reader=response.body?.getReader();let size=0;const parts:Uint8Array[]=[];
    if(reader)try{for(;;){const item=await reader.read();if(item.done)break;size+=item.value.byteLength;if(size>2*1024*1024){await reader.cancel();fail('GITHUB_RESPONSE','GitHub 回包过大，请核实原操作')}parts.push(item.value)}}finally{reader.releaseLock()}
    let data:unknown;try{data=JSON.parse(Buffer.concat(parts).toString('utf8'))}catch{fail('GITHUB_RESPONSE','GitHub 回包无法识别，请核实原操作')}
    return {status:response.status,data};
  }catch{fail('GITHUB_NETWORK','GitHub 请求未取得可靠回包；请检查网络，提交操作须先核实，不能自动重发')}
};
