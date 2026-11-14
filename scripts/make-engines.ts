import fs from 'node:fs/promises';
import path from 'node:path';
import {officialEngineBuilders} from './package-pi-runtime.mjs';
import {assertFrozenSource,collectEngines} from './runtime-packaging';
import {engineDescriptor,loopEngineSchema,supportedEngines,type LoopEngine} from '../src/logic/engines';
async function main(){
  if(process.platform!=='win32'||process.arch!=='x64')throw Error('引擎包当前固定 Windows x64');
  const [selected,...extra]=process.argv.slice(2);if(extra.length)throw Error('用法：pnpm make:engines [引擎 ID]');
  const kinds=new Set<LoopEngine>();const visit=(kind:LoopEngine)=>{if(kinds.has(kind))return;for(const dependency of engineDescriptor(kind).packageDependencies??[])visit(loopEngineSchema.parse(dependency));kinds.add(kind)};
  for(const kind of selected?[loopEngineSchema.parse(selected)]:supportedEngines.map(engine=>engine.id))visit(kind);
  const builders=officialEngineBuilders;
  const commit=assertFrozenSource();await fs.mkdir('build/runtime',{recursive:true});const output=await fs.mkdtemp(path.resolve('build/runtime/engines-'));
  for(const kind of kinds)await builders[kind].build(path.join(output,builders[kind].directory));
  const engines=await collectEngines(output,output,[...kinds]);assertFrozenSource(commit);await fs.writeFile(path.join(output,'engines.json'),JSON.stringify(engines,null,2));
  console.log(JSON.stringify({candidate:output,sourceCommit:commit,engines:engines.map(e=>({kind:e.kind,version:e.adapter!.version,nativeVersion:e.version,bytes:e.package.bytes}))}));
}
main().catch(error=>{console.error(error.message);process.exitCode=1});
