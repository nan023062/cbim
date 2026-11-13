import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {verifyRuntimeCandidate,verifyPublishedPackage} from './runtime-candidate';
import {assertFrozenSource} from './runtime-packaging';
import {downloadRuntimeManifest} from '../src/logic/updates/service/runtime-download';
import {verifyRuntimeManifest} from '../src/logic/updates/service/runtime-manifest';

const repo='nan023062/cbim';
const gh=(args:string[])=>execFileSync('gh',args,{encoding:'utf8',maxBuffer:16*1024*1024,stdio:['ignore','pipe','pipe']}).trim();
async function main(){
  const [directory,...rest]=process.argv.slice(2);if(!directory||rest.length)throw Error('用法：pnpm publish:runtime <已验收候选目录>');
  await fs.mkdir('build',{recursive:true});const lockPath=path.resolve('build/runtime-publication.lock'),lock=await fs.open(lockPath,'wx');
  try{
    const candidate=await verifyRuntimeCandidate(directory),{manifest,cold,envelope,digest}=candidate;
    assertFrozenSource(manifest.sourceCommit);
    if(JSON.parse(gh(['api','user'])).login!=='nan023062')throw Error('发布账号不匹配，尚未写入远端');
    const tag='runtime-c'+manifest.codeVersion,signal=new AbortController().signal;
    const previous=async()=>{try{return verifyRuntimeManifest(await downloadRuntimeManifest(tag,'latest.json',signal),cold,{installed:true})}catch(error:any){if(error.status===404)return undefined;throw error}};
    const initial=await previous();if(initial&&initial.digest!==digest&&initial.manifest.resourceVersion>=manifest.resourceVersion)throw Error('远端资源版本已更新，不能重放或降级');
    if(initial?.digest===digest){
      // 同一清单已存在也回读附件；不能把附件缺失的通道报告为发布成功。
      for(const pkg of [manifest.resource,...manifest.engines.map(engine=>engine.package)])await verifyPublishedPackage(pkg);
      console.log(JSON.stringify({alreadyPublished:true,digest}));return;
    }
    // 同一 C 的发布必须串行。附件按哈希命名，只追加；可变 latest.json 最后发布。
    for(const pkg of [manifest.resource,...manifest.engines.map(engine=>engine.package)]){
      let release:any;
      try{release=JSON.parse(gh(['api','repos/'+repo+'/releases/tags/'+pkg.tag]));}catch(error:any){if(!String(error.stderr??error.message).includes('404'))throw error;gh(['release','create',pkg.tag,'--repo',repo,'--target',manifest.sourceCommit,'--prerelease','--latest=false','--title',pkg.tag,'--notes','CBIM 签名运行资源；请通过桌面更新器使用。']);release=JSON.parse(gh(['api','repos/'+repo+'/releases/tags/'+pkg.tag]));}
      if(!release.assets.some((asset:any)=>asset.name===pkg.name)){const local=path.join(directory,pkg.name);await fs.access(local);gh(['release','upload',pkg.tag,local,'--repo',repo]);}
      await verifyPublishedPackage(pkg);
    }
    const recheck=await previous();if(recheck?.digest!==initial?.digest)throw Error('发布期间通道已改变；未切换 latest.json，请核对并串行重试');
    assertFrozenSource(manifest.sourceCommit);
    gh(['release','upload',tag,path.join(directory,'latest.json'),'--clobber','--repo',repo]);
    const readback=verifyRuntimeManifest(await downloadRuntimeManifest(tag,'latest.json',signal),cold);
    if(readback.digest!==digest||readback.envelope.signature!==envelope.signature)throw Error('公开通道回读不符；请暂停后续发布并核对');
    console.log(JSON.stringify({published:true,codeVersion:manifest.codeVersion,resourceVersion:manifest.resourceVersion,digest}));
  }finally{await lock.close();await fs.unlink(lockPath)}
}
main().catch(error=>{console.error(error.message);process.exitCode=1});
