import assert from 'node:assert/strict';
import {spawn,type ChildProcessWithoutNullStreams} from 'node:child_process';
import {createRequire} from 'node:module';
import {createInterface} from 'node:readline';
import {randomUUID} from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type {seedControlledFile} from './controlled-file-seed';

export type ControlledSeed=Awaited<ReturnType<typeof seedControlledFile>>;
export interface ControlledHostConfig {root:string;user:string;project:string;repository:string;childEntry:string;koffiPath:string;controlToken:string}
export interface ControlledHostTrace {kind:string;pid?:number;phase?:string;seq?:number;code?:string;writeIssued?:boolean;byteLength?:number;sha256?:string}
const requireTest=createRequire(import.meta.url);
function ownRoot(root:string){const full=path.resolve(root);assert.equal(path.dirname(full),path.resolve(os.tmpdir()));assert.ok(path.basename(full).startsWith('cbim-controlled-file-'));return full}

/** 启动实际 Electron app.ready 和生产 utility transport；私有 RPC 只存在于测试宿主。 */
export async function createControlledHost(options:{root?:string}={}){
  const root=ownRoot(options.root??await fs.mkdtemp(path.join(os.tmpdir(),'cbim-controlled-file-'))),user=path.join(root,'user'),project=path.join(root,'project'),repository=path.resolve('.');
  await Promise.all([fs.mkdir(user,{recursive:true}),fs.mkdir(project,{recursive:true})]);
  const childEntry=path.join(root,'controlled-child.cjs'),hostEntry=path.join(root,'electron-host.cjs'),configFile=path.join(root,'host-config.json'),tsx=requireTest.resolve('tsx/cjs');
  const config:ControlledHostConfig={root,user,project,repository,childEntry,koffiPath:requireTest.resolve('koffi'),controlToken:randomUUID()};
  await fs.writeFile(childEntry,'require('+JSON.stringify(tsx)+');require('+JSON.stringify(path.join(repository,'src/backend/main/platform/controlled-file-child.ts'))+');\n');
  await fs.writeFile(hostEntry,'process.env.CBIM_CONTROLLED_TEST_CONFIG='+JSON.stringify(configFile)+';require('+JSON.stringify(tsx)+');require('+JSON.stringify(path.join(repository,'tests/controlled-file-electron-host.ts'))+');\n');
  await fs.writeFile(configFile,JSON.stringify(config,null,2));
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  const child=spawn(requireTest('electron')as string,[hostEntry],{cwd:repository,env,windowsHide:true,stdio:'pipe'});
  const stdout:string[]=[],stderr:string[]=[],pending=new Map<number,{resolve:(value:any)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}>();let sequence=0,closed=false,exited=false;
  let readyResolve!:(value:any)=>void,readyReject!:(error:Error)=>void;
  const ready=new Promise<any>((resolve,reject)=>{readyResolve=resolve;readyReject=reject});
  const exit=new Promise<{code:number|null;signal:NodeJS.Signals|null}>(resolve=>child.once('exit',(code,signal)=>{exited=true;resolve({code,signal});const error=Error('Controlled Electron host exited '+code+' '+signal+'\n'+stderr.join(''));readyReject(error);for(const item of pending.values()){clearTimeout(item.timer);item.reject(error)}pending.clear()}));
  child.once('error',readyReject);child.stderr.on('data',chunk=>stderr.push(String(chunk)));
  const lines=createInterface({input:child.stdout});lines.on('line',line=>{
    stdout.push(line);if(!line.startsWith('CBIM_CONTROLLED_TEST '))return;
    const message=JSON.parse(line.slice('CBIM_CONTROLLED_TEST '.length));
    if('ready'in message){if(message.ready)readyResolve(message);else readyReject(Error(message.error+'\n'+message.stack));return}
    const item=pending.get(message.id);if(!item)return;pending.delete(message.id);clearTimeout(item.timer);
    if(message.error)item.reject(Object.assign(Error(message.error.message),{code:message.error.code,remoteStack:message.error.stack}));else item.resolve(message.value);
  });
  let timer:ReturnType<typeof setTimeout>|undefined,startup:any;
  try{startup=await Promise.race([ready,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('Electron host startup timeout')),30000)})])}
  catch(error){await fs.writeFile(path.join(root,'startup-error.json'),JSON.stringify({error:String(error),stdout,stderr},null,2));if(!exited)child.kill();await exit;throw error}
  finally{if(timer)clearTimeout(timer)}
  const request=async(op:string,args:unknown={}):Promise<any>=>{
    if(exited)throw Error('Host already exited');const response=await fetch('http://127.0.0.1:'+startup.port,{method:'POST',headers:{'content-type':'application/json','x-cbim-test-token':config.controlToken},body:JSON.stringify({op,args}),signal:AbortSignal.timeout(120000)}),message=await response.json()as any;
    if(message.error)throw Object.assign(Error(message.error.message),{code:message.error.code,remoteStack:message.error.stack});return message.value;
  };
  return {root,user,project,config,child,request,dispatch:(action:string,args:unknown)=>request('dispatch',{action,args}),seed:(providerUrl:string)=>request('seed',{providerUrl})as Promise<ControlledSeed>,trace:()=>request('trace')as Promise<ControlledHostTrace[]>,diagnostics:()=>({stdout:[...stdout],stderr:[...stderr]}),
    async close(){if(closed)return;if(!exited)await request('shutdown');const result=await exit;assert.equal(result.code,0,JSON.stringify(result));closed=true;lines.close()},
    async remove(){assert.ok(closed,'先确认自有 Electron 已退出');ownRoot(root);assert.equal((await fs.lstat(root)).isSymbolicLink(),false);await fs.rm(root,{recursive:true,force:true})},
  };
}

