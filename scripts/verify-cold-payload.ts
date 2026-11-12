import fs from 'node:fs/promises';
import path from 'node:path';
import {verifyBootResources} from '../src/backend/bootstrap/selection';
import {verifyRuntimeManifest,type ColdRuntime} from '../src/backend/updater/runtime-manifest';
import {verifyPublishedPackage} from './runtime-candidate';
async function main(){
  const [packaged,candidate,remote,...rest]=process.argv.slice(2);if(!packaged||!candidate||rest.length||remote&&remote!=='--published-engines')throw Error('用法：tsx scripts/verify-cold-payload.ts <桌面目录> <runtime候选目录> [--published-engines]');
  const cold:ColdRuntime=JSON.parse(await fs.readFile(path.join(candidate,'runtime-cold.json'),'utf8'));
  const initial=verifyRuntimeManifest(JSON.parse(await fs.readFile(path.join(packaged,'resources/runtime-initial.json'),'utf8')),cold,{installed:true});
  const released=verifyRuntimeManifest(JSON.parse(await fs.readFile(path.join(candidate,'latest.json'),'utf8')),cold,{installed:true});
  if(initial.digest!==released.digest||initial.manifest.resourceVersion!==1)throw Error('冷包初始资源与冻结候选不符');
  verifyBootResources(path.join(packaged,'resources/bundled-resources'),initial.manifest.resource.files);
  if(remote)for(const engine of initial.manifest.engines)await verifyPublishedPackage(engine.package);
  console.log(JSON.stringify({verified:true,codeVersion:cold.codeVersion,initialResource:1,publishedEngines:!!remote}));
}
main().catch(error=>{console.error(error.message);process.exitCode=1});
