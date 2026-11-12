import {it,expect,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {runtimeFixture,digest} from './runtime-fixture';
import {RuntimeStore} from '../src/backend/updater/runtime-store';
import {extractRuntimeArchive} from '../src/backend/updater/runtime-archive';
import {createRequire} from 'node:module';
import {createWriteStream} from 'node:fs';
import {pipeline} from 'node:stream/promises';
it('coalesces preparations, verifies the exact extracted set and never overwrites a changed cached version',async()=>{
  const f=await runtimeFixture();try{
    const download=vi.fn(f.download),store=new RuntimeStore(path.join(f.root,'cache'),f.cold,download),signal=new AbortController().signal;
    const a=store.prepare(f.manifest.resource,signal),b=store.prepare(f.manifest.resource,signal);expect(a).toBe(b);
    const cached=await a;expect(download).toHaveBeenCalledOnce();await store.prepare(f.manifest.resource,signal);expect(download).toHaveBeenCalledOnce();
    await fs.writeFile(path.join(cached,'.vite/build/main.js'),'tampered');await expect(store.prepare(f.manifest.resource,signal)).rejects.toThrow();
    expect(await fs.readFile(path.join(cached,'.vite/build/main.js'),'utf8')).toBe('tampered');expect(download).toHaveBeenCalledOnce();
    const checked=await store.saveManifest(f.envelope());expect((await store.readManifest(checked.digest)).manifest).toEqual(f.manifest);await store.saveManifest(f.envelope());
  }finally{await f.cleanup()}
});
it('rejects incorrect ZIP file sets, lengths and digests before an active directory exists',async()=>{
  const f=await runtimeFixture();try{
    const zip=path.join(f.output,f.manifest.resource.name),original=f.manifest.resource.files;
    const cases=[original.slice(1),[...original,{path:'missing.js',bytes:0,sha256:digest('')}],original.map((file,i)=>i?file:{...file,bytes:file.bytes+1}),original.map((file,i)=>i?file:{...file,sha256:digest('bad')})];
    for(const [index,files] of cases.entries())await expect(extractRuntimeArchive(zip,path.join(f.root,'bad-'+index),files,new AbortController().signal)).rejects.toThrow();
    const controller=new AbortController();controller.abort();await expect(extractRuntimeArchive(zip,path.join(f.root,'aborted'),original,controller.signal)).rejects.toThrow();
    await expect(fs.access(path.join(f.root,'aborted'))).rejects.toThrow();
  }finally{await f.cleanup()}
});
it('rejects symlinks and ZIP path traversal; a failed download removes only its own staging directory',async()=>{
  const f=await runtimeFixture();try{
    const {ZipFile}=createRequire(import.meta.url)('yazl'),files=[{path:'safe.js',bytes:7,sha256:digest('payload')}];
    for(const [index,mode]of [0o120777,0o100644].entries()){
      const zip=new ZipFile(),file=path.join(f.root,'evil-'+index+'.zip'),job=pipeline(zip.outputStream,createWriteStream(file));zip.addBuffer(Buffer.from('payload'),'safe.js',{mode});zip.end();await job;
      if(index===1){const bytes=await fs.readFile(file);for(let offset=bytes.indexOf('safe.js');offset>=0;offset=bytes.indexOf('safe.js',offset+7))Buffer.from('../a.js').copy(bytes,offset);await fs.writeFile(file,bytes)}
      await expect(extractRuntimeArchive(file,path.join(f.root,'evil-'+index),files,new AbortController().signal)).rejects.toThrow();
    }
    const store=new RuntimeStore(path.join(f.root,'cache'),f.cold,async(_pkg,file)=>{await fs.writeFile(file,'partial');throw Error('network failed')});
    await expect(store.prepare(f.manifest.resource,new AbortController().signal)).rejects.toThrow(/network failed/);
    expect(await fs.readdir(path.join(f.root,'cache/staging'))).toEqual([]);await expect(fs.access(store.packageRoot(f.manifest.resource))).rejects.toThrow();
    expect(await fs.readFile(path.join(f.source,'.vite/build/main.js'),'utf8')).toContain('startDesktop');
  }finally{await f.cleanup()}
});