/** 独立真实只读文件映射，不改产品协议或账本；映射释放有实际子进程回执。 */
export async function holdControlledReadonlyMapping(root:string,file:string){
  ownRoot(root);assert.ok(path.resolve(file).startsWith(path.resolve(root)+path.sep));
  const configFile=path.join(root,'mapping-config.json');await fs.writeFile(configFile,JSON.stringify({root,file,koffiPath:requireTest.resolve('koffi')}));
  const child:ChildProcessWithoutNullStreams=spawn(process.execPath,[path.resolve('tests/controlled-file-mapping-helper.cjs'),configFile],{windowsHide:true,stdio:'pipe'}),events:any[]=[],stderr:string[]=[];
  let mappedResolve!:(value:any)=>void,mappedReject!:(error:Error)=>void;const mapped=new Promise<any>((resolve,reject)=>{mappedResolve=resolve;mappedReject=reject});
  const exit=new Promise<number|null>(resolve=>child.once('exit',code=>{resolve(code);if(!events.some(item=>item.kind==='mapped'))mappedReject(Error('Mapping helper exited '+code+' '+stderr.join('')))}));
  child.once('error',mappedReject);child.stderr.on('data',chunk=>stderr.push(String(chunk)));
  const lines=createInterface({input:child.stdout});lines.on('line',line=>{const event=JSON.parse(line);events.push(event);if(event.kind==='mapped')mappedResolve(event);else if(event.kind==='error')mappedReject(Error(event.error??event.message))});
  let timer:ReturnType<typeof setTimeout>|undefined,opened:any;
  try{opened=await Promise.race([mapped,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('Mapping helper timeout')),10000)})])}catch(error){child.kill();await exit;throw error}finally{if(timer)clearTimeout(timer)}
  let released=false;return {child,opened,events,async release(){if(released)return;child.stdin.end(JSON.stringify({kind:'release'})+'\n');assert.equal(await exit,0);assert.ok(events.some(event=>event.kind==='released'));assert.deepEqual(stderr,[]);released=true;lines.close()}};
}
