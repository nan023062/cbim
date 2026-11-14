import {expect,test} from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {buildEngineAdapter} from '../scripts/build-engine-adapters.mjs';
import {packagedEngineAdapter} from '../src/logic/execution/assembly/engine-package-loader';
import {checkedEngineAdapter} from '../src/logic/execution/rules/engine-adapter';
import {collectEngines} from '../scripts/runtime-packaging';

test('官方引擎包可独立构建并经统一工厂加载，构建不触发 SDK 或联网',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-adapter-'));
  try{
    const load=createRequire(import.meta.url);
    for(const id of ['pi','claude-code','codex','memory']){
      const destination=path.join(root,id),descriptor=await buildEngineAdapter(id,destination);
      const adapter=packagedEngineAdapter(id,{root:destination,version:'1.5.0',entry:path.join(destination,'sdk.js'),identity:'a'.repeat(64),adapter:{...descriptor,entry:path.join(destination,descriptor.entry)}});
      const instance=adapter.create({provider:'test',model:'test',agentHome:path.join(root,'home'),prompt:'',knowledge:{list:async()=>[],call:async()=>{throw Error('not started')}},process:{command:process.execPath,args:[]}});
      expect(instance.kind).toBe(id);expect(typeof instance.start).toBe('function');expect(typeof instance.close).toBe('function');
      await instance.close();
      const metadata=JSON.parse(await fs.readFile(path.join(destination,'adapter.json'),'utf8'));expect(metadata).toEqual(descriptor);
      expect(()=>checkedEngineAdapter(adapter,{id:'other'})).toThrow();
      expect(()=>checkedEngineAdapter({...adapter,protocol:2},descriptor)).toThrow();
      expect(()=>checkedEngineAdapter(adapter,{id,version:'2.0.0'})).toThrow();
      expect(adapter.descriptor?.id).toBe(id);
      expect(()=>checkedEngineAdapter({...adapter,descriptor:undefined},descriptor)).toThrow('声明');
      expect(()=>checkedEngineAdapter({...adapter,descriptor:{...adapter.descriptor,supportedApis:[]}},descriptor)).toThrow('声明');
      expect(()=>checkedEngineAdapter({...adapter,descriptor:{...adapter.descriptor,label:'仅修改显示名',businessTypes:['新的介绍']}},descriptor)).not.toThrow();
      if(id==='memory')expect(()=>checkedEngineAdapter({...adapter,descriptor:{...adapter.descriptor,additionalModelRoles:[]}},descriptor)).toThrow('声明');
      if(id==='memory'){
        // 自定义 Loop 不需要 node_modules vendor package；测试实际 ZIP/摘要与原生入口元数据。
        await fs.rename(destination,path.join(root,'memory-runtime'));
        const [archive]=await collectEngines(root,path.join(root,'archives'),['memory']);
        expect(archive).toMatchObject({kind:'memory',version:descriptor.version,entry:'adapter.cjs',adapter:{version:descriptor.version}});
        expect(archive.package.files.map(file=>file.path).sort()).toEqual(['adapter.cjs','adapter.json']);
      }
    }
  }finally{if(path.dirname(root)!==path.resolve(os.tmpdir())||!path.basename(root).startsWith('cbim-adapter-'))throw Error('cleanup outside fixture');await fs.rm(root,{recursive:true,force:true})}
},30000);
