import fs from 'node:fs/promises';
import path from 'node:path';
import {runtimeSigningKey,assertFrozenSource,fileHash} from './runtime-packaging';
import {signEngineRelease} from './engine-release';
import {enginePackageSchema,type ColdRuntime} from '../src/logic/updates/service/runtime-manifest';
import {extractRuntimeArchive,verifyRuntimeDirectory} from '../src/logic/updates/service/runtime-archive';

async function main(){
  const [candidate,coldFile,sequenceText,notesFile,previousFile,...extra]=process.argv.slice(2),sequence=Number(sequenceText);
  if(!candidate||!coldFile||!notesFile||!Number.isSafeInteger(sequence)||sequence<1||extra.length)throw Error('用法：pnpm sign:engines <候选目录> <runtime-cold.json> <发布序号> <说明文件> [上一版 latest.json]');
  const commit=assertFrozenSource(),root=path.resolve(candidate),cold:ColdRuntime=JSON.parse(await fs.readFile(coldFile,'utf8'));
  const engines=enginePackageSchema.array().min(1).parse(JSON.parse(await fs.readFile(path.join(root,'engines.json'),'utf8')));
  for(const engine of engines){
    const archive=path.resolve(root,engine.package.name);if(path.dirname(archive)!==root)throw Error('引擎归档路径越界');
    if((await fs.stat(archive)).size!==engine.package.bytes||await fileHash(archive)!==engine.package.sha256)throw Error('引擎归档与候选摘要不符');
    const stage=await fs.mkdtemp(path.join(root,'verify-'));
    try{const expanded=path.join(stage,'expanded');await extractRuntimeArchive(archive,expanded,engine.package.files,new AbortController().signal,()=>{});await verifyRuntimeDirectory(expanded,engine.package.files,new AbortController().signal)}
    finally{if(path.dirname(stage)!==root||!path.basename(stage).startsWith('verify-'))throw Error('清理边界无效');await fs.rm(stage,{recursive:true,force:true})}
  }
  const envelope=signEngineRelease({engines,sequence,sourceCommit:commit,notes:await fs.readFile(notesFile,'utf8'),previous:previousFile?JSON.parse(await fs.readFile(previousFile,'utf8')):undefined},await runtimeSigningKey(),cold);
  assertFrozenSource(commit);const file=path.join(root,'latest.json');await fs.writeFile(file,JSON.stringify(envelope,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({candidate:root,index:file,sequence,engines:engines.map(value=>({kind:value.kind,version:value.adapter!.version,identity:value.package.sha256})),published:false}));
}
main().catch(error=>{console.error(error.message);process.exitCode=1});
