import {expect,test} from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {builtinModules} from 'node:module';
import {build} from 'vite';
import {packagedEngineBuild} from '../scripts/engine-package-build.mjs';

test('正式 R 不内嵌具体适配器，冷壳 C 不编入支持名单或厂商 SDK',async()=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-package-boundary-'));
  try{
    for(const [name,entry] of [['resources','src/logic/execution/assembly/loop-engine.ts'],['cold','src/bridge/server/bootstrap/desktop.ts']]){
      const modules=new Set<string>();
      await build({configFile:false,logLevel:'error',plugins:[packagedEngineBuild(),{name:'capture-built-modules',generateBundle(_options,bundle){for(const item of Object.values(bundle))if(item.type==='chunk')for(const id of Object.keys(item.modules))modules.add(id.replaceAll('\\','/'))}}],build:{target:'node22',minify:false,outDir:path.join(directory,name),lib:{entry:path.resolve(entry),formats:['cjs'],fileName:'entry'},rollupOptions:{external:['electron','koffi',...builtinModules,...builtinModules.map(name=>'node:'+name)]}}});
      expect([...modules].filter(id=>/\/execution\/engines\/(pi|claude|codex)\//.test(id))).toEqual([]);
      expect([...modules].filter(id=>/@earendil-works|@anthropic-ai|@openai\/codex/.test(id))).toEqual([]);
      if(name==='cold')expect([...modules].filter(id=>/\/logic\/engines\//.test(id))).toEqual([]);
      else expect([...modules].some(id=>id.endsWith('/engine-package-loader.ts'))).toBe(true);
    }
  }finally{if(path.dirname(directory)!==path.resolve(os.tmpdir())||!path.basename(directory).startsWith('cbim-package-boundary-'))throw Error('cleanup outside fixture');await fs.rm(directory,{recursive:true,force:true})}
},30000);
