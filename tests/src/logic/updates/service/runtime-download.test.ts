import {it,expect,vi,afterEach} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {runtimeFixture,digest} from './support/runtime-fixture';
import {runtimeAssetResponse,downloadRuntimePackage} from '../../../../../src/logic/updates/service/runtime-download';
import {DownloadService} from '../../../../../src/logic/updates/service/download-service';
afterEach(()=>vi.unstubAllGlobals());
it('follows only public GitHub asset redirects and preserves 404 for a missing channel',async()=>{
  const fetcher=vi.fn().mockResolvedValueOnce(new Response(null,{status:302,headers:{location:'https://release-assets.githubusercontent.com/a?token=public'}})).mockResolvedValueOnce(new Response('ok'));
  vi.stubGlobal('fetch',fetcher);expect(await(await runtimeAssetResponse('https://github.com/nan023062/cbim/releases/download/runtime-c0.2.0/latest.json',new AbortController().signal)).text()).toBe('ok');
  expect(fetcher.mock.calls[0][1]).toMatchObject({redirect:'manual',credentials:'omit'});
  for(const url of ['http://github.com/nan023062/cbim/releases/download/a/b','https://evil.test/a','https://user:password@github.com/nan023062/cbim/releases/download/a/b','https://github.com/other/repo/releases/download/a/b'])await expect(runtimeAssetResponse(url,new AbortController().signal)).rejects.toThrow();
  fetcher.mockResolvedValueOnce(new Response(null,{status:302,headers:{location:'https://evil.test/file'}}));await expect(runtimeAssetResponse('https://github.com/nan023062/cbim/releases/download/a/b',new AbortController().signal)).rejects.toThrow();
  fetcher.mockResolvedValueOnce(new Response(null,{status:404}));await expect(runtimeAssetResponse('https://github.com/nan023062/cbim/releases/download/a/b',new AbortController().signal)).rejects.toMatchObject({status:404});
});
it('streams bounded bytes, rejects bad hashes and never accepts truncation or excess content',async()=>{
  const f=await runtimeFixture();try{
    const pkg={...f.manifest.resource,bytes:3,sha256:digest('abc')},signal=new AbortController().signal,fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);
    for(const [index,body]of ['abc','ab','abcd','xyz'].entries()){
      fetcher.mockResolvedValueOnce(new Response(body));const file=path.join(f.root,'download-'+index);
      if(index===0){await downloadRuntimePackage(pkg,file,signal,()=>{});expect(await fs.readFile(file,'utf8')).toBe('abc')}
      else await expect(downloadRuntimePackage(pkg,file,signal,()=>{})).rejects.toThrow();
    }
  }finally{await f.cleanup()}
});

it('shares the in-flight transfer, serializes distinct archives and rechecks disk cache',async()=>{
  const f=await runtimeFixture();
  try {
    const dir=path.join(f.root,'archives'), signal=new AbortController().signal;
    const service=new DownloadService(dir,signal);
    const pkg=(body:string)=>({...f.manifest.resource,bytes:body.length,sha256:digest(body)});
    let release!: (response:Response)=>void;
    const fetcher=vi.fn().mockImplementationOnce(()=>new Promise<Response>(resolve=>{release=resolve;})).mockResolvedValueOnce(new Response('xyz'));
    vi.stubGlobal('fetch',fetcher);
    const first=service.Acquire(pkg('abc')), duplicate=service.Acquire(pkg('abc')), second=service.Acquire(pkg('xyz'));
    expect(duplicate).toBe(first);
    await vi.waitFor(()=>expect(fetcher).toHaveBeenCalledTimes(1));
    release(new Response('abc'));
    const [a,b]=await Promise.all([first,second]);
    expect(await fs.readFile(b,'utf8')).toBe('xyz');
    expect(await new DownloadService(dir,signal).Acquire(pkg('abc'))).toBe(a);
    expect(fetcher).toHaveBeenCalledTimes(2);
    await fs.writeFile(a,'bad');
    fetcher.mockResolvedValueOnce(new Response('abc'));
    await service.Acquire(pkg('abc'));
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(await fs.readFile(a,'utf8')).toBe('abc');
  } finally {await f.cleanup();}
});
it('continues the queue after integrity failure and permits a fresh submission',async()=>{
  const f=await runtimeFixture();
  try {
    const dir=path.join(f.root,'archives'), service=new DownloadService(dir,new AbortController().signal);
    const pkg={...f.manifest.resource,bytes:3,sha256:digest('abc')};
    vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(new Response('bad')).mockResolvedValueOnce(new Response('xyz')).mockResolvedValueOnce(new Response('abc')));
    const failed=service.Acquire(pkg), next=service.Acquire({...pkg,sha256:digest('xyz')});
    await expect(failed).rejects.toThrow();
    await next;
    expect(await fs.readdir(dir)).toEqual([digest('xyz')+'.zip']);
    await service.Acquire(pkg);
  } finally {await f.cleanup();}
});

it.each([200,206])('recovers a partial archive across service instances with HTTP %i',async status=>{
  const f=await runtimeFixture();
  try {
    const dir=path.join(f.root,'queue'),pkg={...f.manifest.resource,bytes:6,sha256:digest('abcdef')};
    await fs.mkdir(dir);await fs.writeFile(path.join(dir,pkg.sha256+'.zip.part'),'abc');
    const fetcher=vi.fn().mockResolvedValue(status===206 ? new Response('def',{status,headers:{'Content-Range':'bytes 3-5/6'}}):new Response('abcdef'));
    vi.stubGlobal('fetch',fetcher);
    const svc=new DownloadService(dir,new AbortController().signal);
    const result=await svc.Acquire(pkg);
    expect(fetcher.mock.calls[0][1].headers.Range).toBe('bytes=3-');
    expect(await fs.readFile(result,'utf8')).toBe('abcdef');
  } finally {await f.cleanup();}
});
it('explicit cancellation removes the partial; host shutdown keeps it',async()=>{
  for(const cancel of [true,false]){
    const f=await runtimeFixture();try{
      const dir=path.join(f.root,'queue'),pkg={...f.manifest.resource,bytes:6,sha256:digest('abcdef')},host=new AbortController();
      const svc=new DownloadService(dir,host.signal);
      vi.stubGlobal('fetch',vi.fn(async (_url, options)=>new Response(new ReadableStream({
        start(c){c.enqueue(new TextEncoder().encode('abc'));options.signal.addEventListener('abort',()=>c.error(options.signal.reason),{once:true});}
      }))));
      const result=svc.Acquire(pkg);
      await vi.waitFor(()=>expect(svc.Snapshot()[0]?.bytes).toBe(3));
      if(cancel)svc.Cancel(pkg.sha256);else host.abort();
      await expect(result).rejects.toThrow();
      expect(await fs.readdir(dir)).toEqual(cancel?[]:[pkg.sha256+'.zip.part']);
    }finally{await f.cleanup();}
  }
});
