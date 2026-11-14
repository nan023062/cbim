import {expect,test} from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {buildEngineAdapter} from '../scripts/build-engine-adapters.mjs';
import {packagedEngineAdapter} from '../src/logic/execution/assembly/engine-package-loader';
import {checkedEngineAdapter} from '../src/logic/execution/rules/engine-adapter';

test('三个官方引擎包可独立构建并经统一工厂加载，构建不触发 SDK 或联网',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-adapter-'));
  try{
    const load=createRequire(import.meta.url);
    for(const id of ['pi','claude-code','codex']){
      const destination=path.join(root,id),descriptor=await buildEngineAdapter(id,destination);
      const adapter=packagedEngineAdapter(id,{root:destination,version:'1.5.0',entry:path.join(destination,'sdk.js'),identity:'a'.repeat(64),adapter:{...descriptor,entry:path.join(destination,descriptor.entry)}});
      const instance=adapter.create({provider:'test',model:'test',agentHome:path.join(root,'home'),prompt:'',knowledge:{list:async()=>[],call:async()=>{throw Error('not started')}},process:{command:process.execPath,args:[]}});
      expect(instance.kind).toBe(id);expect(typeof instance.start).toBe('function');expect(typeof instance.close).toBe('function');
      await instance.close();
      const metadata=JSON.parse(await fs.readFile(path.join(destination,'adapter.json'),'utf8'));expect(metadata).toEqual(descriptor);
      expect(()=>checkedEngineAdapter(adapter,{id:'other'})).toThrow();
      expect(()=>checkedEngineAdapter({...adapter,protocol:2},descriptor)).toThrow();
      expect(()=>checkedEngineAdapter(adapter,{id,version:'2.0.0'})).toThrow();
    }
  }finally{if(path.dirname(root)!==path.resolve(os.tmpdir())||!path.basename(root).startsWith('cbim-adapter-'))throw Error('cleanup outside fixture');await fs.rm(root,{recursive:true,force:true})}
},30000);
