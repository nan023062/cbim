import fs from 'node:fs/promises';
import path from 'node:path';
import {packagePiRuntime,packageClaudeRuntime,packageCodexRuntime} from './package-pi-runtime.mjs';
import {assertFrozenSource,collectEngines} from './runtime-packaging';
async function main(){
  if(process.platform!=='win32'||process.arch!=='x64')throw Error('引擎包当前固定 Windows x64');
  const commit=assertFrozenSource();await fs.mkdir('build/runtime',{recursive:true});const output=await fs.mkdtemp(path.resolve('build/runtime/engines-'));
  await packagePiRuntime(path.join(output,'pi-runtime'));await packageClaudeRuntime(path.join(output,'claude-runtime'));await packageCodexRuntime(path.join(output,'codex-runtime'));
  const engines=await collectEngines(output,output);assertFrozenSource(commit);await fs.writeFile(path.join(output,'engines.json'),JSON.stringify(engines,null,2));
  console.log(JSON.stringify({candidate:output,sourceCommit:commit,engines:engines.map(e=>({kind:e.kind,version:e.version,bytes:e.package.bytes}))}));
}
main().catch(error=>{console.error(error.message);process.exitCode=1});
