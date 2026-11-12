import {it,expect} from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import {managedNativeTools} from '../src/backend/engines/native-tools';
import {runtimeFixture,digest} from './runtime-fixture';
it('loads the real pinned Pi tool library from an explicit engine root without using its entry as a command',async()=>{
  const f=await runtimeFixture();try{
    const runtime={root:path.resolve('.'),version:'1.5.0',entry:'unused-cli-entry',identity:digest('trusted-test-package')};
    await fs.writeFile(path.join(f.root,'sample.txt'),'managed runtime read');
    const tools=await managedNativeTools(f.root,runtime);expect((await tools.list()).map(tool=>tool.name)).toEqual(expect.arrayContaining(['read','write','edit','bash','grep','find','ls']));
    const result=await tools.call('read',{path:'sample.txt'},new AbortController().signal,'call-1');expect(JSON.stringify(result)).toContain('managed runtime read');
    await expect(managedNativeTools(f.root,{...runtime,version:'2.0.0'})).rejects.toThrow(/版本/);
    await expect(managedNativeTools(f.root,{...runtime,root:f.root})).rejects.toThrow(/缺少/);
  }finally{await f.cleanup()}
});
