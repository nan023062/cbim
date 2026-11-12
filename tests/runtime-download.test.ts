import {it,expect,vi,afterEach} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {runtimeFixture,digest} from './runtime-fixture';
import {runtimeAssetResponse,downloadRuntimePackage} from '../src/backend/updater/runtime-download';
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
