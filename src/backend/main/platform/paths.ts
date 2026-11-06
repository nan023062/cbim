/**
 * 作用定位：本机应用目录、工程身份和知识路径的实际解析。
 * 设计原因：将安装位置、用户目录和符号链接边界留在平台层；实现 Core 的 StoragePaths 契约。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {hash} from '../../core/foundation/serialization';
import {fail} from '../../core/foundation/errors';
import type {StoragePaths} from '../../core/foundation/paths';
export class Paths implements StoragePaths {
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
  async knowledge(root:string,relative:string){
    if(!relative.startsWith('.cbim/')||relative.includes('\\')||relative.split('/').some(x=>!x||x==='.'||x==='..')||/[:\x00]/.test(relative))fail('PATH','知识路径必须在 .cbim/ 内');
    let current=root;
    for(const part of relative.split('/')){current=path.join(current,part);
      try{const s=await fs.lstat(current);if(s.isSymbolicLink())fail('PATH','知识路径不允许链接或重定向')}
      catch(e:any){if(e.code!=='ENOENT')throw e}}
    return current;
  }
}
