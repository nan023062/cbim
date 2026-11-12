/**
 * 目录归属：backend/main/platform/files；受控文件、产物读取与验证平台。
 * 范围模式由装配注入Win32文件读取与逐目录锁；枚举前持真实目录链，关闭后不缓存权限，旧模式保持原尽力检测。
 * 作用定位：在固定工作区内枚举声明范围的全部目录和普通文件，生成完整产物观察并按原集合复核。
 * 设计原因：单独复读旧文件发现不了新增条目；两次有界完整枚举与文件句柄哈希共同核稳定性，空目录和缺失根也进入摘要。
 * 职责边界：不忽略、不分页截断、不读取正文给模型；拒绝链接和特殊对象。前后检查尽力识别外部竞争，不是操作系统沙箱或原子快照。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import type {Stats} from 'node:fs';
import {fail} from '../../../core/foundation/errors';
import {artifactScopeBindingsSchema,artifactScopeLimits,artifactScopePathSchema,type ArtifactScopeBinding} from '../../../core/workspace/artifact-scope';
import {outputManifestSnapshotSchema,type OutputManifestSnapshot,type OutputManifestEntry,type OutputManifestCheck} from '../../../core/evidence/output-manifest';
import {outputManifestHash} from '../../../core/evidence/output-manifest-evidence';
import {ArtifactFiles,normalizeArtifactPath} from './artifact-files';

const normal=(value:string)=>process.platform==='win32'?value.toLowerCase():value;
const same=(a:Stats,b:Stats)=>a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&a.mtimeMs===b.mtimeMs&&a.ctimeMs===b.ctimeMs;
/** 生命周期和工作区根由主进程冻结；调用者不能以工具参数更换根或略过条目。 */
export class OutputManifestFiles {
  private readonly files:ArtifactFiles;
  constructor(private readonly root:string,private readonly assert:()=>void,private readonly guarded?:{files:ArtifactFiles;lockDirectory(path:string):()=>void}){this.root=path.resolve(root);this.files=guarded?.files??new ArtifactFiles(this.root,assert)}
  private current(signal:AbortSignal){this.assert();signal.throwIfAborted()}
  /** 逐级核路径；只有明确 ENOENT 才表示缺失，错误、链接或非目录祖先不能伪装成空集合。 */
  private async locate(raw:string,signal:AbortSignal):Promise<{file:string;stat:Stats}|undefined>{
    this.current(signal);artifactScopePathSchema.parse(raw);normalizeArtifactPath(this.root,raw);
    const root=await fs.realpath(this.root),rootStat=await fs.lstat(this.root);this.current(signal);
    if(normal(root)!==normal(this.root)||!rootStat.isDirectory()||rootStat.isSymbolicLink())fail('MANIFEST_PATH','工作区位置或类型已变化');
    let current=this.root;const parts=raw.split('/');let stat=rootStat;
    for(let index=0;index<parts.length;index++){
      current=path.join(current,parts[index]);
      try{stat=await fs.lstat(current)}catch(error){this.current(signal);if((error as {code?:string}).code==='ENOENT')return;throw error}
      this.current(signal);if(stat.isSymbolicLink()||index<parts.length-1&&!stat.isDirectory())fail('MANIFEST_PATH','产物路径含链接或非目录祖先');
    }
    const real=await fs.realpath(current);this.current(signal);if(normal(real)!==normal(current))fail('MANIFEST_PATH','产物实际路径与声明不符');
    return {file:current,stat};
  }
  private async scan(scopes:ArtifactScopeBinding[],signal:AbortSignal):Promise<OutputManifestSnapshot>{
    const roots:OutputManifestSnapshot['roots']=[],entries:OutputManifestEntry[]=[],seen=new Set<string>();let bytes=0;
    const visit=async(relativePath:string,expected?:'file'|'directory')=>{
      this.current(signal);if(relativePath.split('/').length>artifactScopeLimits.depth)fail('MANIFEST_LIMIT','产物目录超过32层');
      const target=await this.locate(relativePath,signal);
      if(!target){if(expected){roots.push({relativePath,state:'missing'});return}fail('MANIFEST_CHANGED','目录枚举期间条目已消失')}
      const {stat,file}=target,kind=stat.isFile()?'file':stat.isDirectory()?'directory':undefined;
      if(!kind||kind==='file'&&stat.nlink!==1)fail('MANIFEST_PATH','清单只支持未链接的普通文件和目录');
      if(expected&&expected!==kind)fail('MANIFEST_KIND_CHANGED','产物类型与声明范围不符');
      if(expected)roots.push({relativePath,state:kind});
      if(entries.length>=artifactScopeLimits.entries||seen.has(relativePath.toLowerCase()))fail('MANIFEST_LIMIT','产物超过512条或存在大小写别名');seen.add(relativePath.toLowerCase());
      if(kind==='file'){
        if(stat.size>artifactScopeLimits.fileBytes||bytes+stat.size>artifactScopeLimits.totalBytes)fail('MANIFEST_LIMIT','产物超过单文件8 MiB或总计32 MiB');
        const [fact]=await this.files.captureFiles([relativePath],signal);this.current(signal);bytes+=fact.byteLength;
        if(bytes>artifactScopeLimits.totalBytes)fail('MANIFEST_LIMIT','读取期间产物总字节超过32 MiB');
        entries.push({...fact,kind:'file'});
      }else{
        entries.push({relativePath,kind:'directory'});
        // opendir 逐条读取，数量超限立即退出并关闭句柄，不先把任意大目录装入数组。
        const release=this.guarded?.lockDirectory(relativePath);
        try{const directory=await fs.opendir(file);
          for await(const child of directory){this.current(signal);await visit(relativePath+'/'+child.name)}
          const after=await this.locate(relativePath,signal);if(!after||!same(stat,after.stat))fail('MANIFEST_CHANGED','目录或条目集合在读取期间变化');
        }finally{release?.()}
      }
    };
    const declared=scopes.flatMap(value=>value.scope.roots).sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
    for(const root of declared)await visit(root.path,root.kind);
    this.current(signal);entries.sort((a,b)=>a.relativePath<b.relativePath?-1:a.relativePath>b.relativePath?1:0);
    return outputManifestSnapshotSchema.parse({scopes,roots,entries});
  }
  /** 两次完整观察共用15秒期限；最多读取两份32 MiB，出现变化不返回局部或截断清单。 */
  async capture(raw:readonly ArtifactScopeBinding[],signal:AbortSignal):Promise<OutputManifestSnapshot>{
    const scopes=artifactScopeBindingsSchema.parse(raw),limited=AbortSignal.any([signal,AbortSignal.timeout(artifactScopeLimits.readMs)]);
    const first=await this.scan(scopes,limited),second=await this.scan(scopes,limited);this.current(limited);
    if(outputManifestHash(first)!==outputManifestHash(second))fail('MANIFEST_CHANGED','两次完整产物观察不一致，请等待稳定后重新采集');
    return second;
  }
  /** 按原范围重新枚举，不只读旧路径；未知保持不可核实，不能当空清单或未变化。 */
  async check(raw:OutputManifestSnapshot,signal:AbortSignal):Promise<OutputManifestCheck>{
    const expected=outputManifestSnapshotSchema.parse(raw),expectedHash=outputManifestHash(expected);
    try{const observed=await this.capture(expected.scopes,signal),observedHash=outputManifestHash(observed);return {state:expectedHash===observedHash?'matches':'changed',expectedHash,observed,observedHash}}
    catch(error){this.current(signal);const code=(error as {code?:string})?.code;return {state:'unverifiable',expectedHash,reason:code==='MANIFEST_KIND_CHANGED'?'产物根的文件/目录类型已变化':code==='MANIFEST_LIMIT'?'产物数量、层级或大小超过受支持范围':code==='MANIFEST_CHANGED'?'产物在读取期间变化':'完整产物无法安全读取，未取得完整当前集合'}}
  }
}
