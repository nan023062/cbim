/**
 * 作用定位：Catalog：维护本机工作区清单、显示名称、路径身份、并发更新和重新定位。
 * 设计原因：用规范化路径身份和跨进程锁维护登记，避免窗口各自保存不一致的工作区。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {KernelLock} from '../platform/locking';
import {Paths} from '../platform/paths';
import {atomic,exists,readJson} from '../../../core/platform/node/files';
import {hash,json} from '../../../core/platform/node/serialization';
import {fail} from '../../../core/errors';
import type {Catalog as Data,WorkspaceEntry} from '../../../bridge/contracts/workspace';
const run=promisify(execFile);
const empty=():Data=>({version:1,entries:[],recent:[]});
export class Catalog {
  warning='';
  constructor(readonly paths:Paths){}
  async init(){
    await fs.mkdir(this.paths.userRoot,{recursive:true,mode:0o700});
    if(process.platform==='win32'){
      const who=(await run('whoami',[],{windowsHide:true})).stdout.trim();
      await run('icacls',[this.paths.userRoot,'/inheritance:r','/grant:r',`${who}:(OI)(CI)F`],{windowsHide:true});
    }else await fs.chmod(this.paths.userRoot,0o700);
  }
  async read():Promise<Data>{
    const p=path.join(this.paths.userRoot,'workspaces.json');if(!await exists(p))return empty();
    try{const value=await readJson<Data>(p);if(value.version!==1||!Array.isArray(value.entries)||!Array.isArray(value.recent))throw Error('invalid');
      // 兼容旧登记文件，只返回当前字段；读取不写盘，下次受锁保护的更新自然移除旧字段。
      this.warning='';return {version:1,entries:value.entries,recent:value.recent}}
    catch{this.warning='工作区登记缓存损坏，原文件保留；仍可手动添加工作区。';return empty()}
  }
  async update(edit:(data:Data)=>void){
    let lock:KernelLock|undefined;
    const canonical=await fs.realpath(this.paths.userRoot);const key=hash(process.platform==='win32'?canonical.replaceAll('\\','/').toLowerCase():canonical);
    for(let n=0;n<100;n++){try{lock=new KernelLock(canonical,key,'catalog');break}catch(e:any){if(e.code!=='LOCKED')throw e;await new Promise(r=>setTimeout(r,30))}}
    if(!lock)fail('BUSY','工作区列表正在被其他窗口更新，请重试');
    try{const data=await this.read();if(this.warning&&await exists(path.join(canonical,'workspaces.json')))await fs.copyFile(path.join(canonical,'workspaces.json'),path.join(canonical,`workspaces.corrupt-${Date.now()}.json`));edit(data);await atomic(path.join(canonical,'workspaces.json'),json(data));return data}finally{lock.close()}
  }
  async add(root:string){const identity=await this.paths.identity(root);let entry!:WorkspaceEntry;
    await this.update(data=>{entry=data.entries.find(x=>x.id===identity.id)!;if(!entry){entry={...identity,name:path.basename(identity.path)};data.entries.push(entry)}});
    const mapping=path.join(this.paths.project(entry.id),'identity.json');
    if(await exists(mapping)){if((await readJson(mapping)).path!==entry.path)fail('IDENTITY','项目标识与保存的路径不一致')}
    else await atomic(mapping,json(identity));return entry;
  }
  /** 仅修改登记显示名，不移动目录、不改变工作区身份或历史关联。 */
  async rename(id:string,name:string){
    if(typeof name!=='string'||!name.trim()||name.trim().length>80||/[\r\n\x00-\x1f]/.test(name))fail('NAME','项目名称须为 1 至 80 个字符的单行文字');
    let entry!:WorkspaceEntry;await this.update(data=>{const found=data.entries.find(x=>x.id===id);if(!found)fail('NOT_FOUND','工作区不存在');found.name=name.trim();entry={...found}});return entry;
  }
  async remove(id:string){await this.update(d=>{d.entries=d.entries.filter(x=>x.id!==id);d.recent=d.recent.filter(x=>x!==id)})}
  async relocate(id:string,newPath:string,confirm:boolean){
    if(!confirm)fail('CONFIRM','重新定位需确认新路径；旧历史保留并通过 previousIds 关联，不合并或搬移');
    const identity=await this.paths.identity(newPath);const data=await this.read();const old=data.entries.find(x=>x.id===id);if(!old)fail('NOT_FOUND','工作区不存在');
    if(await exists(old.path)&&identity.id!==id)fail('RELOCATE','原项目仍存在，请将新目录作为独立工作区添加');
    const entry=await this.add(newPath);await this.update(d=>{d.entries=d.entries.filter(x=>x.id!==id||x.id===entry.id);const target=d.entries.find(x=>x.id===entry.id)!;target.previousIds=[...new Set([...(old.previousIds||[]),id])].filter(x=>x!==entry.id);d.recent=d.recent.filter(x=>x!==id)});return entry;
  }
}
