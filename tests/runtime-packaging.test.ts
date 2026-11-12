import fs from 'node:fs/promises';
import path from 'node:path';
import {it,expect} from 'vitest';
import {coldFingerprint,archiveDirectory} from '../scripts/runtime-packaging';
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
