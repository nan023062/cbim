import fs from 'node:fs/promises';
import path from 'node:path';
import {buildEngineAdapter} from './build-engine-adapters.mjs';
import {createRequire} from 'node:module';

// Copy the installed production dependency closure, not developer node_modules.
// Existing package versions are preserved; conflicts get a nested dependency.
export const packagePiRuntime=async destination=>{await packageRuntime(destination,'@earendil-works/pi-coding-agent');await buildEngineAdapter('pi',destination)};
// Claude 的平台二进制及依赖同样独立随包，不复用其他客户端的安装。
export const packageClaudeRuntime=async destination=>{await packageRuntime(destination,'@anthropic-ai/claude-agent-sdk');await buildEngineAdapter('claude-code',destination)};
export const packageCodexRuntime=async destination=>{await packageRuntime(destination,'@openai/codex');await buildEngineAdapter('codex',destination)};
async function packageRuntime(destination,packageName){
  const copied=new Map(),hoisted=new Map();
  const require=createRequire(import.meta.url);
  async function locate(name,from){
    for(const base of createRequire(path.join(from,'package.json')).resolve.paths(name)||[]){
      const directory=path.join(base,name);
      try{await fs.access(path.join(directory,'package.json'));return await fs.realpath(directory)}catch{}
    }
    throw Error('缺少引擎生产依赖：'+name);
  }
  async function copy(source,parent,installName){
    const pkg=JSON.parse(await fs.readFile(path.join(source,'package.json'),'utf8'));
    const key=pkg.name+'@'+pkg.version;
    const existing=hoisted.get(installName);
    const target=existing&&existing.key!==key?path.join(parent,'node_modules',installName):path.join(destination,'node_modules',installName);
    if(!existing)hoisted.set(installName,{key,target});
    if(copied.has(target))return;
    copied.set(target,key);
    await fs.mkdir(path.dirname(target),{recursive:true});
    await fs.cp(source,target,{recursive:true,dereference:true,filter:input=>input===source||path.basename(input)!=='node_modules'});
    for(const name of Object.keys({...pkg.dependencies,...(pkg.name==='@anthropic-ai/claude-agent-sdk'?pkg.peerDependencies:{})})){
      try{await copy(await locate(name,source),target,name)}catch(error){if(!Object.hasOwn(pkg.optionalDependencies||{},name))throw error}
    }
    for(const name of Object.keys(pkg.optionalDependencies||{}))if(!Object.hasOwn(pkg.dependencies||{},name)){
      let found;try{found=await locate(name,source)}catch{continue}await copy(found,target,name);
    }
  }
  const entry=await locate(packageName,path.dirname(require.resolve('../package.json')));
  await copy(entry,destination,packageName);
  await fs.writeFile(path.join(destination,'manifest.json'),JSON.stringify({packages:[...copied.entries()].map(([directory,version])=>({directory:path.relative(destination,directory),version}))},null,2));
}
