import http from 'node:http';
import {RemoteRepository} from '../src/backend/main/resources/resource-http';

// 真实独立 Node 进程核实先取消、后超时；避免测试运行器共享 fetch/AbortSignal 状态影响计时。
async function main(){
  let calls=0,opened!:()=>void;const arrived=new Promise<void>(resolve=>opened=resolve);
  const server=http.createServer((_request,response)=>{calls++;response.writeHead(200,{'Content-Type':'application/json'});response.write('{');opened()});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const client=new RemoteRepository('http://127.0.0.1:'+(server.address() as import('node:net').AddressInfo).port,'PRIVATE_TOKEN');
  try{
    const controller=new AbortController(),first=client.read(controller.signal);await arrived;controller.abort();
    let cancellation:string|undefined;try{await first}catch(error:any){cancellation=error.code}
    const started=Date.now();let failure:Error&{code?:string}|undefined;try{await client.read()}catch(error:any){failure=error}
    process.stdout.write(JSON.stringify({cancellation,code:failure?.code,elapsedMs:Date.now()-started,calls,leaked:failure?.message.includes('PRIVATE_TOKEN')??false}));
  }finally{const closed=new Promise<void>(resolve=>server.close(()=>resolve()));server.closeAllConnections();await closed}
}
main().catch(()=>{process.stderr.write('HTTP timeout verification failed');process.exitCode=1});
