import fs from 'node:fs/promises';
import path from 'node:path';
import {it,expect} from 'vitest';
import {coldFingerprint,archiveDirectory,collectResources,inventory} from '../scripts/runtime-packaging';
import {runtimeFixture} from './runtime-fixture';
it('fixed loader/native/installer inputs force C, while business output and engine changes do not',async()=>{
  const f=await runtimeFixture();try{
    for(const [name,value]of Object.entries({'package.json':JSON.stringify({name:'cbim',productName:'CBIM'}),'node_modules/electron/package.json':JSON.stringify({version:'40.0.0'}),'node_modules/koffi/addon.node':'native','forge.config.ts':'forge','desktop-builds.ts':'entries','electron-builder.config.cjs':'nsis','vite.main.config.ts':'main','vite.bootstrap.config.ts':'bootstrap','scripts/desktop-signing/config.cjs':'signing','desktop.js':'cold','main.js':'business'})){
      const file=path.join(f.root,name);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,value);
    }
    const fingerprint=()=>coldFingerprint(path.join(f.root,'desktop.js'),f.root),original=await fingerprint();
    await fs.writeFile(path.join(f.root,'main.js'),'fixed business');expect(await fingerprint()).toBe(original);
    await fs.writeFile(path.join(f.root,'desktop-builds.ts'),'additional JS worker entry');expect(await fingerprint()).toBe(original);
    await fs.writeFile(path.join(f.root,'engine/entry.js'),'new engine');expect(await fingerprint()).toBe(original);
    await fs.writeFile(path.join(f.root,'node_modules/koffi/addon.node'),'changed native');expect(await fingerprint()).not.toBe(original);
    await fs.writeFile(path.join(f.root,'node_modules/koffi/addon.node'),'native');await fs.writeFile(path.join(f.root,'desktop.js'),'changed loader');expect(await fingerprint()).not.toBe(original);
  }finally{await f.cleanup()}
});
it('identical resource content produces the same ZIP identity without an installer',async()=>{
  const f=await runtimeFixture();try{const first=f.manifest.resource,second=await archiveDirectory(f.source,f.output,first.tag,'repeat');expect(second.sha256).toBe(first.sha256);expect(second.files).toEqual(first.files)}finally{await f.cleanup()}
});
it('resource collection omits empty retired directories without changing source or declared bytes',async()=>{
  const f=await runtimeFixture();try{
    const repo=path.join(f.root,'collection-repo'),compiled=path.join(f.root,'compiled'),target=path.join(f.root,'collected');
    const source={
      'design/guide.md':'current guide',
      'docs/01.md':'concept',
      'legal/license.txt':'license',
    };
    for(const [name,text]of Object.entries(source)){const file=path.join(repo,name);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,text)}
    await fs.mkdir(path.join(repo,'design/retired/scripts'),{recursive:true});
    await fs.mkdir(path.join(compiled,'build'),{recursive:true});
    await fs.mkdir(path.join(compiled,'renderer/unused'),{recursive:true});
    await fs.writeFile(path.join(compiled,'build/main.js'),'business');
    await fs.writeFile(path.join(compiled,'build/desktop.js'),'cold');
    await collectResources(compiled,target,repo);
    expect((await inventory(target)).map(file=>file.path)).toEqual(['.vite/build/main.js','design/guide.md','docs/01.md','legal/license.txt','package.json']);
    await expect(fs.stat(path.join(target,'design/retired'))).rejects.toMatchObject({code:'ENOENT'});
    await expect(fs.stat(path.join(target,'.vite/renderer'))).rejects.toMatchObject({code:'ENOENT'});
    expect((await fs.stat(path.join(repo,'design/retired/scripts'))).isDirectory()).toBe(true);
    for(const [name,text]of Object.entries(source))expect(await fs.readFile(path.join(target,name),'utf8')).toBe(text);
    expect(await fs.readFile(path.join(target,'.vite/build/main.js'),'utf8')).toBe('business');
  }finally{await f.cleanup()}
});
