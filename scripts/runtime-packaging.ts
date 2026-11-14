import fs from 'node:fs/promises';
import {createReadStream,createWriteStream} from 'node:fs';
import path from 'node:path';
import {createHash,createPrivateKey,createPublicKey,sign} from 'node:crypto';
import {createRequire} from 'node:module';
import {pipeline} from 'node:stream/promises';
import {execFileSync} from 'node:child_process';
import {validateRuntimeFiles,verifyRuntimeManifest,type ColdRuntime,type RuntimeFile,type RuntimePackage,type RuntimeManifest,type EnginePackage} from '../src/logic/updates/service/runtime-manifest';

const require=createRequire(import.meta.url),{ZipFile}=require('yazl');
export async function fileHash(file:string){const hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);return hash.digest('hex')}
/** 精确文件表同时用作归档输入和验收清单；不跟随链接或收录未声明的节点。 */
export async function inventory(root:string):Promise<RuntimeFile[]>{
  const files:RuntimeFile[]=[];
  async function visit(directory:string){for(const entry of (await fs.readdir(directory,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name,'en'))){
    const file=path.join(directory,entry.name),stat=await fs.lstat(file);
    if(stat.isSymbolicLink()||stat.nlink>1&&!stat.isDirectory())throw Error('构建目录不能包含链接：'+file);
    if(stat.isDirectory())await visit(file);else if(stat.isFile())files.push({path:path.relative(root,file).split(path.sep).join('/'),bytes:stat.size,sha256:await fileHash(file)});else throw Error('构建目录包含特殊文件');
  }}
  await visit(root);validateRuntimeFiles(files);return files.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
}
export function runtimeSigningKey(filename=process.env.CBIM_RUNTIME_SIGNING_KEY){
  if(!filename)throw Error('请通过 CBIM_RUNTIME_SIGNING_KEY 指定 Ed25519 私钥文件；资源签名独立于 Windows 代码签名，不生成临时生产密钥');
  return fs.readFile(filename).then(pem=>{const key=createPrivateKey(pem);if(key.asymmetricKeyType!=='ed25519')throw Error('资源签名必须使用 Ed25519');return key});
}
export function sourceCommit(){return execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()}
export function assertFrozenSource(commit?:string){if(execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim()||commit&&sourceCommit()!==commit)throw Error('RUNTIME_SOURCE_CHANGED：请先提交并冻结源码，再生成发布候选');return sourceCommit()}
/** ZIP 固定时间和顺序，以内容命名；包不携带安装脚本、私钥或用户数据。 */
export async function archiveDirectory(root:string,output:string,tag:string,prefix:string):Promise<RuntimePackage>{
  const files=await inventory(root);await fs.mkdir(output,{recursive:true});
  const temporary=path.join(output,prefix+'.'+process.pid+'.tmp'),zip=new ZipFile();
  const job=pipeline(zip.outputStream,createWriteStream(temporary,{flags:'wx'}));
  for(const file of files)zip.addFile(path.join(root,file.path),file.path,{mtime:new Date('2000-01-01T00:00:00Z'),mode:0o100644});
  zip.end();await job;
  const sha256=await fileHash(temporary),name=prefix+'-'+sha256+'.zip',target=path.join(output,name);
  try{await fs.access(target);if(await fileHash(target)!==sha256)throw Error('已有制品内容不符');await fs.unlink(temporary)}catch(error:any){if(error.code!=='ENOENT')throw error;await fs.rename(temporary,target)}
  return {tag,name,sha256,bytes:(await fs.stat(target)).size,files};
}
/** 实际固定启动器、Electron、原生依赖和安装配置一起冻结；纯业务 JS / 资源变化不改变此指纹。 */
export async function coldFingerprint(bootstrap:string,repo=process.cwd()){
  const pkg=JSON.parse(await fs.readFile(path.join(repo,'package.json'),'utf8'));
  const electron=JSON.parse(await fs.readFile(path.join(repo,'node_modules/electron/package.json'),'utf8')).version;
  const native=await inventory(await fs.realpath(path.join(repo,'node_modules/koffi')));
  const configuration=[];
  for(const name of ['forge.config.ts','electron-builder.config.cjs','vite.main.config.ts','vite.bootstrap.config.ts','scripts/desktop-signing/config.cjs'])configuration.push({name,sha256:await fileHash(path.join(repo,name))});
  return createHash('sha256').update(JSON.stringify({schema:1,bootstrap:await fileHash(bootstrap),electron,native,configuration,identity:{name:pkg.name,productName:pkg.productName},platform:'win32-x64'})).digest('hex');
}
export async function collectResources(viteDirectory:string,target:string,repo=process.cwd()){
  await fs.mkdir(target);await fs.cp(viteDirectory,path.join(target,'.vite'),{recursive:true,filter:file=>!['desktop.js','desktop.js.map'].includes(path.basename(file))&&!file.endsWith('.map')});
  for(const name of ['design','docs','legal'])await fs.cp(path.join(repo,name),path.join(target,name),{recursive:true});
  await fs.writeFile(path.join(target,'package.json'),JSON.stringify({private:true,type:'commonjs'}));
  // Git 删除文件后可能留下空目录；ZIP 只登记文件，冷包必须与同一清单保持一致。
  // 只清理由本函数新建的制品目录，不改源码，也不放宽启动时的额外内容校验。
  const boundary=path.resolve(target);
  async function pruneEmpty(directory:string){
    const resolved=path.resolve(directory),relative=path.relative(boundary,resolved);
    if(relative.startsWith('..')||path.isAbsolute(relative))throw Error('资源目录清理越界');
    for(const entry of await fs.readdir(resolved,{withFileTypes:true})){
      if(entry.isSymbolicLink())throw Error('构建目录不能包含链接：'+path.join(resolved,entry.name));
      if(entry.isDirectory())await pruneEmpty(path.join(resolved,entry.name));
    }
    if(resolved!==boundary&&(await fs.readdir(resolved)).length===0)await fs.rmdir(resolved);
  }
  await pruneEmpty(boundary);
}
const engineEntries={pi:{directory:'pi-runtime',package:'@earendil-works/pi-coding-agent',entry:'node_modules/@earendil-works/pi-coding-agent/dist/bundle/rpc-entry.js'},'claude-code':{directory:'claude-runtime',package:'@anthropic-ai/claude-agent-sdk',entry:'node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs'},codex:{directory:'codex-runtime',package:'@openai/codex',entry:'node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe'},memory:{directory:'memory-runtime',entry:'adapter.cjs'}} as const;
export async function collectEngines(buildRoot:string,output:string,kinds:readonly (keyof typeof engineEntries)[]=Object.keys(engineEntries) as (keyof typeof engineEntries)[]):Promise<EnginePackage[]>{
  const result:EnginePackage[]=[];
  for(const kind of kinds){
    const definition=engineEntries[kind];if(!definition)throw Error('未登记的引擎构建入口');
    const root=path.join(buildRoot,definition.directory);
    await fs.access(path.join(root,definition.entry));
    const adapter=JSON.parse(await fs.readFile(path.join(root,'adapter.json'),'utf8'));if(adapter.id!==kind||adapter.protocol!==1)throw Error('适配器与引擎归档不一致');
    // SDK 引擎保持上游版本；自定义 Loop 的运行库与适配器同版，不伪造 vendor package。
    const version='package' in definition?JSON.parse(await fs.readFile(path.join(root,'node_modules',definition.package,'package.json'),'utf8')).version:adapter.version;
    result.push({kind,version,entry:definition.entry,adapter:{entry:adapter.entry,version:adapter.version,protocol:adapter.protocol},package:await archiveDirectory(root,output,'runtime-engines',kind+'-'+adapter.version+'-win32-x64')});
  }
  const codex=result.find(engine=>engine.kind==='codex'),pi=result.find(engine=>engine.kind==='pi');if(codex&&pi)codex.dependencies=[{kind:'pi',identity:pi.package.sha256}];
  return result;
}
export async function signRuntimeManifest(manifest:RuntimeManifest,key:Awaited<ReturnType<typeof runtimeSigningKey>>,cold:ColdRuntime){
  if(createPublicKey(key).export({type:'spki',format:'pem'}).toString()!==cold.publicKey)throw Error('签名密钥与已安装冷基础不匹配');
  const payload=JSON.stringify(manifest),envelope={payload,signature:sign(null,Buffer.from(payload),key).toString('base64')};
  verifyRuntimeManifest(envelope,cold);return envelope;
}
/** Forge 包装后冻结 R1 与 E 制品，安装包仅携带冷壳和 R1；E 从固定 Release 下载。 */
export async function stageColdRuntime(appDirectory:string,buildRoot:string,version:string,notes:string){
  if(process.platform!=='win32'||process.arch!=='x64')throw Error('分层桌面包目前只支持 Windows x64');
  const key=await runtimeSigningKey(),output=path.join(buildRoot,'runtime'),resourceRoot=path.join(buildRoot,'bundled-resources');
  const cold:ColdRuntime={schema:1,codeVersion:version,platform:'win32-x64',coldFingerprint:await coldFingerprint(path.join(appDirectory,'.vite/build/desktop.js')),publicKey:createPublicKey(key).export({type:'spki',format:'pem'}).toString()};
  await collectResources(path.join(appDirectory,'.vite'),resourceRoot);
  const resource=await archiveDirectory(resourceRoot,output,'runtime-c'+version,'resources-c'+version+'-r1-win32-x64');
  const engines=await collectEngines(buildRoot,output),createdAt=new Date().toISOString();
  const manifest:RuntimeManifest={schema:1,codeVersion:version,resourceVersion:1,platform:'win32-x64',coldFingerprint:cold.coldFingerprint,sourceCommit:sourceCommit(),createdAt,expiresAt:new Date(Date.now()+90*86400000).toISOString(),notes,resource,engines};
  const signed=await signRuntimeManifest(manifest,key,cold);
  for(const [file,value] of [[path.join(appDirectory,'runtime-cold.json'),cold],[path.join(output,'runtime-cold.json'),cold],[path.join(buildRoot,'runtime-initial.json'),signed],[path.join(output,'latest.json'),signed]] as const)await fs.writeFile(file,JSON.stringify(value,null,2)+'\n',{flag:'wx'});
  // 仅清理本次 Forge 暂存的确定路径；先核实绝对边界，再删除已另存到 bundled-resources 的业务文件。
  const viteRoot=path.resolve(appDirectory,'.vite');
  for(const name of await fs.readdir(viteRoot)){const target=path.resolve(viteRoot,name);if(path.dirname(target)!==viteRoot)throw Error('构建清理越界');if(name!=='build')await fs.rm(target,{recursive:true});}
  const build=path.join(viteRoot,'build');
  for(const name of await fs.readdir(build)){const target=path.resolve(build,name);if(path.dirname(target)!==build)throw Error('构建清理越界');if(name!=='desktop.js')await fs.rm(target,{recursive:true});}
  return {cold,manifest,signed,output};
}
