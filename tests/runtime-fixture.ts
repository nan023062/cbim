import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {generateKeyPairSync,createHash,sign} from 'node:crypto';
import {archiveDirectory} from '../scripts/runtime-packaging';
import type {ColdRuntime,RuntimeManifest} from '../src/logic/updates/service/runtime-manifest';

export const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
export async function runtimeFixture(){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-runtime-test-')),source=path.join(root,'resource'),output=path.join(root,'output');
  for(const [name,content] of Object.entries({'.vite/build/main.js':'module.exports={startDesktop(){}}','.vite/build/preload.js':'// preload','.vite/renderer/main_window/index.html':'<main>Ready</main>'})){
    const file=path.join(source,name);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,content);
  }
  const resource=await archiveDirectory(source,output,'runtime-c0.2.0','resources-r1');
  const engineRoot=path.join(root,'engine');await fs.mkdir(engineRoot);await fs.writeFile(path.join(engineRoot,'entry.js'),'// external engine');
  const enginePackage=await archiveDirectory(engineRoot,output,'runtime-engines','engine');
  const key=generateKeyPairSync('ed25519');
  const cold:ColdRuntime={schema:1,codeVersion:'0.2.0',coldFingerprint:digest('cold'),platform:'win32-x64',publicKey:key.publicKey.export({type:'spki',format:'pem'}).toString()};
  const manifest:RuntimeManifest={schema:1,codeVersion:cold.codeVersion,resourceVersion:1,coldFingerprint:cold.coldFingerprint,platform:cold.platform,createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+86400000).toISOString(),sourceCommit:'a'.repeat(40),notes:'更新测试',resource,engines:(['pi','claude-code','codex'] as const).map(kind=>({kind,version:'1.0.0',entry:'entry.js',package:enginePackage}))};
  const envelope=(value:RuntimeManifest=manifest)=>{const payload=JSON.stringify(value);return {payload,signature:sign(null,Buffer.from(payload),key.privateKey).toString('base64')}};
  const initial=path.join(root,'initial.json');await fs.writeFile(initial,JSON.stringify(envelope()));
  const download=async(pkg:typeof resource,file:string,signal:AbortSignal,progress:(p:number)=>void)=>{signal.throwIfAborted();await fs.copyFile(path.join(output,pkg.name),file);progress(100)};
  return {root,source,output,manifest,cold,envelope,initial,download,async cleanup(){if(path.dirname(root)!==path.resolve(os.tmpdir())||!path.basename(root).startsWith('cbim-runtime-test-'))throw Error('Unexpected cleanup');await fs.rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:50})}};
}
