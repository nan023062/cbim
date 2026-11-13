import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {RuntimeStore} from '../src/logic/updates/service/runtime-store';
import {downloadRuntimePackage} from '../src/logic/updates/service/runtime-download';
import {verifyRuntimeManifest,type ColdRuntime,type RuntimePackage} from '../src/logic/updates/service/runtime-manifest';
import {fileHash} from './runtime-packaging';

/** 发布前用与客户端相同的 ZIP/文件验证器检查全部 R/E；旧 E 可以从固定公共源读取。 */
export async function verifyRuntimeCandidate(directory:string){
  const cold:ColdRuntime=JSON.parse(await fs.readFile(path.join(directory,'runtime-cold.json'),'utf8'));
  const envelope=JSON.parse(await fs.readFile(path.join(directory,'latest.json'),'utf8'));
  const checked=verifyRuntimeManifest(envelope,cold);
  const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-runtime-verify-'));
  const store=new RuntimeStore(temporary,cold,async(pkg,target,signal,progress)=>{
    const local=path.join(directory,pkg.name),exists=await fs.access(local).then(()=>true,()=>false);
    if(exists){if((await fs.stat(local)).size!==pkg.bytes||await fileHash(local)!==pkg.sha256)throw Error('候选制品哈希不符：'+pkg.name);await fs.copyFile(local,target);progress(100)}
    else await downloadRuntimePackage(pkg,target,signal,progress);
  });
  try{for(const pkg of [checked.manifest.resource,...checked.manifest.engines.map(e=>e.package)])await store.prepare(pkg,new AbortController().signal);}
  finally{const resolved=path.resolve(temporary);if(path.dirname(resolved)!==path.resolve(os.tmpdir())||!path.basename(resolved).startsWith('cbim-runtime-verify-'))throw Error('验证清理路径无效');await fs.rm(resolved,{recursive:true,force:true});}
  return {cold,...checked};
}
/** 仅检查公开附件的真实字节；发布脚本不能把上传成功当作客户端可下载。 */
export async function verifyPublishedPackage(pkg:RuntimePackage){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-runtime-download-')),file=path.join(directory,'package.zip');
  try{await downloadRuntimePackage(pkg,file,new AbortController().signal,()=>{})}finally{await fs.unlink(file).catch(()=>{});await fs.rmdir(directory).catch(()=>{})}
}
