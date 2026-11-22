// Mirror already signed engine releases. Run with tsx so the exact desktop verifier is reused.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {startRegistry} from '../services/resource-registry/src-server/registry.mjs';
import {localRegistry} from '../src/logic/resource-management/local-registry.ts';
import {verifyEngineIndex,officialEnginePublicKey} from '../src/logic/updates/service/engine-index.ts';
import {downloadRuntimePackage} from '../src/logic/updates/service/runtime-download.ts';

const cache=path.join(os.homedir(),'.cbim','desktop-runtime','development');
const data=path.resolve(process.env.REGISTRY_DATA??'services/resource-registry/data');
const saved=JSON.parse(await fs.readFile(process.argv[2]??path.join(cache,'engine-index.json'),'utf8'));
const envelope=saved.indexes?.at(-1)??saved;
const trust={publicKey:officialEnginePublicKey,platform:'win32-x64'};
const {index,digest}=verifyEngineIndex(envelope,trust);
const indexFile=path.join(data,'signed-engine-index.json');
const token=randomUUID(),server=await startRegistry({data,token});
const temp=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-engine-mirror-'));
try{
  const client=localRegistry(temp,new URL(server.url).port,token);
  for(const pkg of index.releases){
    const key={kind:pkg.plugin?.type==='connector'||pkg.kind==='world-clock'?'connector':'engine',id:pkg.kind,version:pkg.adapter.version};
    let file=path.join(process.argv[3]??path.join(cache,'downloads'),pkg.package.sha256+'.zip');
    if(!await fs.stat(file).catch(e=>{if(e.code!=='ENOENT')throw e;})){
      const named=path.join(path.dirname(file),pkg.package.name);
      if(await fs.stat(named).catch(e=>{if(e.code!=='ENOENT')throw e;}))file=named;
      else {file=path.join(temp,pkg.package.name);await downloadRuntimePackage(pkg.package,file,new AbortController().signal,()=>{});}
    }
    const hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);
    if(hash.digest('hex')!==pkg.package.sha256)throw Error('signed archive mismatch: '+key.id);
    const result=await client.Publish(key,file);if(result.sha256!==pkg.package.sha256)throw Error('archive changed: '+key.id);
    console.log(key.id,key.version,result.size);
  }
  const old=await fs.readFile(indexFile,'utf8').catch(e=>{if(e.code!=='ENOENT')throw e;});
  if(old){const prev=verifyEngineIndex(JSON.parse(old),trust,true);if(prev.index.sequence>index.sequence||(prev.index.sequence===index.sequence&&prev.digest!==digest))throw Error('index rollback or conflict');}
  const stage=indexFile+'.'+randomUUID()+'.tmp';await fs.writeFile(stage,JSON.stringify(envelope));await fs.rename(stage,indexFile);
  console.log('Signed engine registry ready:',index.sequence);
}finally{await server.close();await fs.rm(temp,{recursive:true,force:true});}
