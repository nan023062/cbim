import fs from 'node:fs/promises';
import path from 'node:path';
import {verifyBootResources} from '../src/bridge/server/bootstrap/selection';
import {verifyRuntimeManifest,type ColdRuntime} from '../src/logic-new/updates/service/runtime-manifest';
import {verifyPublishedPackage} from './runtime-candidate';
async function main(){
  const [packaged,candidate,remote,...rest]=process.argv.slice(2);if(!packaged||!candidate||rest.length||remote&&remote!=='--published-engines')throw Error('用法：tsx scripts/verify-cold-payload.ts <桌面目录> <runtime候选目录> [--published-engines]');
  const cold:ColdRuntime=JSON.parse(await fs.readFile(path.join(candidate,'runtime-cold.json'),'utf8'));
  const initial=verifyRuntimeManifest(JSON.parse(await fs.readFile(path.join(packaged,'resources/runtime-initial.json'),'utf8')),cold,{installed:true});
  const released=verifyRuntimeManifest(JSON.parse(await fs.readFile(path.join(candidate,'latest.json'),'utf8')),cold,{installed:true});
  if(initial.digest!==released.digest||initial.manifest.resourceVersion!==1)throw Error('冷包初始资源与冻结候选不符');
  verifyBootResources(path.join(packaged,'resources/bundled-resources'),initial.manifest.resource.files);
  const engineIds = initial.manifest.engines.filter(item => item.kind !== 'world-clock' && item.plugin?.type !== 'connector').map(item => item.kind).sort();
  if (engineIds.join(',') !== 'claude-code,codex,pi') throw Error('桌面初始引擎目录不符');
  const archives = new Set(initial.manifest.engines.map(item => item.package.name));
  async function checkDirectory(root: string) {
    for (const entry of await fs.readdir(root,{withFileTypes:true})) {
      const file = path.join(root,entry.name);
      if (archives.has(entry.name) || ['bundled-engines','codex-runtime','claude-runtime','pi-runtime','memory-runtime'].includes(entry.name))
        throw Error('桌面包包含插件运行文件：'+file);
      if (entry.isDirectory()) await checkDirectory(file);
    }
  }
  await checkDirectory(packaged);
  if(remote)for(const engine of initial.manifest.engines)await verifyPublishedPackage(engine.package);
  console.log(JSON.stringify({verified:true,codeVersion:cold.codeVersion,initialResource:1,publishedEngines:!!remote}));
}
main().catch(error=>{console.error(error.message);process.exitCode=1});
