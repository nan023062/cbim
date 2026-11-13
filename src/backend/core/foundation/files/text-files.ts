/**
 * 作用定位：公开入口背后的单文件读取与原子文本替换机制。
 * 设计原因：写同目录临时文件、同步内容、再重命名，让配置和存储共享机制，业务自行决定序列化与提交时机。
 * 职责边界：路径必须由可信调用者核实；不提供多文件事务、跨进程锁、目录 fsync 或崩溃后残留扫描。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

/** 保留原存在探测语义：包括无权限在内的 access 失败均返回 false，不用于授权判断。 */
export async function exists(filename:string){try{await fs.access(filename);return true}catch{return false}}

/**
 * 创建父目录并用独占 0600 临时文件替换目标；成功意味着内容 fsync 和 rename 已完成。
 * 写入或替换失败时清理本次临时文件；不串行化同一路径写入，调用者拥有并发及版本校验。
 */
export async function atomic(filename:string,value:string):Promise<void>{
  await fs.mkdir(path.dirname(filename),{recursive:true});
  const temporary=filename+'.'+randomUUID()+'.tmp';
  const handle=await fs.open(temporary,'wx',0o600);
  try{
    try{await handle.writeFile(value,'utf8');await handle.sync()}
    finally{await handle.close()}
    await fs.rename(temporary,filename);
  }finally{await fs.rm(temporary,{force:true})}
}

/** UTF-8 JSON 读取；不验证业务 Schema，T 仅是调用方类型承诺，解析和 I/O 失败原样传播。 */
export async function readJson<T=any>(filename:string):Promise<T>{return JSON.parse(await fs.readFile(filename,'utf8'))}
