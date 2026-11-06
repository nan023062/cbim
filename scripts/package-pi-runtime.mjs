import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';

// Copy the installed production dependency closure, not developer node_modules.
// Existing package versions are preserved; conflicts get a nested dependency.
export async function packagePiRuntime(destination){
  const copied=new Map(),hoisted=new Map();
  const require=createRequire(import.meta.url);
  async function locate(name,from){
    for(const base of createRequire(path.join(from,'package.json')).resolve.paths(name)||[]){
      const directory=path.join(base,name);
      try{await fs.access(path.join(directory,'package.json'));return await fs.realpath(directory)}catch{}
    }
    throw Error('缺少 Pi 生产依赖：'+name);
  }
  async function copy(source,parent){
    const pkg=JSON.parse(await fs.readFile(path.join(source,'package.json'),'utf8'));
    const key=pkg.name+'@'+pkg.version;
    const existing=hoisted.get(pkg.name);
    const target=existing&&existing.key!==key?path.join(parent,'node_modules',pkg.name):path.join(destination,'node_modules',pkg.name);
    if(!existing)hoisted.set(pkg.name,{key,target});
    if(copied.has(target))return;
    copied.set(target,key);
    await fs.mkdir(path.dirname(target),{recursive:true});
    await fs.cp(source,target,{recursive:true,dereference:true,filter:input=>input===source||path.basename(input)!=='node_modules'});
    for(const name of Object.keys(pkg.dependencies||{})){
      try{await copy(await locate(name,source),target)}catch(error){if(!Object.hasOwn(pkg.optionalDependencies||{},name))throw error}
    }
    for(const name of Object.keys(pkg.optionalDependencies||{}))if(!Object.hasOwn(pkg.dependencies||{},name)){
      let found;try{found=await locate(name,source)}catch{continue}await copy(found,target);
    }
  }
  const entry=await locate('@earendil-works/pi-coding-agent',path.dirname(require.resolve('../package.json')));
  await copy(entry,destination);
  await fs.writeFile(path.join(destination,'manifest.json'),JSON.stringify({packages:[...copied.entries()].map(([directory,version])=>({directory:path.relative(destination,directory),version}))},null,2));
}
