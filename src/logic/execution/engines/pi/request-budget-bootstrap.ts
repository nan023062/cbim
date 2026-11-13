/**
 * 目录归属：logic/execution/engines/pi；Pi 引擎适配。
 * 作用定位：生成早于 Pi 及其 undici 初始化执行的请求转发入口。
 * 设计原因：保留原供应商 URL 的兼容性判断，实际 fetch 固定交给父进程；不可配置访问器阻止 undici.install 替换门禁。
 * 职责边界：这是固定 Pi 供应商路径的受管出口；仅放行本轮本机桥的固定调用、计量和工具清单路由，仍由桥核随机令牌。它不是操作系统级网络隔离，也不授予工具新权限。
 */
/** 凭据仅为当轮本机随机令牌；真实供应商密钥不进入生成文件或子进程。 */
export function requestBudgetBootstrap(input:{endpoint:string;proxy:string;token:string;bridge:string}):string{
  return `// Generated CBIM request transport. Provider credentials stay in parent.\nconst settings=${JSON.stringify(input)};
const original=globalThis.fetch;
if(typeof original!=='function')throw Error('CBIM_MODEL_REQUEST_FETCH_UNAVAILABLE');
const guarded=async(value,init)=>{
  const request=new Request(value,init),url=new URL(request.url),headers=Object.fromEntries(request.headers);
  if(url.origin===settings.bridge&&['/catalog','/gate','/call','/context','/request-limit','/tools'].includes(url.pathname)&&!url.search&&!url.hash){return original(request.url,{method:request.method,headers,body:request.method==='GET'?undefined:await request.arrayBuffer(),signal:request.signal,redirect:'error'})}
  if(request.method!=='POST'||request.url!==settings.endpoint)throw Error('CBIM_MODEL_REQUEST_TARGET_DENIED');
  return original(settings.proxy+'/request',{method:'POST',headers:{...headers,authorization:'Bearer '+settings.token},body:await request.arrayBuffer(),signal:request.signal,redirect:'error'});
};
Object.defineProperty(globalThis,'fetch',{get:()=>guarded,set:()=>{},configurable:false});
const handshake=await original(settings.proxy+'/ready',{method:'POST',headers:{authorization:'Bearer '+settings.token}});
if(!handshake.ok)throw Error('CBIM_MODEL_REQUEST_GATE_UNAVAILABLE');
`;
}
