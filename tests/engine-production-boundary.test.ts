import {expect,test} from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {builtinModules} from 'node:module';
import {createHash} from 'node:crypto';
import {build} from 'vite';
import {packagedEngineBuild} from '../scripts/engine-package-build.mjs';

test('正式 R 不内嵌适配器，新增记忆清单时冷壳 C 的实际构建字节不变',async()=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-package-boundary-'));
  try{
    const coldHashes:string[]=[];
    for(const [name,entry] of [['resources','src/logic/execution/assembly/loop-engine.ts'],['cold','src/bridge/server/bootstrap/desktop.ts'],['cold-before-memory','src/bridge/server/bootstrap/desktop.ts']]){
      const modules=new Set<string>();
      await build({configFile:false,logLevel:'error',plugins:[packagedEngineBuild(),{name:'catalog-before-memory',enforce:'pre',transform(code,id){if(name==='cold-before-memory'&&id.replaceAll('\\','/').endsWith('/engines/catalog/supported-engines.ts'))return code.replace(/^.*declareEngine\(\{id:'memory'.*\r?\n/m,'')}},{name:'capture-built-modules',generateBundle(_options,bundle){for(const item of Object.values(bundle))if(item.type==='chunk')for(const id of Object.keys(item.modules))modules.add(id.replaceAll('\\','/'))}}],build:{target:'node22',minify:false,outDir:path.join(directory,name),lib:{entry:path.resolve(entry),formats:['cjs'],fileName:'entry'},rollupOptions:{external:['electron','koffi',...builtinModules,...builtinModules.map(name=>'node:'+name)]}}});
      expect([...modules].filter(id=>/\/execution\/engines\/(pi|claude|codex|memory)\//.test(id))).toEqual([]);
      expect([...modules].filter(id=>/@earendil-works|@anthropic-ai|@openai\/codex/.test(id))).toEqual([]);
      if(name.startsWith('cold')){expect([...modules].filter(id=>/\/logic\/engines\//.test(id))).toEqual([]);const files=(await fs.readdir(path.join(directory,name))).sort();const hash=createHash('sha256');for(const file of files)hash.update(await fs.readFile(path.join(directory,name,file)));coldHashes.push(hash.digest('hex'))}
      else expect([...modules].some(id=>id.endsWith('/engine-package-loader.ts'))).toBe(true);
    }
    expect(coldHashes).toHaveLength(2);expect(coldHashes[0]).toBe(coldHashes[1]);
  }finally{if(path.dirname(directory)!==path.resolve(os.tmpdir())||!path.basename(directory).startsWith('cbim-package-boundary-'))throw Error('cleanup outside fixture');await fs.rm(directory,{recursive:true,force:true})}
},30000);
