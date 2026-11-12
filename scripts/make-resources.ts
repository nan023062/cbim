import fs from 'node:fs/promises';
import path from 'node:path';
import {buildRuntimeCode} from './runtime-build';
import {archiveDirectory,assertFrozenSource,coldFingerprint,collectResources,runtimeSigningKey,signRuntimeManifest} from './runtime-packaging';
import {verifyRuntimeManifest,type ColdRuntime,type EnginePackage} from '../src/backend/updater/runtime-manifest';

async function main(){
  const [baseline,resource,notesFile,engineCandidate,...extra]=process.argv.slice(2),resourceVersion=Number(resource);
  if(!baseline||!notesFile||extra.length||!Number.isSafeInteger(resourceVersion)||resourceVersion<2)throw Error('用法：pnpm make:resources <冷包或前一资源候选目录> <R整数> <更新日志文件> [新引擎候选目录]');
  if(process.platform!=='win32'||process.arch!=='x64')throw Error('资源构建当前固定 Windows x64');
  const commit=assertFrozenSource(),key=await runtimeSigningKey();
  const cold:ColdRuntime=JSON.parse(await fs.readFile(path.join(baseline,'runtime-cold.json'),'utf8'));
  const previous=verifyRuntimeManifest(JSON.parse(await fs.readFile(path.join(baseline,'latest.json'),'utf8')),cold,{installed:true}).manifest;
  if(resourceVersion<=previous.resourceVersion)throw Error('资源版本必须递增');
  await fs.mkdir('build/runtime',{recursive:true});const output=await fs.mkdtemp(path.resolve('build/runtime/c'+cold.codeVersion+'-r'+resourceVersion+'-'));
  const compiled=path.join(output,'compiled');await buildRuntimeCode(compiled);
  if(await coldFingerprint(path.join(compiled,'build/desktop.js'))!==cold.coldFingerprint)throw Error('COLD_BASE_CHANGED：固定启动器、Electron、原生库或安装配置变化，需要提高 C 并构建基础安装包');
  const resources=path.join(output,'resources');await collectResources(compiled,resources);
  const pkg=await archiveDirectory(resources,output,'runtime-c'+cold.codeVersion,'resources-c'+cold.codeVersion+'-r'+resourceVersion+'-win32-x64');
  // 默认复用前次已签名 E 身份；更换 E 要显式提供独立候选，其内容将在同一清单中签名。
  const engines:EnginePackage[]=engineCandidate?JSON.parse(await fs.readFile(path.join(engineCandidate,'engines.json'),'utf8')):previous.engines;
  const createdAt=new Date().toISOString(),manifest={...previous,sourceCommit:commit,resourceVersion,resource:pkg,engines,createdAt,expiresAt:new Date(Date.now()+90*86400000).toISOString(),notes:await fs.readFile(notesFile,'utf8')};
  const envelope=await signRuntimeManifest(manifest,key,cold);assertFrozenSource(commit);
  // 先校验完整描述与文件名，再读取本地 E 候选；不能让未验证的候选字段决定复制路径。
  if(engineCandidate)for(const engine of engines)await fs.copyFile(path.join(engineCandidate,engine.package.name),path.join(output,engine.package.name));
  await fs.writeFile(path.join(output,'runtime-cold.json'),JSON.stringify(cold,null,2));await fs.writeFile(path.join(output,'latest.json'),JSON.stringify(envelope,null,2));
  console.log(JSON.stringify({candidate:output,codeVersion:cold.codeVersion,resourceVersion,resourceBytes:pkg.bytes,engines:engines.map(e=>({kind:e.kind,version:e.version,sha256:e.package.sha256}))}));
}
main().catch(error=>{console.error(error.message);process.exitCode=1});
