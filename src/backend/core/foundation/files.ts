/**
 * 作用定位：Node 运行环境下的最小文件原语：存在检查、原子文本提交与 JSON 读取。
 * 设计原因：提供可复用的底层 I/O，不拥有工作区、事务、账户或应用目录策略；业务存储生命周期由 main 管理。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
export async function exists(p:string){try{await fs.access(p);return true}catch{return false}}
export async function atomic(p:string,value:string){
  await fs.mkdir(path.dirname(p),{recursive:true});const tmp=p+'.'+randomUUID()+'.tmp';const h=await fs.open(tmp,'wx',0o600);
  try{await h.writeFile(value,'utf8');await h.sync()}finally{await h.close()}
  try{await fs.rename(tmp,p)}finally{await fs.rm(tmp,{force:true})}
}
export async function readJson<T=any>(p:string):Promise<T>{return JSON.parse(await fs.readFile(p,'utf8'))}
