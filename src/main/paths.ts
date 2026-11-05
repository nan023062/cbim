import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash,randomUUID} from 'node:crypto';
export const hash=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
export class Fault extends Error {constructor(public code:string,message:string){super(message);this.name=code}}
export function fail(code:string,message:string):never {throw new Fault(code,message)}
export async function exists(p:string){try{await fs.access(p);return true}catch{return false}}
export async function atomic(p:string,value:string){
  await fs.mkdir(path.dirname(p),{recursive:true});const tmp=p+'.'+randomUUID()+'.tmp';const h=await fs.open(tmp,'wx',0o600);
  try{await h.writeFile(value,'utf8');await h.sync()}finally{await h.close()}
  try{await fs.rename(tmp,p)}finally{await fs.rm(tmp,{force:true})}
}
export const json=(v:unknown)=>JSON.stringify(v,null,2)+'\n';
export async function readJson<T=any>(p:string):Promise<T>{return JSON.parse(await fs.readFile(p,'utf8'))}
export class Paths {
  constructor(readonly userRoot=path.join(os.homedir(),'.cbim'),readonly installRoot=path.resolve('.')){}
  async identity(input:string){
    if(!input?.trim())fail('INVALID_ROOT','请选择项目目录');const real=await fs.realpath(input);
    if(!(await fs.stat(real)).isDirectory())fail('INVALID_ROOT','项目根必须是目录');
    const relativeToInstall=path.relative(await fs.realpath(this.installRoot),real);
    if(!relativeToInstall||(!path.isAbsolute(relativeToInstall)&&relativeToInstall!=='..'&&!relativeToInstall.startsWith('..'+path.sep)))fail('INSTALL_ROOT','工具安装目录及其子目录不能作为业务工程');
    const canonical=process.platform==='win32'?real.replaceAll('\\','/').toLowerCase():real;
    return {id:hash(canonical),path:real};
  }
  project(id:string){if(!/^[a-f0-9]{64}$/.test(id))fail('IDENTITY','无效项目标识');return path.join(this.userRoot,id)}
  local(id:string,kind:'memory'|'task-records'|'logs'|'cache'|'transactions'){return path.join(this.project(id),kind)}
  discovery(id:string){return path.join(this.project(id),'discovery.json')}
  async knowledge(root:string,relative:string){
    if(!relative.startsWith('.cbim/')||relative.includes('\\')||relative.split('/').some(x=>!x||x==='.'||x==='..')||/[:\x00]/.test(relative))fail('PATH','知识路径必须在 .cbim/ 内');
    let current=root;
    for(const part of relative.split('/')){current=path.join(current,part);
      try{const s=await fs.lstat(current);if(s.isSymbolicLink())fail('PATH','知识路径不允许链接或重定向')}
      catch(e:any){if(e.code!=='ENOENT')throw e}}
    return current;
  }
}
